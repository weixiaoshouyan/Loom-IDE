import fs from 'fs';
import path from 'path';
import { glob } from 'glob';
import TreeSitter from 'tree-sitter';
import TypeScript from 'tree-sitter-typescript';

export interface CodeSymbol {
  id: string;
  name: string;
  kind: 'function' | 'class' | 'interface' | 'type' | 'variable' | 'method' | 'property' | 'other';
  filePath: string;
  startLine: number;
  endLine: number;
  text: string;
  docs?: string;
}

export interface CodeIndex {
  workspacePath: string;
  updatedAt: number;
  symbols: CodeSymbol[];
}

export interface BuildCodeIndexOptions {
  maxFileSize?: number;
  onProgress?: (processed: number, total: number) => void;
}

const parser = new TreeSitter();
parser.setLanguage(TypeScript.typescript as any);

const CODE_FILE_GLOBS = ['**/*.{ts,tsx,js,jsx,mjs,cjs}', '!**/node_modules/**', '!**/dist/**', '!**/.git/**', '!**/coverage/**', '!**/.loom/**'];

function kindFromNode(type: string): CodeSymbol['kind'] {
  switch (type) {
    case 'function_declaration':
    case 'arrow_function':
    case 'function':
      return 'function';
    case 'class_declaration':
    case 'class':
      return 'class';
    case 'interface_declaration':
      return 'interface';
    case 'type_alias_declaration':
      return 'type';
    case 'method_definition':
      return 'method';
    case 'property_identifier':
      return 'property';
    case 'variable_declarator':
      return 'variable';
    default:
      return 'other';
  }
}

function extractName(node: TreeSitter.SyntaxNode): string | undefined {
  const nameNode = node.childForFieldName('name');
  if (nameNode) return nameNode.text;
  if (node.type === 'variable_declarator') {
    return node.childForFieldName('name')?.text;
  }
  return undefined;
}

function extractDocs(node: TreeSitter.SyntaxNode): string | undefined {
  const prev = node.previousSibling;
  if (prev && prev.type === 'comment') {
    return prev.text.replace(/\/\*\*|\*\/|\*|\/\/\/\s?/g, '').trim();
  }
  return undefined;
}

function collectSymbols(node: TreeSitter.SyntaxNode, filePath: string, symbols: CodeSymbol[]) {
  const interesting = new Set([
    'function_declaration', 'class_declaration', 'interface_declaration',
    'type_alias_declaration', 'method_definition', 'variable_declarator',
  ]);

  if (interesting.has(node.type)) {
    const name = extractName(node);
    if (name && !name.startsWith('_')) {
      symbols.push({
        id: `${filePath}::${name}@${node.startPosition.row}`,
        name,
        kind: kindFromNode(node.type),
        filePath,
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
        text: node.text.slice(0, 800),
        docs: extractDocs(node),
      });
    }
  }

  for (let i = 0; i < node.childCount; i++) {
    collectSymbols(node.child(i)!, filePath, symbols);
  }
}

async function parseFile(filePath: string, maxFileSize: number): Promise<CodeSymbol[]> {
  try {
    const stat = await fs.promises.stat(filePath);
    if (stat.size > maxFileSize) return [];
    const source = await fs.promises.readFile(filePath, 'utf-8');
    const tree = parser.parse(source);
    const symbols: CodeSymbol[] = [];
    collectSymbols(tree.rootNode, filePath, symbols);
    return symbols;
  } catch {
    return [];
  }
}

function yieldToEventLoop(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve));
}

export async function buildCodeIndex(workspacePath: string, options?: BuildCodeIndexOptions): Promise<CodeIndex> {
  const maxFileSize = options?.maxFileSize ?? 1024 * 1024;
  const files = await glob(CODE_FILE_GLOBS, { cwd: workspacePath, absolute: true });
  const symbols: CodeSymbol[] = [];
  const total = files.length;

  // Process files in batches to avoid blocking the event loop for large workspaces.
  const batchSize = 50;
  for (let i = 0; i < files.length; i += batchSize) {
    const batch = files.slice(i, i + batchSize);
    const results = await Promise.all(batch.map(f => parseFile(f, maxFileSize)));
    for (const r of results) symbols.push(...r);
    if ((i + batchSize) % 200 === 0 || i + batchSize >= total) {
      await yieldToEventLoop();
    }
    options?.onProgress?.(Math.min(i + batchSize, total), total);
  }

  return {
    workspacePath,
    updatedAt: Date.now(),
    symbols,
  };
}

export function saveCodeIndex(index: CodeIndex, indexDir: string) {
  if (!fs.existsSync(indexDir)) fs.mkdirSync(indexDir, { recursive: true });
  const indexPath = path.join(indexDir, 'code-index.json');
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2), 'utf-8');
}

export function loadCodeIndex(indexDir: string): CodeIndex | null {
  const indexPath = path.join(indexDir, 'code-index.json');
  if (!fs.existsSync(indexPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(indexPath, 'utf-8')) as CodeIndex;
  } catch {
    return null;
  }
}

function scoreSymbol(symbol: CodeSymbol, query: string): number {
  const q = query.toLowerCase();
  const name = symbol.name.toLowerCase();
  const text = symbol.text.toLowerCase();
  const docs = (symbol.docs || '').toLowerCase();
  let score = 0;
  if (name === q) score += 100;
  else if (name.includes(q)) score += 50;
  if (text.includes(q)) score += 10;
  if (docs.includes(q)) score += 5;
  if (symbol.kind === 'function' || symbol.kind === 'method') score += 2;
  return score;
}

export function searchCodeIndex(index: CodeIndex, query: string, topK = 10): CodeSymbol[] {
  if (!query.trim()) return [];
  const scored = index.symbols
    .map(s => ({ s, score: scoreSymbol(s, query) }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
  return scored.map(x => x.s);
}

// === Incremental Update Support ===

export interface IncrementalUpdateOptions {
  maxFileSize?: number;
  onProgress?: (processed: number, total: number) => void;
}

/**
 * Incrementally update an existing CodeIndex by only re-parsing
 * changed files (modified since last index build) and removing
 * symbols from deleted files.
 */
export async function updateCodeIndexIncremental(
  existingIndex: CodeIndex,
  changedFiles: string[],
  deletedFiles: string[],
  options?: IncrementalUpdateOptions,
): Promise<CodeIndex> {
  const maxFileSize = options?.maxFileSize ?? 1024 * 1024;
  const symbolMap = new Map<string, CodeSymbol>();

  // Keep existing symbols from unchanged files
  for (const symbol of existingIndex.symbols) {
    const isDeleted = deletedFiles.some(df => symbol.filePath === df);
    const isChanged = changedFiles.some(cf => symbol.filePath === cf);
    if (!isDeleted && !isChanged) {
      symbolMap.set(`${symbol.filePath}::${symbol.name}@${symbol.startLine}`, symbol);
    }
  }

  // Re-parse changed files
  for (const filePath of changedFiles) {
    const newSymbols = await parseFile(filePath, maxFileSize);
    for (const sym of newSymbols) {
      symbolMap.set(`${sym.filePath}::${sym.name}@${sym.startLine}`, sym);
    }
  }

  const symbols = Array.from(symbolMap.values());

  options?.onProgress?.(symbols.length, symbols.length);

  return {
    workspacePath: existingIndex.workspacePath,
    updatedAt: Date.now(),
    symbols,
  };
}

/**
 * Determine which files have changed since the index was last built.
 * Returns { changed, deleted } file path arrays.
 */
export async function detectFileChanges(
  workspacePath: string,
  existingIndex: CodeIndex,
): Promise<{ changed: string[]; deleted: string[] }> {
  const currentFiles = await glob(CODE_FILE_GLOBS, { cwd: workspacePath, absolute: true });
  const currentFileSet = new Set(currentFiles);
  const existingFileSet = new Set<string>();

  const changed: string[] = [];
  const deleted: string[] = [];

  // Check existing files
  for (const symbol of existingIndex.symbols) {
    if (!existingFileSet.has(symbol.filePath)) {
      existingFileSet.add(symbol.filePath);
      if (!currentFileSet.has(symbol.filePath)) {
        deleted.push(symbol.filePath);
      } else {
        // Check mtime
        try {
          const stat = await fs.promises.stat(symbol.filePath);
          if (stat.mtimeMs > existingIndex.updatedAt) {
            changed.push(symbol.filePath);
          }
        } catch {
          deleted.push(symbol.filePath);
        }
      }
    }
  }

  // Check for new files
  for (const file of currentFiles) {
    if (!existingFileSet.has(file)) {
      changed.push(file);
    }
  }

  return { changed, deleted };
}
