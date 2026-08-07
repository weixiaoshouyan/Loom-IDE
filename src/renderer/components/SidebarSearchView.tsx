import React, { useCallback, useEffect, useRef, useState } from 'react';
import { confirmDialog } from './ConfirmModal';

export default function SidebarSearchView({ workspacePath, onOpenFile, locale }: {
  workspacePath: string; onOpenFile: (path: string, content: string) => void; locale?: 'zh-CN' | 'en-US';
}) {
  const [query, setQuery] = useState('');
  const [replaceQuery, setReplaceQuery] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [useRegex, setUseRegex] = useState(false);
  const [showReplace, setShowReplace] = useState(false);
  const [includePattern, setIncludePattern] = useState('');
  const [results, setResults] = useState<{ file: string; lines: { num: number; text: string; matches: number[] }[] }[]>([]);
  const [searching, setSearching] = useState(false);
  const [totalMatches, setTotalMatches] = useState(0);
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());
  const [replacing, setReplacing] = useState(false);
  const [searchProgress, setSearchProgress] = useState<{ files: number; matched: number } | null>(null);
  // 用于在搜索进行中取消（用户重新搜索或卸载组件时调用）
  const searchAbortRef = useRef<AbortController | null>(null);

  const handleSearch = useCallback(async () => {
    if (!query || !workspacePath) return;
    // 取消上一次搜索
    searchAbortRef.current?.abort();
    const abort = new AbortController();
    searchAbortRef.current = abort;

    setSearching(true);
    setSearchProgress({ files: 0, matched: 0 });
    const searchResults: typeof results = [];
    const includeRe = includePattern.trim() ? new RegExp(includePattern.replace(/\*/g, '.*').replace(/\./g, '\\.'), 'i') : null;
    let pattern: RegExp;
    try {
      const flags = caseSensitive ? 'g' : 'gi';
      const q = useRegex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const wq = wholeWord ? `\\b${q}\\b` : q;
      pattern = new RegExp(wq, flags);
    } catch { pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'); /* fallback to escaped query */ }

    const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'release', '__pycache__', '.next', '.workbuddy', 'coverage', '.vscode', '.idea', 'build', 'target']);
    let filesScanned = 0;
    let totalMatched = 0;
    let lastYield = 0;
    // 让出主线程的协程点：每处理 N 个文件或 N ms 释放一次事件循环
    const yieldToEventLoop = () => new Promise<void>(r => setTimeout(r, 0));
    const shouldYield = () => {
      const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
      if (filesScanned - lastYield >= 20 || now - lastYield >= 50) {
        lastYield = now;
        return true;
      }
      return false;
    };

    const searchDir = async (dir: string) => {
      if (abort.signal.aborted) return;
      let entries: any[];
      try {
        entries = await window.loom.fs.readDir(dir);
      } catch { return; }
      for (const entry of entries) {
        if (abort.signal.aborted) return;
        if (entry.isDirectory) {
          if (SKIP_DIRS.has(entry.name)) continue;
          await searchDir(entry.path);
        } else {
          if (includeRe && !includeRe.test(entry.name)) continue;
          try {
            const content = await window.loom.fs.readFile(entry.path);
            if (typeof content !== 'string' || content.startsWith('__ERR__:')) continue;
            const lines = content.split('\n');
            const matched: { num: number; text: string; matches: number[] }[] = [];
            lines.forEach((line: string, i: number) => {
              const matches: number[] = [];
              let m;
              pattern.lastIndex = 0;
              while ((m = pattern.exec(line)) !== null) {
                matches.push(m.index);
                if (m.index === pattern.lastIndex) pattern.lastIndex++;
              }
              if (matches.length > 0) {
                matched.push({ num: i + 1, text: line.trim(), matches });
                totalMatched += matches.length;
              }
            });
            if (matched.length > 0) {
              searchResults.push({ file: entry.path, lines: matched.slice(0, 50) });
            }
          } catch { /* skip unreadable file */ }
          filesScanned++;
          if (shouldYield()) {
            setSearchProgress({ files: filesScanned, matched: totalMatched });
            await yieldToEventLoop();
          }
        }
      }
    };
    await searchDir(workspacePath);
    if (abort.signal.aborted) return; // 已被新搜索取代，丢弃结果
    setResults(searchResults);
    setTotalMatches(searchResults.reduce((s, r) => s + r.lines.reduce((ss, l) => ss + l.matches.length, 0), 0));
    setSearching(false);
    setSearchProgress(null);
  }, [query, workspacePath, caseSensitive, wholeWord, useRegex, includePattern]);

  // 卸载时取消在途搜索
  useEffect(() => () => { searchAbortRef.current?.abort(); }, []);

  const handleReplaceAll = useCallback(async () => {
    if (!query || !replaceQuery || results.length === 0 || !workspacePath) return;
    const ok = await confirmDialog.ask({
      title: locale === 'zh-CN' ? '全部替换' : 'Replace All',
      message: locale === 'zh-CN'
        ? `确定在所有 ${results.length} 个文件中替换 "${query}" 为 "${replaceQuery}" 吗？(共 ${totalMatches} 处匹配)`
        : `Replace "${query}" with "${replaceQuery}" in ${results.length} files? (${totalMatches} total matches)`,
      confirmText: locale === 'zh-CN' ? '替换' : 'Replace',
      danger: true,
    });
    if (!ok) return;
    setReplacing(true);
    let replacedCount = 0;
    let failedCount = 0;
    for (const r of results) {
      try {
        const content = await window.loom.fs.readFile(r.file);
        if (typeof content !== 'string' || content.startsWith('__ERR__:')) { failedCount++; continue; }
        const flags = caseSensitive ? 'g' : 'gi';
        const q = useRegex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const wq = wholeWord ? `\\b${q}\\b` : q;
        const pattern = new RegExp(wq, flags);
        const newContent = content.replace(pattern, replaceQuery);
        if (newContent !== content) {
          await window.loom.fs.writeFile(r.file, newContent);
          replacedCount++;
        }
      } catch { failedCount++; }
    }
    setReplacing(false);
    window.dispatchEvent(new CustomEvent('loom:notify', {
      detail: { message: locale === 'zh-CN'
        ? `已替换 ${replacedCount} 个文件${failedCount > 0 ? `，${failedCount} 个失败` : ''}`
        : `Replaced in ${replacedCount} files${failedCount > 0 ? `, ${failedCount} failed` : ''}`,
        type: failedCount > 0 ? 'warn' : 'success' }
    }));
    if (replacedCount > 0) window.dispatchEvent(new CustomEvent('loom:refresh-tree'));
  }, [query, replaceQuery, results, totalMatches, workspacePath, caseSensitive, wholeWord, useRegex, locale]);

  const highlightMatches = (text: string, matches: number[], q: string) => {
    if (!matches.length || !q) return text;
    // 用实际正则重新匹配以获取真实偏移和长度（regex 模式下 q.length 不等于匹配长度）
    let pattern: RegExp;
    try {
      const flags = caseSensitive ? 'g' : 'gi';
      const escaped = useRegex ? q : q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const wq = wholeWord ? `\\b${escaped}\\b` : escaped;
      pattern = new RegExp(wq, flags);
    } catch { return text; }
    const parts: React.ReactNode[] = [];
    let last = 0;
    let m;
    let idx = 0;
    while ((m = pattern.exec(text)) !== null) {
      const start = m.index;
      const end = start + m[0].length;
      if (start > last) parts.push(text.substring(last, start));
      parts.push(<span key={idx++} className="search-highlight">{m[0]}</span>);
      last = end;
      if (m.index === pattern.lastIndex) pattern.lastIndex++;
    }
    if (last < text.length) parts.push(text.substring(last));
    return parts;
  };

  return (
    <>
      <div className="sidebar-header"><span>{locale === 'zh-CN' ? '全局搜索' : 'SEARCH'}</span></div>
      <div className="sidebar-content">
        <div className="search-panel">
          <div className="search-input-wrapper">
            <input
              className="search-input"
              placeholder={locale === 'zh-CN' ? '搜索' : 'Search'}
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleSearch(); }}
            />
            <button className="search-btn" onClick={handleSearch} title="Search" aria-label="Search">
              <svg viewBox="0 0 16 16" width="14" height="14"><circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" strokeWidth="1.2"/><line x1="11" y1="11" x2="14" y2="14" stroke="currentColor" strokeWidth="1.2"/></svg>
            </button>
          </div>
          <div className="search-options">
            <button className={`search-option-btn ${caseSensitive ? 'active' : ''}`} onClick={() => setCaseSensitive(!caseSensitive)} title="Match Case" aria-label="Match Case">Aa</button>
            <button className={`search-option-btn ${wholeWord ? 'active' : ''}`} onClick={() => setWholeWord(!wholeWord)} title="Match Whole Word" aria-label="Match Whole Word">ab</button>
            <button className={`search-option-btn ${useRegex ? 'active' : ''}`} onClick={() => setUseRegex(!useRegex)} title="Use Regex" aria-label="Use Regex">.*</button>
            <button className={`search-option-btn ${showReplace ? 'active' : ''}`} onClick={() => setShowReplace(!showReplace)} title="Toggle Replace" aria-label="Toggle Replace">
              <svg viewBox="0 0 16 16" width="12" height="12"><path d="M2 4l3-2v3h6l-3 2v-3H2z" fill="none" stroke="currentColor" strokeWidth="1"/><path d="M14 12l-3 2v-3H5l3-2v3h6z" fill="none" stroke="currentColor" strokeWidth="1"/></svg>
            </button>
          </div>
          {showReplace && (
            <div style={{ display: 'flex', gap: 4 }}>
              <div className="search-input-wrapper" style={{ flex: 1 }}>
                <input className="search-input" placeholder={locale === 'zh-CN' ? '替换为' : 'Replace with'} value={replaceQuery} onChange={e => setReplaceQuery(e.target.value)} />
              </div>
              <button className="settings-btn-sm primary" onClick={handleReplaceAll} disabled={!replaceQuery || results.length === 0 || replacing} style={{ flexShrink: 0, fontSize: 11 }}>
                {replacing ? '...' : locale === 'zh-CN' ? '全部替换' : 'Replace All'}
              </button>
            </div>
          )}
          <div className="search-options">
            <input
              className="search-input"
              style={{ height: 24, fontSize: 11 }}
              placeholder={locale === 'zh-CN' ? '文件过滤: *.ts,*.tsx' : 'files to include: *.ts,*.tsx'}
              value={includePattern}
              onChange={e => setIncludePattern(e.target.value)}
            />
          </div>
          <div className="search-results">
            {searching && (
              <div className="panel-empty-state">
                <svg viewBox="0 0 16 16" width="24" height="24" style={{ color: 'var(--text-muted)' }}><circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" strokeWidth="1.2"/><line x1="11" y1="11" x2="14" y2="14" stroke="currentColor" strokeWidth="1.2"/></svg>
                <div>{locale === 'zh-CN' ? '正在搜索...' : 'Searching...'}</div>
                {searchProgress && (
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                    {locale === 'zh-CN'
                      ? `已扫描 ${searchProgress.files} 个文件 · ${searchProgress.matched} 处匹配`
                      : `${searchProgress.files} files scanned · ${searchProgress.matched} matches`}
                  </div>
                )}
              </div>
            )}
            {!searching && results.length === 0 && query && (
              <div className="panel-empty-state">
                <div>{locale === 'zh-CN' ? '未找到结果' : 'No results found'}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{locale === 'zh-CN' ? '试试其他搜索词' : 'Try different search terms'}</div>
              </div>
            )}
            {!searching && results.length === 0 && !query && (
              <div className="panel-empty-state">
                <svg viewBox="0 0 16 16" width="24" height="24" style={{ color: 'var(--text-muted)' }}><circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" strokeWidth="1.2"/><line x1="11" y1="11" x2="14" y2="14" stroke="currentColor" strokeWidth="1.2"/></svg>
                <div>{locale === 'zh-CN' ? '全局搜索' : 'Search across files'}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{locale === 'zh-CN' ? '输入关键词以搜索' : 'Type to search in workspace'}</div>
              </div>
            )}
            {!searching && results.length > 0 && (
              <div style={{ padding: '4px 8px', color: 'var(--text-muted)', fontSize: '11px', borderBottom: '1px solid var(--border)', marginBottom: '4px' }}>
                {locale === 'zh-CN' ? `${totalMatches} 个匹配 · ${results.length} 个文件` : `${totalMatches} results in ${results.length} files`}
              </div>
            )}
            {results.map((r, i) => {
              const isExpanded = expandedFiles.has(r.file);
              return (
                <div key={i}>
                  <div className="search-result-file" onClick={() => {
                    setExpandedFiles(s => {
                      const next = new Set(s);
                      if (next.has(r.file)) next.delete(r.file);
                      else next.add(r.file);
                      return next;
                    });
                  }}>
                    <svg viewBox="0 0 16 16" width="10" height="10" style={{ marginRight: 4, transform: isExpanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }}>
                      <path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.5" />
                    </svg>
                    <span className="search-result-file-name">{r.file.split(/[\\/]/).pop()}</span>
                    <span className="search-result-file-count">{r.lines.reduce((s, l) => s + l.matches.length, 0)}</span>
                  </div>
                  {isExpanded && r.lines.map((l, j) => (
                    <div key={j} className="search-result-line" onClick={async () => {
                      const content = await window.loom.fs.readFile(r.file);
                      onOpenFile(r.file, content);
                      // Navigate to line after a short delay
                      setTimeout(() => window.dispatchEvent(new CustomEvent('loom:go-to-line', { detail: { line: l.num } })), 200);
                    }}>
                      <span className="search-result-line-num">{l.num}</span>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{highlightMatches(l.text.substring(0, 120), l.matches.map(m => m), query)}</span>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
}
