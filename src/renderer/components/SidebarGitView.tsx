import React, { useCallback, useEffect, useState } from 'react';

export default function SidebarGitView({ workspacePath, locale }: { workspacePath: string; locale?: 'zh-CN' | 'en-US' }) {
  const [branches, setBranches] = useState<string[]>([]);
  const [currentBranch, setCurrentBranch] = useState('');
  const [changes, setChanges] = useState<{ status: string; file: string }[]>([]);
  const [commitMsg, setCommitMsg] = useState('');
  const [loading, setLoading] = useState(false);
  const [gitLog, setGitLog] = useState<string[]>([]);
  const [showLog, setShowLog] = useState(false);
  const [actionMsg, setActionMsg] = useState('');

  // Split changes into staged and unstaged based on git status codes
  const stagedChanges = changes.filter(c => {
    const s = c.status;
    // First character is index (staged) status
    return s[0] !== ' ' && s[0] !== '?' && s !== '??';
  });
  const unstagedChanges = changes.filter(c => {
    const s = c.status;
    // Second character is working tree (unstaged) status
    return (s.length > 1 && s[1] !== ' ' && s[1] !== '?') || s === '??';
  });

  const refresh = useCallback(async () => {
    if (!workspacePath) return;
    setLoading(true);
    try {
      const gitInfo = await window.loom.git?.status?.(workspacePath);
      if (gitInfo) {
        setCurrentBranch(gitInfo.branch || '');
        setChanges(gitInfo.changes || []);
      }
      // 分支列表按需拉取（不再随 status 周期返回，避免额外 git 进程）
      const br = await window.loom.git?.branches?.(workspacePath);
      if (Array.isArray(br)) setBranches(br);
      const log = await window.loom.git?.log?.(workspacePath, 10);
      setGitLog(log || []);
    } catch { /* git info unavailable */ }
    setLoading(false);
  }, [workspacePath]);

  useEffect(() => { refresh(); }, [refresh]);

  const stage = async (file: string) => { await window.loom.git?.stage?.(workspacePath, file); refresh(); };
  const unstage = async (file: string) => { await window.loom.git?.unstage?.(workspacePath, file); refresh(); };
  const commit = async () => {
    if (!commitMsg.trim()) return;
    setActionMsg(locale === 'zh-CN' ? '正在提交...' : 'Committing...');
    try {
      await window.loom.git?.commit?.(workspacePath, commitMsg);
      setCommitMsg('');
    } finally {
      setActionMsg('');
      refresh();
    }
  };
  const pull = async () => {
    setActionMsg(locale === 'zh-CN' ? '正在拉取...' : 'Pulling...');
    try {
      const r = await window.loom.git?.pull?.(workspacePath);
      setActionMsg(typeof r === 'string' && r.includes('Already up to date') ? (locale === 'zh-CN' ? '已是最新' : 'Up to date') : String(r).substring(0, 200) || (locale === 'zh-CN' ? '完成' : 'Done'));
    } catch (e: any) { setActionMsg('Error: ' + e.message); }
    setTimeout(() => setActionMsg(''), 3000);
    refresh();
  };
  const push = async () => {
    setActionMsg(locale === 'zh-CN' ? '正在推送...' : 'Pushing...');
    try {
      const r = await window.loom.git?.push?.(workspacePath);
      setActionMsg(typeof r === 'string' && r.includes('Everything up-to-date') ? (locale === 'zh-CN' ? '已是最新' : 'Up to date') : String(r).substring(0, 200) || (locale === 'zh-CN' ? '完成' : 'Done'));
    } catch (e: any) { setActionMsg('Error: ' + e.message); }
    setTimeout(() => setActionMsg(''), 3000);
    refresh();
  };
  const switchBranch = async (branch: string) => {
    if (branch === currentBranch) return;
    setActionMsg(locale === 'zh-CN' ? `切换到 ${branch}...` : `Switching to ${branch}...`);
    await window.loom.git?.checkout?.(workspacePath, branch);
    setActionMsg('');
    refresh();
    window.dispatchEvent(new CustomEvent('loom:refresh-tree'));
  };

  const statusColors: Record<string, string> = {
    'M': 'var(--yellow)', 'A': 'var(--green)', 'D': 'var(--red)',
    'U': 'var(--orange)', '?': 'var(--text-muted)', 'R': 'var(--cyan)',
  };
  return (
    <>
      <div className="sidebar-header">
        <span>{locale === 'zh-CN' ? '源码管理' : 'SOURCE CONTROL'}</span>
        <span style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'none' }}>{changes.length} {locale === 'zh-CN' ? '更改' : 'changes'}</span>
      </div>
      <div className="sidebar-content">
        {workspacePath ? (
          <div style={{ padding: '0 8px' }}>
            <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
              <button className="settings-btn-sm" onClick={pull} title="Git Pull">
                <svg viewBox="0 0 16 16" width="12" height="12" style={{ marginRight: 4 }}><path d="M8 1v10M4 7l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5"/></svg>
                {locale === 'zh-CN' ? '拉取' : 'Pull'}
              </button>
              <button className="settings-btn-sm" onClick={push} title="Git Push">
                <svg viewBox="0 0 16 16" width="12" height="12" style={{ marginRight: 4 }}><path d="M8 14V4M4 9l4-4 4 4" fill="none" stroke="currentColor" strokeWidth="1.5"/></svg>
                {locale === 'zh-CN' ? '推送' : 'Push'}
              </button>
              <button className={`settings-btn-sm ${showLog ? 'active' : ''}`} onClick={() => setShowLog(!showLog)} style={{ marginLeft: 'auto' }}>
                {locale === 'zh-CN' ? '历史' : 'Log'}
              </button>
            </div>

            {actionMsg && (
              <div style={{ fontSize: 11, color: 'var(--text-accent)', marginBottom: 8, padding: '4px 8px', background: 'var(--bg-hover)', borderRadius: 3 }}>
                {actionMsg}
              </div>
            )}

            {showLog && gitLog.length > 0 && (
              <div style={{ marginBottom: 8, maxHeight: 180, overflow: 'auto', borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>
                {gitLog.map((line, i) => (
                  <div key={i} style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--text-secondary)', padding: '2px 0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {line}
                  </div>
                ))}
              </div>
            )}

            <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
              <input
                className="search-input"
                style={{ flex: 1, height: 26 }}
                placeholder={locale === 'zh-CN' ? '提交说明 (Ctrl+Enter 提交)' : 'Message (Ctrl+Enter to commit)'}
                value={commitMsg}
                onChange={e => setCommitMsg(e.target.value)}
                onKeyDown={e => { if (e.ctrlKey && e.key === 'Enter') commit(); }}
              />
              <button className="settings-btn-sm primary" onClick={commit} disabled={!commitMsg.trim() || stagedChanges.length === 0}>{locale === 'zh-CN' ? '提交' : 'Commit'}</button>
            </div>

            {currentBranch && (
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 4 }}>
                <svg viewBox="0 0 16 16" width="12" height="12"><circle cx="4" cy="4" r="1.5" fill="currentColor"/><circle cx="4" cy="12" r="1.5" fill="currentColor"/><circle cx="12" cy="8" r="1.5" fill="currentColor"/><path d="M4 5.5v5M5.5 4h4.5a2 2 0 012 2v0" fill="none" stroke="currentColor" strokeWidth="1"/></svg>
                {currentBranch}
              </div>
            )}

            {loading && <div style={{ fontSize: 11, color: 'var(--text-muted)', padding: 4 }}>{locale === 'zh-CN' ? '正在加载...' : 'Loading...'}</div>}
            {!loading && changes.length === 0 && (
              <div className="panel-empty-state">
                <div>{workspacePath ? (locale === 'zh-CN' ? '没有更改' : 'No changes detected') : (locale === 'zh-CN' ? '未找到 Git 仓库' : 'No repository found')}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{workspacePath ? (locale === 'zh-CN' ? '工作区干净' : 'Working tree clean') : (locale === 'zh-CN' ? '请打开已初始化 Git 的文件夹' : 'Open a folder with git initialized')}</div>
              </div>
            )}

            {/* Staged Changes */}
            {stagedChanges.length > 0 && (
              <div style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4, textTransform: 'uppercase', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span>{locale === 'zh-CN' ? '已暂存的更改' : 'Staged Changes'} ({stagedChanges.length})</span>
                  <button className="settings-btn-sm" style={{ fontSize: 10, padding: '1px 6px' }} onClick={async () => {
                    for (const c of stagedChanges) await unstage(c.file);
                  }}>{locale === 'zh-CN' ? '全部取消暂存' : 'Unstage All'}</button>
                </div>
                {stagedChanges.map((c, i) => (
                  <div key={'s' + i} className="tree-item" style={{ paddingLeft: 4, gap: 4, fontSize: 12 }} title={c.file}>
                    <span style={{ width: 16, textAlign: 'center', color: statusColors[c.status] || 'var(--text-muted)', fontSize: 10, flexShrink: 0, fontWeight: 700 }}>
                      {c.status}
                    </span>
                    <span className="tree-item-name" style={{ fontSize: 12 }}>{c.file.split(/[\\/]/).pop()}</span>
                    <div style={{ marginLeft: 'auto', display: 'flex', gap: 2 }}>
                      <button className="sidebar-header-btn" title={locale === 'zh-CN' ? '取消暂存' : 'Unstage'} onClick={() => unstage(c.file)}>
                        <svg viewBox="0 0 16 16" width="12" height="12"><path d="M2 8l4-4 8 8" fill="none" stroke="currentColor" strokeWidth="1.5"/></svg>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Unstaged Changes */}
            {unstagedChanges.length > 0 && (
              <div style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4, textTransform: 'uppercase', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span>{locale === 'zh-CN' ? '更改' : 'Changes'} ({unstagedChanges.length})</span>
                  <button className="settings-btn-sm" style={{ fontSize: 10, padding: '1px 6px' }} onClick={async () => {
                    for (const c of unstagedChanges) await stage(c.file);
                  }}>{locale === 'zh-CN' ? '全部暂存' : 'Stage All'}</button>
                </div>
                {unstagedChanges.map((c, i) => (
                  <div key={'u' + i} className="tree-item" style={{ paddingLeft: 4, gap: 4, fontSize: 12 }} title={c.file}>
                    <span style={{ width: 16, textAlign: 'center', color: statusColors[c.status] || 'var(--text-muted)', fontSize: 10, flexShrink: 0, fontWeight: 700 }}>
                      {c.status}
                    </span>
                    <span className="tree-item-name" style={{ fontSize: 12 }}>{c.file.split(/[\\/]/).pop()}</span>
                    <div style={{ marginLeft: 'auto', display: 'flex', gap: 2 }}>
                      <button className="sidebar-header-btn" title={locale === 'zh-CN' ? '暂存' : 'Stage'} onClick={() => stage(c.file)}>
                        <svg viewBox="0 0 16 16" width="12" height="12"><path d="M2 8l4 4 8-8" fill="none" stroke="currentColor" strokeWidth="1.5"/></svg>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* All changes (fallback when no staged/unstaged separation works) */}
            {stagedChanges.length === 0 && unstagedChanges.length === 0 && changes.length > 0 && (
              changes.map((c, i) => (
                <div key={i} className="tree-item" style={{ paddingLeft: 4, gap: 4, fontSize: 12 }} title={c.file}>
                  <span style={{ width: 16, textAlign: 'center', color: statusColors[c.status] || 'var(--text-muted)', fontSize: 10, flexShrink: 0, fontWeight: 700 }}>
                    {c.status}
                  </span>
                  <span className="tree-item-name" style={{ fontSize: 12 }}>{c.file.split(/[\\/]/).pop()}</span>
                  <div style={{ marginLeft: 'auto', display: 'flex', gap: 2 }}>
                    <button className="sidebar-header-btn" title={locale === 'zh-CN' ? '暂存' : 'Stage'} onClick={() => stage(c.file)}>
                      <svg viewBox="0 0 16 16" width="12" height="12"><path d="M2 8l4 4 8-8" fill="none" stroke="currentColor" strokeWidth="1.5"/></svg>
                    </button>
                  </div>
                </div>
              ))
            )}

            {branches.length > 0 && (
              <div style={{ marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4, textTransform: 'uppercase' }}>{locale === 'zh-CN' ? '分支' : 'Branches'}</div>
                {branches.map(b => (
                  <div key={b} className="tree-item" style={{ paddingLeft: 8, fontSize: 12, color: b === currentBranch ? 'var(--accent)' : 'var(--text-primary)', gap: 6 }}
                    onClick={() => switchBranch(b)}>
                    {b === currentBranch && <span style={{ color: 'var(--accent)' }}>●</span>}
                    {b !== currentBranch && <span style={{ width: 10 }} />}
                    {b}
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="tree-empty">{locale === 'zh-CN' ? '未注册源码控制提供商' : 'No source control providers registered'}</div>
        )}
      </div>
    </>
  );
}
