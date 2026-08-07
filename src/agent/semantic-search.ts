/**
 * Loom Semantic Code Search
 *
 * Hybrid search combining:
 * 1. Symbol-based search (tree-sitter, existing)
 * 2. TF-IDF text relevance scoring
 * 3. Reference graph boosting (symbols referenced by many others rank higher)
 * 4. Recency boosting (recently modified files rank higher)
 *
 * No external embedding model required — uses statistical methods
 * that work offline and are fast enough for real-time search.
 */

import fs from 'fs';
import path from 'path';
import type { CodeSymbol, CodeIndex } from './code-index';

export interface SemanticSearchOptions {
  query: string;
  topK?: number;
  fileTypes?: string[];
  minScore?: number;
  includeContext?: boolean;
  contextLines?: number;
}

export interface SemanticSearchResult {
  symbol: CodeSymbol;
  score: number;
  context?: string;
  matchType: 'name' | 'text' | 'docs' | 'reference' | 'fuzzy';
}

// === TF-IDF Scoring ===

interface TfIdfIndex {
  documentFreq: Map<string, number>;  // term -> number of documents containing it
  termFreqs: Map<string, Map<string, number>>; // docId -> (term -> count)
  docLengths: Map<string, number>;    // docId -> total term count
  totalDocs: number;
}

let _tfidfIndex: TfIdfIndex | null = null;

function tokenize(text: string): string[] {
  return text.toLowerCase()
    .replace(/[^a-z0-9_$.]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 1);
}

function buildTfIdfIndex(symbols: CodeSymbol[]): TfIdfIndex {
  const documentFreq = new Map<string, number>();
  const termFreqs = new Map<string, Map<string, number>>();
  const docLengths = new Map<string, number>();

  for (const sym of symbols) {
    const docId = sym.id;
    const text = `${sym.name} ${sym.text} ${sym.docs || ''} ${sym.kind}`;
    const tokens = tokenize(text);
    const termFreq = new Map<string, number>();

    for (const token of tokens) {
      termFreq.set(token, (termFreq.get(token) || 0) + 1);
    }

    termFreqs.set(docId, termFreq);
    docLengths.set(docId, tokens.length);

    for (const token of new Set(tokens)) {
      documentFreq.set(token, (documentFreq.get(token) || 0) + 1);
    }
  }

  return { documentFreq, termFreqs, docLengths, totalDocs: symbols.length };
}

function getTfIdfIndex(index: CodeIndex): TfIdfIndex {
  if (!_tfidfIndex || _tfidfIndex.totalDocs !== index.symbols.length) {
    _tfidfIndex = buildTfIdfIndex(index.symbols);
  }
  return _tfidfIndex;
}

function tfidfScore(term: string, docId: string, tfidf: TfIdfIndex): number {
  const termFreq = tfidf.termFreqs.get(docId);
  if (!termFreq) return 0;

  const tf = termFreq.get(term) || 0;
  if (tf === 0) return 0;

  const df = tfidf.documentFreq.get(term) || 1;
  const idf = Math.log(tfidf.totalDocs / df);

  return (1 + Math.log(tf)) * idf;
}

// === Reference Graph ===

interface ReferenceGraph {
  /** symbol id -> set of symbol ids that reference it */
  referencedBy: Map<string, Set<string>>;
  /** symbol id -> set of symbol ids it references */
  references: Map<string, Set<string>>;
}

let _refGraph: ReferenceGraph | null = null;

function buildReferenceGraph(symbols: CodeSymbol[]): ReferenceGraph {
  const referencedBy = new Map<string, Set<string>>();
  const references = new Map<string, Set<string>>();
  const nameToIds = new Map<string, Set<string>>();

  // Build name -> symbol ids index
  for (const sym of symbols) {
    const key = sym.name.toLowerCase();
    if (!nameToIds.has(key)) nameToIds.set(key, new Set());
    nameToIds.get(key)!.add(sym.id);
    referencedBy.set(sym.id, new Set());
    references.set(sym.id, new Set());
  }

  // Build reference edges
  for (const sym of symbols) {
    const tokens = tokenize(sym.text);
    for (const token of new Set(tokens)) {
      const targetIds = nameToIds.get(token);
      if (targetIds) {
        for (const targetId of targetIds) {
          if (targetId !== sym.id) {
            references.get(sym.id)?.add(targetId);
            referencedBy.get(targetId)?.add(sym.id);
          }
        }
      }
    }
  }

  return { referencedBy, references };
}

function getReferenceGraph(index: CodeIndex): ReferenceGraph {
  if (!_refGraph || _refGraph.referencedBy.size !== index.symbols.length) {
    _refGraph = buildReferenceGraph(index.symbols);
  }
  return _refGraph;
}

// === Fuzzy Matching ===

function fuzzyMatch(query: string, target: string): number {
  const q = query.toLowerCase();
  const t = target.toLowerCase();

  if (t.includes(q)) return 0.8;
  if (t.startsWith(q)) return 0.9;

  // Levenshtein-based similarity for typos
  const maxLen = Math.max(q.length, t.length);
  if (maxLen === 0) return 1;
  const dist = levenshtein(q, t.slice(0, q.length + 2));
  return Math.max(0, 1 - dist / maxLen) * 0.6;
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
  }
  return dp[m][n];
}

// === Main Search Function ===

export function semanticSearch(
  index: CodeIndex,
  options: SemanticSearchOptions,
): SemanticSearchResult[] {
  const { query, topK = 10, fileTypes, minScore = 0.1, includeContext = true, contextLines = 3 } = options;

  if (!query.trim()) return [];

  const tfidf = getTfIdfIndex(index);
  const refGraph = getReferenceGraph(index);
  const queryTokens = tokenize(query);
  const results: SemanticSearchResult[] = [];

  for (const sym of index.symbols) {
    // File type filter
    if (fileTypes && fileTypes.length > 0) {
      const ext = path.extname(sym.filePath);
      if (!fileTypes.some(ft => ft === ext || sym.filePath.endsWith(ft))) continue;
    }

    let score = 0;
    let matchType: SemanticSearchResult['matchType'] = 'text';

    // 1. Exact name match (highest priority)
    if (sym.name.toLowerCase() === query.toLowerCase()) {
      score += 100;
      matchType = 'name';
    } else if (sym.name.toLowerCase().includes(query.toLowerCase())) {
      score += 50;
      matchType = 'name';
    } else {
      // Fuzzy name match
      const fuzzy = fuzzyMatch(query, sym.name);
      if (fuzzy > 0.5) {
        score += fuzzy * 30;
        matchType = 'fuzzy';
      }
    }

    // 2. TF-IDF text relevance
    let tfidfScoreSum = 0;
    for (const token of queryTokens) {
      tfidfScoreSum += tfidfScore(token, sym.id, tfidf);
    }
    score += tfidfScoreSum * 5;

    // 3. Documentation match
    if (sym.docs) {
      const docsLower = sym.docs.toLowerCase();
      if (docsLower.includes(query.toLowerCase())) {
        score += 15;
        matchType = 'docs';
      }
    }

    // 4. Reference graph boost (PageRank-like)
    const referencedCount = refGraph.referencedBy.get(sym.id)?.size || 0;
    if (referencedCount > 0) {
      score += Math.log2(referencedCount + 1) * 3;
      if (matchType === 'text') matchType = 'reference';
    }

    // 5. Kind-based boost
    if (sym.kind === 'function' || sym.kind === 'method') score += 2;
    if (sym.kind === 'class') score += 1;

    if (score >= minScore) {
      const result: SemanticSearchResult = { symbol: sym, score, matchType };
      if (includeContext) {
        result.context = extractContext(sym, query, contextLines);
      }
      results.push(result);
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, topK);
}

function extractContext(symbol: CodeSymbol, query: string, contextLines: number): string {
  const lines = symbol.text.split('\n');
  const queryLower = query.toLowerCase();
  let matchLine = lines.findIndex(l => l.toLowerCase().includes(queryLower));
  if (matchLine === -1) matchLine = 0;

  const start = Math.max(0, matchLine - contextLines);
  const end = Math.min(lines.length, matchLine + contextLines + 1);
  return lines.slice(start, end).join('\n');
}

/** Invalidate cached indexes (call after code index rebuild) */
export function invalidateSearchCache(): void {
  _tfidfIndex = null;
  _refGraph = null;
}
