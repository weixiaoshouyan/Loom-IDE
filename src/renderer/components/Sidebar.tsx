import React, { useState, useEffect, useCallback } from 'react';
import FileTree, { OutlineView } from './FileTree';

interface Props {
  view: string;
  workspacePath: string;
  onOpenFile: (path: string, content: string) => void;
  onOpenFolder: () => void;
  selectedFile: string;
  sidebarWidth: number;
  gitStatusMap?: Record<string, string>;
}

interface ExtInfo {
  id: string;
  name: string;
  description: string;
  installed: boolean;
  version: string;
  author: string;
}

// ====== Explorer View ======
function ExplorerView({ workspacePath, onOpenFile, onOpenFolder, selectedFile, gitStatusMap }: { workspacePath: string; onOpenFile: (path: string, content: string) => void; onOpenFolder: () => void; selectedFile: string; gitStatusMap?: Record<string, string> }) {
  const [creating, setCreating] = useState<'file' | 'folder' | null>(null);
  const [newName, setNewName] = useState('');

  const handleCreate = async () => {
    if (!newName.trim() || !workspacePath) return;
    const fullPath = workspacePath + (workspacePath.includes('\\') ? '\\' : '/') + newName.trim();
    try {
      if (creating === 'file') {
        await (window as any).loom.fs.writeFile(fullPath, '');
        onOpenFile(fullPath, '');
      } else if (creating === 'folder') {
        await (window as any).loom.fs.mkdir(fullPath);
      }
      window.dispatchEvent(new CustomEvent('loom:refresh-tree'));
    } catch (e: any) {
      console.error('Failed to create:', e.message);
    }
    setCreating(null);
    setNewName('');
  };

  return (
    <>
      <div className="sidebar-header">
        <span>{workspacePath ? workspacePath.split(/[\\/]/).pop()?.toUpperCase() : 'EXPLORER'}</span>
        <div className="sidebar-header-actions">
          <button className="sidebar-header-btn" title="New File" onClick={() => { setCreating('file'); setNewName(''); }}><svg viewBox="0 0 16 16" width="16" height="16"><path d="M9 1H4a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2V6l-5-5z" fill="none" stroke="currentColor" strokeWidth="1"/><path d="M9 1v5h5" fill="none" stroke="currentColor" strokeWidth="1"/></svg></button>
          <button className="sidebar-header-btn" title="New Folder" onClick={() => { setCreating('folder'); setNewName(''); }}><svg viewBox="0 0 16 16" width="16" height="16"><path d="M1 3a1 1 0 011-1h3.146a.5.5 0 01.354.146L6.707 3.354a.5.5 0 00.354.146H14a1 1 0 011 1v8a1 1 0 01-1 1H2a1 1 0 01-1-1V3z" fill="none" stroke="currentColor" strokeWidth="1"/></svg></button>
          <button className="sidebar-header-btn" title="Collapse All" onClick={() => window.dispatchEvent(new CustomEvent('loom:collapse-all'))}><svg viewBox="0 0 16 16" width="16" height="16"><path d="M1 4l7-3 7 3v8l-7 3-7-3V4z" fill="none" stroke="currentColor" strokeWidth="1"/><path d="M1 4l7 3 7-3M8 7v8" fill="none" stroke="currentColor" strokeWidth="0.8" opacity="0.5"/></svg></button>
          <button className="sidebar-header-btn" title="Refresh" onClick={() => window.dispatchEvent(new CustomEvent('loom:refresh-tree'))}><svg viewBox="0 0 16 16" width="16" height="16"><path d="M13 8a5 5 0 01-9.33 2" fill="none" stroke="currentColor" strokeWidth="1.2"/><path d="M3 8a5 5 0 019.33-2" fill="none" stroke="currentColor" strokeWidth="1.2"/><path d="M11 4l2 2-2 2" fill="none" stroke="currentColor" strokeWidth="1.2"/><path d="M5 12L3 10l2-2" fill="none" stroke="currentColor" strokeWidth="1.2"/></svg></button>
          <button className="sidebar-header-btn" title="Open Folder" onClick={onOpenFolder}><svg viewBox="0 0 16 16" width="16" height="16"><path d="M1 3.5A1.5 1.5 0 012.5 2h3.146a.5.5 0 01.354.146L7.207 3.293a.5.5 0 00.354.146H13.5A1.5 1.5 0 0115 4.5v8a1.5 1.5 0 01-1.5 1.5h-11A1.5 1.5 0 011 12.5v-9z" fill="none" stroke="currentColor" strokeWidth="1"/></svg></button>
        </div>
      </div>
      <div className="sidebar-content">
        {workspacePath ? (
          <div className="sidebar-section">
            {creating && (
              <div style={{ padding: '6px 8px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 4, alignItems: 'center' }}>
                <input className="search-input" style={{ flex: 1, height: 22, fontSize: 12 }}
                  placeholder={creating === 'file' ? 'filename.ext' : 'folder name'}
                  value={newName} onChange={e => setNewName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') { setCreating(null); setNewName(''); } }}
                  autoFocus />
                <button className="settings-btn-sm" onClick={handleCreate} disabled={!newName.trim()}>OK</button>
                <button className="settings-btn-sm" onClick={() => { setCreating(null); setNewName(''); }}>Cancel</button>
              </div>
            )}
            <FileTree workspacePath={workspacePath} onOpenFile={onOpenFile} selectedFile={selectedFile} gitStatusMap={gitStatusMap} />
          </div>
        ) : (
          <div style={{ padding: '16px', textAlign: 'center' }}>
            <p style={{ color: 'var(--text-muted)', fontSize: '12px', marginBottom: '12px' }}>No folder opened</p>
            <button style={{ padding: '6px 14px', background: 'var(--accent)', color: 'white', border: 'none', borderRadius: '2px', fontSize: '12px', cursor: 'pointer' }} onClick={onOpenFolder}>Open Folder</button>
          </div>
        )}
      </div>
    </>
  );
}

// ====== Search View ======
function SearchView({ workspacePath, onOpenFile }: { workspacePath: string; onOpenFile: (path: string, content: string) => void }) {
  const [query, setQuery] = useState('');
  const [replaceQuery, setReplaceQuery] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [useRegex, setUseRegex] = useState(false);
  const [showReplace, setShowReplace] = useState(false);
  const [results, setResults] = useState<{ file: string; lines: { num: number; text: string }[] }[]>([]);
  const [searching, setSearching] = useState(false);
  const [totalMatches, setTotalMatches] = useState(0);

  const handleSearch = async () => {
    if (!query || !workspacePath) return;
    setSearching(true);
    const searchResults: { file: string; lines: { num: number; text: string }[] }[] = [];
    const searchDir = async (dir: string) => {
      try {
        const entries = await (window as any).loom.fs.readDir(dir);
        for (const entry of entries) {
          if (entry.isDirectory && !['node_modules', '.git', 'dist', 'release', '__pycache__'].includes(entry.name)) {
            await searchDir(entry.path);
          } else if (!entry.isDirectory) {
            try {
              const content = await (window as any).loom.fs.readFile(entry.path);
              const lines = content.split('\n');
              const matched: { num: number; text: string }[] = [];
              let pattern: RegExp;
              try {
                const flags = caseSensitive ? 'g' : 'gi';
                const q = useRegex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const wq = wholeWord ? `\\b${q}\\b` : q;
                pattern = new RegExp(wq, flags);
              } catch { pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'); }
              lines.forEach((line: string, i: number) => {
                if (pattern.test(line)) matched.push({ num: i + 1, text: line.trim() });
                pattern.lastIndex = 0;
              });
              if (matched.length > 0) searchResults.push({ file: entry.path, lines: matched.slice(0, 10) });
            } catch {}
          }
        }
      } catch {}
    };
    await searchDir(workspacePath);
    setResults(searchResults);
    setTotalMatches(searchResults.reduce((s, r) => s + r.lines.length, 0));
    setSearching(false);
  };

  return (
    <>
      <div className="sidebar-header"><span>SEARCH</span></div>
      <div className="sidebar-content">
        <div className="search-panel">
          <div className="search-input-wrapper">
            <input className="search-input" placeholder="Search" value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleSearch(); }} />
            <button className="search-btn" onClick={handleSearch}>
              <svg viewBox="0 0 16 16" width="14" height="14"><circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" strokeWidth="1.2"/><line x1="11" y1="11" x2="14" y2="14" stroke="currentColor" strokeWidth="1.2"/></svg>
            </button>
          </div>
          <div className="search-options">
            <button className={`search-option-btn ${caseSensitive ? 'active' : ''}`} onClick={() => setCaseSensitive(!caseSensitive)} title="Match Case">Aa</button>
            <button className={`search-option-btn ${wholeWord ? 'active' : ''}`} onClick={() => setWholeWord(!wholeWord)} title="Match Whole Word">ab</button>
            <button className={`search-option-btn ${useRegex ? 'active' : ''}`} onClick={() => setUseRegex(!useRegex)} title="Use Regular Expression">.*</button>
            <button className={`search-option-btn ${showReplace ? 'active' : ''}`} onClick={() => setShowReplace(!showReplace)} title="Toggle Replace">
              <svg viewBox="0 0 16 16" width="12" height="12"><path d="M2 4l3-2v3h6l-3 2v-3H2z" fill="none" stroke="currentColor" strokeWidth="1"/><path d="M14 12l-3 2v-3H5l3-2v3h6z" fill="none" stroke="currentColor" strokeWidth="1"/></svg>
            </button>
          </div>
          {showReplace && (
            <div className="search-input-wrapper">
              <input className="search-input" placeholder="Replace" value={replaceQuery}
                onChange={e => setReplaceQuery(e.target.value)} />
            </div>
          )}
          <div className="search-results">
            {searching && <div className="panel-empty-state"><svg viewBox="0 0 16 16" width="24" height="24" style={{ color: 'var(--text-muted)', marginBottom: 8 }}><circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" strokeWidth="1.2"/><line x1="11" y1="11" x2="14" y2="14" stroke="currentColor" strokeWidth="1.2"/></svg><div>Searching...</div></div>}
            {!searching && results.length === 0 && query && <div className="panel-empty-state"><svg viewBox="0 0 16 16" width="24" height="24" style={{ color: 'var(--text-muted)', marginBottom: 8 }}><circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" strokeWidth="1.2"/><line x1="11" y1="11" x2="14" y2="14" stroke="currentColor" strokeWidth="1.2"/><line x1="5" y1="5" x2="9" y2="9" stroke="currentColor" strokeWidth="1.2"/><line x1="9" y1="5" x2="5" y2="9" stroke="currentColor" strokeWidth="1.2"/></svg><div>No results found</div><div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>Try different search terms</div></div>}
            {!searching && results.length === 0 && !query && <div className="panel-empty-state"><svg viewBox="0 0 16 16" width="24" height="24" style={{ color: 'var(--text-muted)', marginBottom: 8 }}><circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" strokeWidth="1.2"/><line x1="11" y1="11" x2="14" y2="14" stroke="currentColor" strokeWidth="1.2"/></svg><div>Search across files</div><div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>Type to search in workspace</div></div>}
            {!searching && results.length > 0 && (
              <div style={{ padding: '4px 8px', color: 'var(--text-muted)', fontSize: '11px', borderBottom: '1px solid var(--border)', marginBottom: '4px' }}>
                {totalMatches} results in {results.length} files
              </div>
            )}
            {results.map((r, i) => (
              <div key={i}>
                <div className="search-result-file">
                  <span className="search-result-file-name">{r.file.split(/[\\/]/).pop()}</span>
                  <span className="search-result-file-count">{r.lines.length}</span>
                </div>
                {r.lines.map((l, j) => (
                  <div key={j} className="search-result-line" style={{ cursor: 'pointer' }}
                    onClick={async () => { const content = await (window as any).loom.fs.readFile(r.file); onOpenFile(r.file, content); }}>
                    <span className="search-result-line-num">{l.num}</span>
                    {l.text.substring(0, 80)}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

// ====== Git View ======
function GitView({ workspacePath }: { workspacePath: string }) {
  const [branches, setBranches] = useState<string[]>([]);
  const [currentBranch, setCurrentBranch] = useState('');
  const [changes, setChanges] = useState<{ status: string; file: string }[]>([]);
  const [commitMsg, setCommitMsg] = useState('');
  const [loading, setLoading] = useState(false);
  const [gitLog, setGitLog] = useState<string[]>([]);
  const [showLog, setShowLog] = useState(false);
  const [actionMsg, setActionMsg] = useState('');

  const refresh = useCallback(async () => {
    if (!workspacePath) return;
    setLoading(true);
    try {
      const gitInfo = await (window as any).loom.git?.status?.(workspacePath);
      if (gitInfo) {
        setBranches(gitInfo.branches || []);
        setCurrentBranch(gitInfo.branch || '');
        setChanges(gitInfo.changes || []);
      }
      const log = await (window as any).loom.git?.log?.(workspacePath, 10);
      setGitLog(log || []);
    } catch {}
    setLoading(false);
  }, [workspacePath]);

  useEffect(() => { refresh(); }, [refresh]);

  const stage = async (file: string) => { await (window as any).loom.git?.stage?.(workspacePath, file); refresh(); };
  const unstage = async (file: string) => { await (window as any).loom.git?.unstage?.(workspacePath, file); refresh(); };
  const commit = async () => { if (!commitMsg.trim()) return; setActionMsg('Committing...'); await (window as any).loom.git?.commit?.(workspacePath, commitMsg); setCommitMsg(''); setActionMsg(''); refresh(); };
  const pull = async () => { setActionMsg('Pulling...'); const r = await (window as any).loom.git?.pull?.(workspacePath); setActionMsg(typeof r === 'string' && r.includes('Already up to date') ? 'Pull: up to date' : String(r).substring(0, 200) || 'Pull completed'); setTimeout(() => setActionMsg(''), 3000); refresh(); };
  const push = async () => { setActionMsg('Pushing...'); const r = await (window as any).loom.git?.push?.(workspacePath); setActionMsg(typeof r === 'string' && r.includes('Everything up-to-date') ? 'Push: up to date' : String(r).substring(0, 200) || 'Push completed'); setTimeout(() => setActionMsg(''), 3000); refresh(); };
  const switchBranch = async (branch: string) => { setActionMsg(`Switching to ${branch}...`); await (window as any).loom.git?.checkout?.(workspacePath, branch); setActionMsg(''); refresh(); window.dispatchEvent(new CustomEvent('loom:refresh-tree')); };

  const statusIcons: Record<string, string> = {
    'M': 'M', 'A': '+', 'D': 'D', 'U': 'U', '?': '?'
  };
  const statusColors: Record<string, string> = {
    'M': 'var(--yellow)', 'A': 'var(--green)', 'D': 'var(--red)',
    'U': 'var(--orange)', '?': 'var(--text-muted)',
  };
  const statusLabels: Record<string, string> = {
    'M': 'Modified', 'A': 'Added', 'D': 'Deleted', 'U': 'Updated', '?': 'Untracked'
  };

  return (
    <>
      <div className="sidebar-header"><span>SOURCE CONTROL</span></div>
      <div className="sidebar-content">
        {workspacePath ? (
          <div style={{ padding: '0 8px' }}>
            {/* Pull/Push actions */}
            <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
              <button className="settings-btn-sm" onClick={pull} title="Git Pull">
                <svg viewBox="0 0 16 16" width="12" height="12" style={{ marginRight: 4 }}><path d="M8 1v10M4 7l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5"/></svg>
                Pull
              </button>
              <button className="settings-btn-sm" onClick={push} title="Git Push">
                <svg viewBox="0 0 16 16" width="12" height="12" style={{ marginRight: 4 }}><path d="M8 14V4M4 9l4-4 4 4" fill="none" stroke="currentColor" strokeWidth="1.5"/></svg>
                Push
              </button>
              <button className={`settings-btn-sm ${showLog ? 'active' : ''}`} onClick={() => setShowLog(!showLog)} title="Show Git Log" style={{ marginLeft: 'auto' }}>
                Log
              </button>
            </div>

            {/* Action message */}
            {actionMsg && (
              <div style={{ fontSize: 11, color: 'var(--text-accent)', marginBottom: 8, padding: '4px 8px', background: 'var(--bg-hover)', borderRadius: 3 }}>
                {actionMsg}
              </div>
            )}

            {/* Git Log */}
            {showLog && gitLog.length > 0 && (
              <div style={{ marginBottom: 8, maxHeight: 200, overflow: 'auto', borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4, textTransform: 'uppercase' }}>Commit History</div>
                {gitLog.map((line, i) => (
                  <div key={i} style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--text-secondary)', padding: '2px 0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {line}
                  </div>
                ))}
              </div>
            )}

            {/* Commit message */}
            <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
              <input className="search-input" style={{ flex: 1 }} placeholder="Message (Ctrl+Enter to commit)"
                value={commitMsg} onChange={e => setCommitMsg(e.target.value)}
                onKeyDown={e => { if (e.ctrlKey && e.key === 'Enter') commit(); }} />
              <button className="settings-btn-sm" onClick={commit} disabled={!commitMsg.trim()}>Commit</button>
            </div>

            {/* Branch indicator */}
            {currentBranch && (
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 4 }}>
                <svg viewBox="0 0 16 16" width="12" height="12"><circle cx="4" cy="4" r="1.5" fill="currentColor"/><circle cx="4" cy="12" r="1.5" fill="currentColor"/><circle cx="12" cy="8" r="1.5" fill="currentColor"/><path d="M4 5.5v5M5.5 4h4.5a2 2 0 012 2v0" fill="none" stroke="currentColor" strokeWidth="1"/></svg>
                {currentBranch}
              </div>
            )}

            {loading && <div style={{ fontSize: 11, color: 'var(--text-muted)', padding: 4 }}>Loading...</div>}
            {!loading && changes.length === 0 && (
              <div className="panel-empty-state">
                <svg viewBox="0 0 16 16" width="24" height="24" style={{ color: 'var(--text-muted)', marginBottom: 8 }}><circle cx="4" cy="4" r="1.5" fill="currentColor"/><circle cx="4" cy="12" r="1.5" fill="currentColor"/><circle cx="12" cy="8" r="1.5" fill="currentColor"/><path d="M4 5.5v5M5.5 4h4.5a2 2 0 012 2v0" fill="none" stroke="currentColor" strokeWidth="1"/></svg>
                <div>{workspacePath ? 'No changes detected' : 'No repository found'}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>{workspacePath ? 'Your working tree is clean' : 'Open a folder with git initialized'}</div>
              </div>
            )}

            {/* Changes list */}
            {changes.map((c, i) => (
              <div key={i} className="tree-item" style={{ paddingLeft: 4, gap: 4 }}>
                <span style={{ width: 16, textAlign: 'center', color: statusColors[c.status] || 'var(--text-muted)', fontSize: 11, flexShrink: 0 }} title={statusLabels[c.status] || c.status}>
                  {statusIcons[c.status] || c.status}
                </span>
                <span className="tree-item-name" style={{ fontSize: 12 }} title={c.file}>{c.file}</span>
                <div style={{ marginLeft: 'auto', display: 'flex', gap: 2 }}>
                  <button className="sidebar-header-btn" title="Stage Changes" onClick={() => stage(c.file)}>
                    <svg viewBox="0 0 16 16" width="12" height="12"><path d="M2 8l4 4 8-8" fill="none" stroke="currentColor" strokeWidth="1.5"/></svg>
                  </button>
                  <button className="sidebar-header-btn" title="Discard Changes" onClick={() => unstage(c.file)}>
                    <svg viewBox="0 0 16 16" width="12" height="12"><path d="M3 10l4-4 4 4" fill="none" stroke="currentColor" strokeWidth="1.5"/></svg>
                  </button>
                </div>
              </div>
            ))}

            {/* Branches list */}
            {branches.length > 0 && (
              <div style={{ marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4, textTransform: 'uppercase' }}>Branches</div>
                {branches.map(b => (
                  <div key={b} className="tree-item" style={{ paddingLeft: 8, fontSize: 12, color: b === currentBranch ? 'var(--accent)' : 'var(--text-primary)', gap: 6 }}
                    onClick={() => { if (b !== currentBranch) switchBranch(b); }}>
                    {b === currentBranch && <span style={{ color: 'var(--accent)' }}>&#10003;</span>}
                    {b !== currentBranch && <span style={{ width: 10 }} />}
                    {b}
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="tree-empty">No source control providers registered</div>
        )}
      </div>
    </>
  );
}

// ====== Extensions View ======

function ExtensionsView({}: {}) {
  const [extensions, setExtensions] = useState<ExtInfo[]>([]);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    (window as any).loom?.plugins?.getAll?.().then((plugins: any[]) => {
      const exts: ExtInfo[] = plugins.map(p => ({
        id: p.id,
        name: p.manifest?.displayName || p.manifest?.name || p.id,
        description: p.manifest?.description || '',
        installed: true,
        version: p.manifest?.version || '1.0.0',
        author: p.manifest?.author || 'Unknown',
      }));
      setExtensions(exts);
    }).catch(() => {});
  }, []);

  const filtered = extensions.filter(e => e.name.toLowerCase().includes(filter.toLowerCase()) || e.description.toLowerCase().includes(filter.toLowerCase()));

  return (
    <>
      <div className="sidebar-header"><span>EXTENSIONS</span></div>
      <div className="sidebar-content">
        <div style={{ padding: '8px 8px 4px' }}>
          <input className="search-input" placeholder="Search Extensions" value={filter} onChange={e => setFilter(e.target.value)} style={{ width: '100%' }} />
        </div>
        <div style={{ padding: '0 4px' }}>
          {filtered.map(ext => (
            <div key={ext.id} style={{ padding: '8px', borderBottom: '1px solid var(--border)', cursor: 'pointer' }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>{ext.name}</span>
                <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{ext.version}</span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{ext.description}</div>
              <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 2 }}>{ext.author} · {ext.installed ? 'Installed' : 'Not installed'}</div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

// ====== Main Sidebar ======
export default function Sidebar({ view, workspacePath, onOpenFile, onOpenFolder, selectedFile, sidebarWidth, gitStatusMap }: Props) {
  if (!view) return null;
  return (
    <div className="sidebar" style={{ width: sidebarWidth }}>
      {view === 'explorer' && <ExplorerView workspacePath={workspacePath} onOpenFile={onOpenFile} onOpenFolder={onOpenFolder} selectedFile={selectedFile} gitStatusMap={gitStatusMap} />}
      {view === 'search' && <SearchView workspacePath={workspacePath} onOpenFile={onOpenFile} />}
      {view === 'git' && <GitView workspacePath={workspacePath} />}
      {view === 'extensions' && <ExtensionsView />}
      {view === 'outline' && (
        <>
          <div className="sidebar-header"><span>OUTLINE</span></div>
          <div className="sidebar-content">
            <OutlineView filePath={selectedFile} onOpenFile={onOpenFile} />
          </div>
        </>
      )}
    </div>
  );
}
