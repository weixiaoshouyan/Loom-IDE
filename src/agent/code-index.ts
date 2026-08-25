import fs from 'fs';
import path from 'path';
import { glob } from 'glob';
import TreeSitter from 'tree-sitter';
import TypeScript from 'tree-sitter-typescript';
import Python from 'tree-sitter-python';
import Go from 'tree-sitter-go';
import Rust from 'tree-sitter-rust';
import C from 'tree-sitter-c';
import Java from 'tree-sitter-java';

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

// ===== Multi-language support =================================================
// Each grammar declares which node types count as symbols and how to classify
// them. Node-type names follow the tree-sitter grammar conventions for each
// language. `nameField` is the field name carrying the identifier (almost
// always 'name').
interface LanguageDef {
  id: string;
  globs: string[];
  /** 显式扩展名表（glob 大括号形式无法用 includes 判断） */
  exts: string[];
  load: () => any; // tree-sitter@0.21 typings lack the Language type
  symbolTypes: Record<string, CodeSymbol['kind']>;
}

const LANGUAGES: LanguageDef[] = [
  {
    id: 'typescript',
    globs: ['**/*.{ts,tsx,mts,cts}'],
    exts: ['.ts', '.tsx', '.mts', '.cts'],
    load: () => TypeScript.typescript,
    symbolTypes: {
      function_declaration: 'function',
      class_declaration: 'class',
      interface_declaration: 'interface',
      type_alias_declaration: 'type',
      method_definition: 'method',
      variable_declarator: 'variable',
    },
  },
  {
    id: 'javascript',
    globs: ['**/*.{js,jsx,mjs,cjs}'],
    exts: ['.js', '.jsx', '.mjs', '.cjs'],
    // tree-sitter-typescript 只导出 typescript/tsx；TS 语法可解析 JS（宽松子集）
    load: () => TypeScript.typescript,
    symbolTypes: {
      function_declaration: 'function',
      class_declaration: 'class',
      method_definition: 'method',
      variable_declarator: 'variable',
    },
  },
  {
    id: 'python',
    globs: ['**/*.py', '**/*.pyw'],
    exts: ['.py', '.pyw'],
    load: () => Python,
    symbolTypes: {
      function_definition: 'function',
      class_definition: 'class',
    },
  },
  {
    id: 'go',
    globs: ['**/*.go'],
    exts: ['.go'],
    load: () => Go,
    symbolTypes: {
      function_declaration: 'function',
      method_declaration: 'method',
      type_declaration: 'type',
    },
  },
  {
    id: 'rust',
    globs: ['**/*.rs'],
    exts: ['.rs'],
    load: () => Rust,
    symbolTypes: {
      function_item: 'function',
      struct_item: 'class',
      enum_item: 'type',
      trait_item: 'interface',
      impl_item: 'class',
      type_item: 'type',
      const_item: 'variable',
      static_item: 'variable',
      mod_item: 'other',
    },
  },
  {
    id: 'c',
    globs: ['**/*.{c,h,cc,cpp,cxx,hpp}'],
    exts: ['.c', '.h', '.cc', '.cpp', '.cxx', '.hpp'],
    load: () => C,
    symbolTypes: {
      function_definition: 'function',
      struct_specifier: 'class',
      union_specifier: 'type',
      enum_specifier: 'type',
    },
  },
  {
    id: 'java',
    globs: ['**/*.java'],
    exts: ['.java'],
    load: () => Java,
    symbolTypes: {
      class_declaration: 'class',
      interface_declaration: 'interface',
      enum_declaration: 'type',
      record_declaration: 'class',
      annotation_type_declaration: 'type',
      method_declaration: 'method',
      constructor_declaration: 'method',
    },
  },
];

const EXCLUDED_GLOBS = [
  '!**/node_modules/**', '!**/dist/**', '!**/.git/**', '!**/coverage/**',
  '!**/.loom/**', '!**/build/**', '!**/out/**', '!**/target/**', '!**/__pycache__/**',
  '!**/.venv/**', '!**/venv/**', '!**/.next/**', '!**/vendor/**',
];

export const CODE_FILE_GLOBS = [...LANGUAGES.flatMap(l => l.globs), ...EXCLUDED_GLOBS];

// Lazily-initialized per-language parser cache (parsers are not shareable
// across languages; a parser is bound to one language at a time).
const parserCache = new Map<string, { parser: TreeSitter; language: any }>();

function getParser(langId: string): { parser: TreeSitter; language: any } | null {
  const def = LANGUAGES.find(l => l.id === langId);
  if (!def) return null;
  let entry = parserCache.get(langId);
  if (!entry) {
    try {
      const language = def.load();
      const parser = new TreeSitter();
      parser.setLanguage(language);
      entry = { parser, language };
      parserCache.set(langId, entry);
    } catch {
      return null;
    }
  }
  return entry;
}

function kindFromNode(langId: string, type: string): CodeSymbol['kind'] {
  const def = LANGUAGES.find(l => l.id === langId);
  return def?.symbolTypes[type] || 'other';
}

function extractName(node: TreeSitter.SyntaxNode): string | undefined {
  const nameNode = node.childForFieldName('name');
  if (nameNode) return nameNode.text;
  // Fallback: first identifier-like child (Java constructors, Go type specs, …)
  const stack: TreeSitter.SyntaxNode[] = [node];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    for (let i = cur.childCount - 1; i >= 0; i--) {
      const child = cur.child(i)!;
      if (/identifier|type_identifier|field_identifier/.test(child.type) && child.text) {
        return child.text;
      }
      stack.push(child);
    }
  }
  return undefined;
}

function extractDocs(node: TreeSitter.SyntaxNode): string | undefined {
  const prev = node.previousSibling;
  if (prev && prev.type === 'comment') {
    return prev.text.replace(/\/\*\*|\*\/|\*|\/\/\/?\s?|#|\/\/\s?/g, '').trim();
  }
  return undefined;
}

function collectSymbols(langId: string, node: TreeSitter.SyntaxNode, filePath: string, symbols: CodeSymbol[]) {
  const def = LANGUAGES.find(l => l.id === langId);
  if (def && def.symbolTypes[node.type]) {
    const name = extractName(node);
    if (name && !name.startsWith('_')) {
      symbols.push({
        id: `${filePath}::${name}@${node.startPosition.row}`,
        name,
        kind: kindFromNode(langId, node.type),
        filePath,
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
        text: node.text.slice(0, 800),
        docs: extractDocs(node),
      });
    }
  }

  for (let i = 0; i < node.childCount; i++) {
    collectSymbols(langId, node.child(i)!, filePath, symbols);
  }
}

function langIdForFile(filePath: string): string | null {
  const ext = path.extname(filePath).toLowerCase();
  for (const def of LANGUAGES) {
    if (def.exts.includes(ext)) return def.id;
  }
  return null;
}

async function parseFile(filePath: string, maxFileSize: number): Promise<CodeSymbol[]> {
  try {
    const stat = await fs.promises.stat(filePath);
    if (stat.size > maxFileSize) return [];
    const langId = langIdForFile(filePath);
    if (!langId) return [];
    const entry = getParser(langId);
    if (!entry) return [];
    const source = await fs.promises.readFile(filePath, 'utf-8');
    const tree = entry.parser.parse(source);
    const symbols: CodeSymbol[] = [];
    collectSymbols(langId, tree.rootNode, filePath, symbols);
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
