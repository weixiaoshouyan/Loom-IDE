import React, { useCallback, useEffect, useState } from 'react';
import { t } from '@/shared/i18n';
import DiffViewModal from './DiffViewModal';
import { emitLoomEvent } from '../loom-events';

export default function SidebarGitView({ workspacePath, onOpenFile, locale }: {
  workspacePath: string;
  onOpenFile?: (path: string, content: string) => void;
  locale?: 'zh-CN' | 'en-US';
}) {
  const [branches, setBranches] = useState<string[]>([]);
  const [currentBranch, setCurrentBranch] = useState('');
  const [changes, setChanges] = useState<{ status: string; file: string }[]>([]);
  const [commitMsg, setCommitMsg] = useState('');
  const [loading, setLoading] = useState(false);
  const [gitLog, setGitLog] = useState<string[]>([]);
  const [showLog, setShowLog] = useState(false);
  const [actionMsg, setActionMsg] = useState('');
  const [diffTarget, setDiffTarget] = useState<{ file: string; original: string; modified: string } | null>(null);
  const [diffLoading, setDiffLoading] = useState<string | null>(null);

  // 点击变更项：打开文件并跳转到改动处（首次打开先落到第 1 行）
  const openChange = useCallback(async (file: string) => {
    if (!onOpenFile || !workspacePath) return;
    try {
      const abs = file.startsWith(workspacePath) ? file : workspacePath.replace(/[\\/]+$/, '') + '/' + file;
      const content = await window.loom.fs.readFile(abs);
      if (typeof content === 'string' && !content.startsWith('__ERR__:')) {
        onOpenFile(abs, content);
        emitLoomEvent('loom:go-to-line', { line: 1 });
      }
    } catch { /* file may have been deleted */ }
  }, [onOpenFile, workspacePath]);

  // 打开 diff 视图：HEAD/索引版本 vs 工作区内容
  const openDiff = useCallback(async (file: string) => {
    if (!workspacePath) return;
    setDiffLoading(file);
    try {
      const abs = file.startsWith(workspacePath) ? file : workspacePath.replace(/[\\/]+$/, '') + '/' + file;
      const [original, modified] = await Promise.all([
        window.loom.git?.show?.(workspacePath, file).catch(() => ''),
        window.loom.fs.readFile(abs).catch(() => ''),
      ]);
      const orig = typeof original === 'string' && !original.startsWith('__ERR__') ? original : '';
      const mod = typeof modified === 'string' && !modified.startsWith('__ERR__') ? modified : '';
      setDiffTarget({ file, original: orig, modified: mod });
    } catch { /* ignore */ }
    setDiffLoading(null);
  }, [workspacePath]);

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
    setActionMsg(t('git.committing'));
    try {
      await window.loom.git?.commit?.(workspacePath, commitMsg);
      setCommitMsg('');
    } finally {
      setActionMsg('');
      refresh();
    }
  };
  const pull = async () => {
    setActionMsg(t('git.pulling'));
    try {
      const r = await window.loom.git?.pull?.(workspacePath);
      setActionMsg(typeof r === 'string' && r.includes('Already up to date') ? t('git.upToDate') : String(r).substring(0, 200) || t('git.pullDone'));
    } catch (e: any) { setActionMsg(t('git.error') + e.message); }
    setTimeout(() => setActionMsg(''), 3000);
    refresh();
  };
  const push = async () => {
    setActionMsg(t('git.pushing'));
    try {
      const r = await window.loom.git?.push?.(workspacePath);
      setActionMsg(typeof r === 'string' && r.includes('Everything up-to-date') ? t('git.upToDate') : String(r).substring(0, 200) || t('git.pushDone'));
    } catch (e: any) { setActionMsg(t('git.error') + e.message); }
    setTimeout(() => setActionMsg(''), 3000);
    refresh();
  };
  const switchBranch = async (branch: string) => {
    if (branch === currentBranch) return;
    setActionMsg(t('git.switchToBranch', { branch }));
    await window.loom.git?.checkout?.(workspacePath, branch);
    setActionMsg('');
    refresh();
    emitLoomEvent('loom:refresh-tree', undefined);
  };

  const statusColors: Record<string, string> = {
    'M': 'var(--yellow)', 'A': 'var(--green)', 'D': 'var(--red)',
    'U': 'var(--orange)', '?': 'var(--text-muted)', 'R': 'var(--cyan)',
  };

  const renderChangeItem = (c: { status: string; file: string }, key: string, stageAction: (file: string) => void, stageTitle: string) => (
    <div key={key} className="tree-item" style={{ paddingLeft: 4, gap: 4, fontSize: 12, cursor: 'pointer' }} title={c.file} onClick={() => openChange(c.file)}>
      <span style={{ width: 16, textAlign: 'center', color: statusColors[c.status] || 'var(--text-muted)', fontSize: 10, flexShrink: 0, fontWeight: 700 }}>
        {c.status}
      </span>
      <span className="tree-item-name" style={{ fontSize: 12 }}>{c.file.split(/[\\/]/).pop()}</span>
      <div style={{ marginLeft: 'auto', display: 'flex', gap: 2 }} onClick={e => e.stopPropagation()}>
        {diffLoading === c.file
          ? <span style={{ fontSize: 10, color: 'var(--text-muted)', padding: '0 4px' }}>…</span>
          : (
            <button className="sidebar-header-btn" title={t('git.viewDiff')} onClick={() => openDiff(c.file)}>
              <svg viewBox="0 0 16 16" width="12" height="12"><path d="M1 4l4-2v10l-4 2V4zm5-2l4 2v10l-4-2V2zm5 2l4-2v10l-4 2V4z" fill="currentColor" /></svg>
            </button>
          )}
        <button className="sidebar-header-btn" title={stageTitle} onClick={() => stageAction(c.file)}>
          <svg viewBox="0 0 16 16" width="12" height="12"><path d="M2 8l4 4 8-8" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
        </button>
      </div>
    </div>
  );
  return (
    <>
      <div className="sidebar-header">
        <span>{t('git.title')}</span>
        <span style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'none' }}>{changes.length} {t('git.changes')}</span>
      </div>
      <div className="sidebar-content">
        {workspacePath ? (
          <div style={{ padding: '0 8px' }}>
            <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
              <button className="settings-btn-sm" onClick={pull} title="Git Pull">
                <svg viewBox="0 0 16 16" width="12" height="12" style={{ marginRight: 4 }}><path d="M8 1v10M4 7l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5"/></svg>
                {t('git.pull')}
              </button>
              <button className="settings-btn-sm" onClick={push} title="Git Push">
                <svg viewBox="0 0 16 16" width="12" height="12" style={{ marginRight: 4 }}><path d="M8 14V4M4 9l4-4 4 4" fill="none" stroke="currentColor" strokeWidth="1.5"/></svg>
                {t('git.push')}
              </button>
              <button className={`settings-btn-sm ${showLog ? 'active' : ''}`} onClick={() => setShowLog(!showLog)} style={{ marginLeft: 'auto' }}>
                {t('git.history')}
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
                placeholder={t('git.commitPlaceholder')}
                value={commitMsg}
                onChange={e => setCommitMsg(e.target.value)}
                onKeyDown={e => { if (e.ctrlKey && e.key === 'Enter') commit(); }}
              />
              <button className="settings-btn-sm primary" onClick={commit} disabled={!commitMsg.trim() || stagedChanges.length === 0}>{t('git.commit')}</button>
            </div>

            {currentBranch && (
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 4 }}>
                <svg viewBox="0 0 16 16" width="12" height="12"><circle cx="4" cy="4" r="1.5" fill="currentColor"/><circle cx="4" cy="12" r="1.5" fill="currentColor"/><circle cx="12" cy="8" r="1.5" fill="currentColor"/><path d="M4 5.5v5M5.5 4h4.5a2 2 0 012 2v0" fill="none" stroke="currentColor" strokeWidth="1"/></svg>
                {currentBranch}
              </div>
            )}

            {loading && <div style={{ fontSize: 11, color: 'var(--text-muted)', padding: 4 }}>{t('git.loading')}</div>}
            {!loading && changes.length === 0 && (
              <div className="panel-empty-state">
                <div>{workspacePath ? t('git.noChanges') : t('git.noRepo')}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{workspacePath ? t('git.cleanWorkingTree') : t('git.noRepoHint')}</div>
              </div>
            )}

            {/* Staged Changes */}
            {stagedChanges.length > 0 && (
              <div style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4, textTransform: 'uppercase', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span>{t('git.stagedChanges')} ({stagedChanges.length})</span>
                  <button className="settings-btn-sm" style={{ fontSize: 10, padding: '1px 6px' }} onClick={async () => {
                    for (const c of stagedChanges) await unstage(c.file);
                  }}>{t('git.unstageAll')}</button>
                </div>
                {stagedChanges.map((c, i) => renderChangeItem(c, 's' + i, unstage, t('git.unstage')))}
              </div>
            )}

            {/* Unstaged Changes */}
            {unstagedChanges.length > 0 && (
              <div style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4, textTransform: 'uppercase', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span>{t('git.changes')} ({unstagedChanges.length})</span>
                  <button className="settings-btn-sm" style={{ fontSize: 10, padding: '1px 6px' }} onClick={async () => {
                    for (const c of unstagedChanges) await stage(c.file);
                  }}>{t('git.stageAll')}</button>
                </div>
                {unstagedChanges.map((c, i) => renderChangeItem(c, 'u' + i, stage, t('git.stage')))}
              </div>
            )}

            {/* All changes (fallback when no staged/unstaged separation works) */}
            {stagedChanges.length === 0 && unstagedChanges.length === 0 && changes.length > 0 && (
              changes.map((c, i) => renderChangeItem(c, String(i), stage, t('git.stage')))
            )}

            {branches.length > 0 && (
              <div style={{ marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4, textTransform: 'uppercase' }}>{t('git.branch')}</div>
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
          <div className="tree-empty">{t('git.noProvider')}</div>
        )}
      </div>
      {diffTarget && (
        <DiffViewModal
          fileName={diffTarget.file}
          original={diffTarget.original}
          modified={diffTarget.modified}
          onClose={() => setDiffTarget(null)}
        />
      )}
    </>
  );
}
