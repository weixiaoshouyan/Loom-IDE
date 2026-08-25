import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { emitLoomEvent } from '../loom-events';

interface Command {
  id: string;
  label: string;
  shortcut?: string;
  description?: string;
  action: () => void;
}

interface Props {
  visible: boolean;
  commands: Command[];
  onClose: () => void;
  workspacePath?: string;
  onOpenFile?: (path: string, content: string) => void;
}

interface FileResult {
  path: string;
  name: string;
  relativePath: string;
  /** Fuzzy score (higher = better). -1 means no match. */
  score: number;
}

interface SymbolResult {
  id: string;
  name: string;
  kind: string;
  filePath: string;
  startLine: number;
  endLine: number;
  relativePath: string;
  score: number;
}

// ===== Fuzzy matching =====
// subsequence 匹配 + 连续匹配加分 + 词边界加分。返回 -1 表示不匹配。
// 让 `fio` 能匹配 `FileTree.tsx`，`srcag` 能匹配 `src/renderer/components/AIAgent.tsx`。
function fuzzyScore(query: string, target: string): number {
  if (!query) return 0;
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  // 完整子串匹配优先级最高
  const subIdx = t.indexOf(q);
  if (subIdx !== -1) {
    let score = 1000 - subIdx;
    if (subIdx === 0) score += 200; // 起始匹配额外加分
    // 文件名部分子串比路径部分子串更优
    const sep = Math.max(t.lastIndexOf('/'), t.lastIndexOf('\\'));
    if (subIdx > sep) score += 100;
    return score;
  }
  // subsequence 匹配
  let qi = 0, score = 0, consecutive = 0, lastIdx = -1;
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] === q[qi]) {
      if (i === lastIdx + 1) consecutive++;
      else consecutive = 0;
      score += 10 + consecutive * 5;
      // 词边界（前一个字符是分隔符或开头）
      if (i === 0 || /[\s\-_./\\]/.test(t[i - 1])) score += 25;
      lastIdx = i;
      qi++;
    }
  }
  if (qi !== q.length) return -1;
  return score;
}

// ===== MRU (Most Recently Used) =====
// 持久化到 localStorage，记录最近使用的命令 id 和文件 path，
// 同分时优先 MRU，让常用项排在前面。
const MRU_KEY = 'loom-cmd-palette-mru-v1';
const MRU_MAX = 20;
interface MRU { commands: string[]; files: string[]; }
function loadMRU(): MRU {
  try {
    const m = JSON.parse(localStorage.getItem(MRU_KEY) || '');
    if (m && Array.isArray(m.commands) && Array.isArray(m.files)) return m;
  } catch {}
  return { commands: [], files: [] };
}
function saveMRU(m: MRU) {
  try { localStorage.setItem(MRU_KEY, JSON.stringify(m)); } catch {}
}
function recordMRU(type: 'command' | 'file', id: string) {
  const m = loadMRU();
  const key = type === 'command' ? 'commands' : 'files';
  m[key] = [id, ...m[key].filter(x => x !== id)].slice(0, MRU_MAX);
  saveMRU(m);
}
function mruRank(type: 'command' | 'file', id: string): number {
  const m = loadMRU();
  const key = type === 'command' ? 'commands' : 'files';
  const idx = m[key].indexOf(id);
  return idx === -1 ? 0 : (m[key].length - idx); // 越近用越大，加到 score 上做 tie-breaker
}

export default function CommandPalette({ visible, commands, onClose, workspacePath, onOpenFile }: Props) {
  const [query, setQuery] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [fileResults, setFileResults] = useState<FileResult[]>([]);
  const [symbolResults, setSymbolResults] = useState<SymbolResult[]>([]);
  const [indexed, setIndexed] = useState(false);
  const [recentFiles, setRecentFiles] = useState<string[]>([]);
  const [pluginCommands, setPluginCommands] = useState<{ command: string; title: string; category?: string; plugin: string; hasHandler: boolean }[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Determine mode: '>' = command mode, '@' = symbol search, '?' = help, else file search
  const isCommandMode = query.startsWith('>');
  const isSymbolMode = query.startsWith('@');
  const isHelpMode = query === '?';
  const searchTerm = (isCommandMode || isSymbolMode) ? query.slice(1).trim() : query.trim();

  // Debounced search term for file search (prevents IPC spam on every keystroke)
  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    if (isCommandMode || isSymbolMode) { setDebouncedSearch(''); return; }
    const timer = setTimeout(() => setDebouncedSearch(searchTerm), 150);
    return () => clearTimeout(timer);
  }, [searchTerm, isCommandMode, isSymbolMode]);

  // Index files when palette opens with a workspace
  useEffect(() => {
    if (visible && workspacePath && !indexed) {
      window.loom?.fs?.indexFiles?.(workspacePath).then(() => setIndexed(true)).catch(() => {});
    }
  }, [visible, workspacePath, indexed]);

  // Load recent files (open tabs from session) + plugin commands
  useEffect(() => {
    if (visible) {
      try {
        const session = JSON.parse(localStorage.getItem('loom-session-v1') || 'null');
        if (session?.openFiles) {
          setRecentFiles(session.openFiles.map((f: any) => f.path).filter((p: string) => !p.startsWith('untitled-')));
        }
      } catch {}
      window.loom?.plugins?.getCommands?.().then((cmds: any[]) => setPluginCommands(cmds || [])).catch(() => {});
    }
  }, [visible]);

  useEffect(() => {
    if (visible) {
      // Default to command mode when no workspace is open (file search is useless without one)
      setQuery(workspacePath ? '' : '>');
      setSelectedIdx(0);
      setFileResults([]);
      setSymbolResults([]);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [visible, workspacePath]);

  // Symbol search via code-index (Tree-sitter 解析的符号表)
  useEffect(() => {
    if (!isSymbolMode || !visible || !workspacePath) { setSymbolResults([]); return; }
    if (!searchTerm) {
      // 无搜索词时显示最近打开文件中的符号占位提示
      setSymbolResults([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      window.loom?.codeIndex?.search?.(workspacePath, searchTerm, 30).then((syms: any[]) => {
        if (cancelled) return;
        const results: SymbolResult[] = (syms || []).map(s => {
          const relativePath = workspacePath ? s.filePath.replace(workspacePath, '').replace(/^[\\/]/, '') : s.filePath;
          // 对「符号名 + 文件相对路径」做 fuzzy，让 `AIA send` 能匹配 AIAgent.tsx 的 send 函数
          const target = `${s.name} ${relativePath}`;
          const score = fuzzyScore(searchTerm, target);
          return {
            id: `${s.filePath}:${s.startLine}:${s.name}`,
            name: s.name,
            kind: s.kind,
            filePath: s.filePath,
            startLine: s.startLine,
            endLine: s.endLine,
            relativePath,
            score,
          };
        }).filter(r => r.score >= 0).sort((a, b) => b.score - a.score).slice(0, 30);
        setSymbolResults(results);
      }).catch(() => {
        if (!cancelled) setSymbolResults([]);
      });
    }, 200);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [searchTerm, isSymbolMode, visible, workspacePath]);

  useEffect(() => {
    if (isCommandMode || isSymbolMode || !visible) { setFileResults([]); return; }
    if (!debouncedSearch) {
      // Show recent files + MRU
      const mruFiles = loadMRU().files;
      const recents = (mruFiles.length > 0 ? mruFiles : recentFiles).slice(0, 10).map((p, idx) => ({
        path: p,
        name: p.split(/[\\/]/).pop() || p,
        relativePath: workspacePath ? p.replace(workspacePath, '').replace(/^[\\/]/, '') : p,
        score: 1000 - idx, // MRU 排序
      }));
      setFileResults(recents);
      return;
    }
    let cancelled = false;
    window.loom?.fs?.searchFiles?.(workspacePath || '', debouncedSearch).then((paths: string[]) => {
      if (cancelled) return;
      // 用 fuzzy 对完整相对路径重新打分（不再只看文件名）。
      // 让 `fio` 能优先匹配 FileTree.tsx 而非任意 f..i..o 的文件。
      const results: FileResult[] = (paths || []).map((p: string) => {
        const name = p.split(/[\\/]/).pop() || p;
        const relativePath = workspacePath ? p.replace(workspacePath, '').replace(/^[\\/]/, '') : p;
        // 同时对 name 和 relativePath 打分，取较高者（用户可能凭文件名或路径记忆）
        const scoreName = fuzzyScore(debouncedSearch, name);
        const scorePath = fuzzyScore(debouncedSearch, relativePath);
        let score = Math.max(scoreName, scorePath);
        if (score < 0) return null;
        // MRU tie-breaker：最近用过的文件加分
        score += mruRank('file', p);
        return { path: p, name, relativePath, score };
      }).filter((x): x is FileResult => x !== null)
        .sort((a, b) => b.score - a.score)
        .slice(0, 50);
      setFileResults(results);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [debouncedSearch, isCommandMode, isSymbolMode, visible, workspacePath, recentFiles]);

  const filteredCommands = useMemo(() => {
    if (!isCommandMode) return [];
    // Merge built-in commands + plugin commands. Built-in commands take
    // precedence when ids collide.
    const seen = new Set<string>();
    const merged: Command[] = [];
    for (const c of commands) {
      if (!seen.has(c.id)) { merged.push(c); seen.add(c.id); }
    }
    for (const p of pluginCommands) {
      if (seen.has(p.command)) continue;
      seen.add(p.command);
      const label = p.category ? `${p.category}: ${p.title}` : p.title;
      merged.push({
        id: p.command,
        label: `$(plug) ${label}`,
        description: `by ${p.plugin}${p.hasHandler ? '' : ' (no handler)'}`,
        action: async () => {
          try {
            const r = await window.loom?.plugins?.executeCommand?.(p.command) as any;
            if (r && !r.ok && r.msg) {
              emitLoomEvent('loom:notify', { message: r.msg, type: 'warning' });
            }
          } catch (e: any) {
            emitLoomEvent('loom:notify', { message: e.message, type: 'error' });
          }
        },
      });
    }
    const q = searchTerm.toLowerCase();
    if (!q) return merged;
    return merged
      .map(c => {
        const label = c.label;
        const desc = c.description || '';
        // 用 fuzzy 对 label 主体打分（去掉 $(icon) 前缀）
        const cleanLabel = label.replace(/\$\([^)]+\)\s*/, '');
        let score = fuzzyScore(q, cleanLabel);
        if (score < 0) score = fuzzyScore(q, desc);
        if (score < 0) return null;
        // MRU tie-breaker
        score += mruRank('command', c.id);
        return { cmd: c, score };
      })
      .filter((x): x is { cmd: Command; score: number } => x !== null)
      .sort((a, b) => b.score - a.score)
      .map(x => x.cmd);
  }, [commands, pluginCommands, searchTerm, isCommandMode]);

  const items = useMemo(() => {
    if (isCommandMode) {
      return filteredCommands.map(c => ({
        type: 'command' as const,
        id: c.id,
        label: c.label,
        shortcut: c.shortcut,
        description: c.description,
        action: c.action,
      }));
    }
    if (isSymbolMode) {
      return symbolResults.map(s => ({
        type: 'symbol' as const,
        id: s.id,
        label: s.name,
        shortcut: s.kind,
        filePath: s.filePath,
        startLine: s.startLine,
        relativePath: s.relativePath,
      }));
    }
    return fileResults.map(f => ({
      type: 'file' as const,
      id: f.path,
      label: f.name,
      shortcut: '',
      filePath: f.path,
      relativePath: f.relativePath,
      isRecent: f.score >= 1000 && !searchTerm,
    }));
  }, [isCommandMode, isSymbolMode, filteredCommands, symbolResults, fileResults, searchTerm]);

  // Discriminated union of palette item types
  type PaletteItem = (
    | { type: 'command'; id: string; label: string; shortcut?: string; description?: string; action: () => void }
    | { type: 'file'; id: string; label: string; shortcut: string; filePath: string; relativePath: string; isRecent: boolean }
    | { type: 'symbol'; id: string; label: string; shortcut: string; filePath: string; startLine: number; relativePath: string }
  );

  // Group by section for nicer rendering
  const groupedItems = useMemo<{ key: string; label: string; items: PaletteItem[] }[]>(() => {
    if (isSymbolMode) return [{ key: 'symbols', label: 'Symbols', items: items as PaletteItem[] }];
    if (!isCommandMode) return [{ key: 'files', label: searchTerm ? 'Files' : 'Recent Files', items: items as PaletteItem[] }];
    // Built-in vs plugin split
    const builtin: PaletteItem[] = [];
    const plugin: PaletteItem[] = [];
    for (const it of items) {
      if ((it as any).description?.startsWith?.('by ')) plugin.push(it as PaletteItem);
      else builtin.push(it as PaletteItem);
    }
    const groups: { key: string; label: string; items: PaletteItem[] }[] = [];
    if (builtin.length) groups.push({ key: 'builtin', label: 'Built-in', items: builtin });
    if (plugin.length) groups.push({ key: 'plugin', label: 'Extensions', items: plugin });
    return groups;
  }, [isCommandMode, isSymbolMode, items, searchTerm]);

  // Flatten for keyboard navigation
  const flatItems: PaletteItem[] = useMemo(() => groupedItems.flatMap(g => g.items), [groupedItems]);

  useEffect(() => { setSelectedIdx(0); }, [query]);

  useEffect(() => {
    if (listRef.current) {
      const el = listRef.current.children[selectedIdx] as HTMLElement;
      if (el) el.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIdx]);

  const executeItem = useCallback((item: { type: string; id?: string; action?: () => void; filePath?: string; startLine?: number }) => {
    if (item.type === 'command' && item.action) {
      if (item.id) recordMRU('command', item.id);
      item.action();
    } else if (item.type === 'file' && onOpenFile && item.filePath) {
      if (item.filePath) recordMRU('file', item.filePath);
      window.loom.fs.readFile(item.filePath).then((content: string) => {
        onOpenFile(item.filePath!, content);
        // 跳到指定行（symbol 跳转用）
        if (item.startLine && item.startLine > 0) {
          setTimeout(() => {
            emitLoomEvent('loom:go-to-line', { line: item.startLine });
          }, 50);
        }
      }).catch(() => {});
    } else if (item.type === 'symbol' && onOpenFile && item.filePath) {
      // 符号跳转：打开文件后跳到符号所在行
      recordMRU('file', item.filePath);
      window.loom.fs.readFile(item.filePath).then((content: string) => {
        onOpenFile(item.filePath!, content);
        if (item.startLine && item.startLine > 0) {
          setTimeout(() => {
            emitLoomEvent('loom:go-to-line', { line: item.startLine });
          }, 50);
        }
      }).catch(() => {});
    }
    onClose();
  }, [onClose, onOpenFile]);

  if (!visible) return null;

  const placeholder = isCommandMode ? 'Type a command...'
                    : isSymbolMode ? 'Search symbols... (functions, classes, types)'
                    : isHelpMode ? 'Show help'
                    : workspacePath ? 'Search files by name... (> commands, @ symbols)'
                    : 'Open a folder first';

  const modeTag = isCommandMode ? { text: 'Commands', cls: 'cmd' }
                : isSymbolMode ? { text: 'Symbols', cls: 'sym' }
                : searchTerm ? { text: 'Files', cls: 'file' }
                : { text: 'Recent', cls: 'rec' };

  return (
    <div className="command-palette-overlay" onClick={onClose}>
      <div className="command-palette" onClick={e => e.stopPropagation()}>
        <div className="command-palette-input-wrapper">
          {isCommandMode ? (
            <span style={{ color: 'var(--accent)', fontSize: 18, fontWeight: 700 }}>›</span>
          ) : isSymbolMode ? (
            <span style={{ color: 'var(--purple)', fontSize: 18, fontWeight: 700 }}>@</span>
          ) : (
            <svg viewBox="0 0 16 16" width="14" height="14" style={{ flexShrink: 0, color: 'var(--text-muted)' }}>
              <circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" strokeWidth="1.2" />
              <line x1="11" y1="11" x2="14" y2="14" stroke="currentColor" strokeWidth="1.2" />
            </svg>
          )}
          <input
            ref={inputRef}
            className="command-palette-input"
            placeholder={placeholder}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Escape') onClose();
              else if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIdx(i => Math.min(i + 1, flatItems.length - 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIdx(i => Math.max(i - 1, 0)); }
              else if (e.key === 'Enter' && flatItems[selectedIdx]) { executeItem(flatItems[selectedIdx]); }
            }}
          />
          <span className={`command-palette-mode-tag ${modeTag.cls}`}>{modeTag.text}</span>
        </div>
        <div className="command-palette-list" ref={listRef} role="listbox" aria-activedescendant={flatItems[selectedIdx] ? `cmd-item-${selectedIdx}` : undefined} aria-label="Commands and files">
          {flatItems.length === 0 && (isCommandMode ? (
            <div className="command-palette-empty">No matching commands</div>
          ) : isSymbolMode ? (
            <div className="command-palette-empty">
              {workspacePath
                ? (searchTerm ? 'No matching symbols (only TS/JS files indexed)' : 'Type to search symbols...')
                : 'Open a folder to enable symbol search'}
            </div>
          ) : (
            <div className="command-palette-empty">
              {workspacePath
                ? (searchTerm ? 'No matching files' : 'Type to search files...')
                : 'Open a folder to enable file search'}
            </div>
          ))}
          {(() => {
            let runningIdx = 0;
            return groupedItems.map(group => (
              <React.Fragment key={group.key}>
                {group.items.length > 0 && (
                  <div style={{ padding: '4px 12px 2px', fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 }}>
                    {group.label}
                  </div>
                )}
                {group.items.map(item => {
                  const i = runningIdx++;
                  return (
                    <div
                      key={item.id}
                      id={`cmd-item-${i}`}
                      role="option"
                      aria-selected={i === selectedIdx}
                      className={`command-item ${i === selectedIdx ? 'selected' : ''}`}
                      onClick={() => executeItem(item)}
                      onMouseEnter={() => setSelectedIdx(i)}
                    >
                      <div className="command-item-icon">
                        {item.type === 'file' ? (
                          <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor">
                            <path d="M3 1.5H2a1 1 0 00-1 1v11a1 1 0 001 1h12a1 1 0 001-1V5.5L10 1.5H3z" fill="none" stroke="currentColor" strokeWidth="0.8" />
                          </svg>
                        ) : item.type === 'symbol' ? (
                          <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor">
                            <path d="M8 1L2 4v4c0 3.3 2.7 6.4 6 7 3.3-.6 6-3.7 6-7V4L8 1z" fill="none" stroke="currentColor" strokeWidth="1" />
                          </svg>
                        ) : (
                          <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor">
                            <path d="M2 4h12v8H2V4zm1 1v6h10V5H3z" />
                          </svg>
                        )}
                      </div>
                      <div className="command-item-meta">
                        <span className="command-item-label">
                          {item.label}
                          {item.type === 'file' && (item as any).isRecent && <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--purple)' }}>recent</span>}
                          {item.type === 'symbol' && (item as any).shortcut && (
                            <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--accent)', fontStyle: 'italic' }}>{(item as any).shortcut}</span>
                          )}
                        </span>
                        {item.type === 'file' && (item as any).relativePath && (
                          <span className="command-item-desc">{(item as any).relativePath}</span>
                        )}
                        {item.type === 'symbol' && (item as any).relativePath && (
                          <span className="command-item-desc">{(item as any).relativePath}:{(item as any).startLine}</span>
                        )}
                        {item.type === 'command' && (item as any).description && (
                          <span className="command-item-desc">{(item as any).description}</span>
                        )}
                      </div>
                      {item.type === 'command' && item.shortcut && (
                        <span className="command-item-keybinding">{item.shortcut}</span>
                      )}
                    </div>
                  );
                })}
              </React.Fragment>
            ));
          })()}
        </div>
      </div>
    </div>
  );
}
