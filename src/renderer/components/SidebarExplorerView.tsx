import React, { useState } from 'react';
import FileTree from './FileTree';
import { t } from '@/shared/i18n';

export default function SidebarExplorerView({ workspacePath, onOpenFile, onOpenFolder, onCloseFolder, selectedFile, gitStatusMap, locale }: {
  workspacePath: string; onOpenFile: (path: string, content: string) => void; onOpenFolder: () => void; onCloseFolder: () => void; selectedFile: string; gitStatusMap?: Record<string, string>; locale?: 'zh-CN' | 'en-US';
}) {
  const [creating, setCreating] = useState<'file' | 'folder' | null>(null);
  const [newName, setNewName] = useState('');

  const handleCreate = async () => {
    if (!newName.trim() || !workspacePath) return;
    const sep = workspacePath.includes('\\') ? '\\' : '/';
    const fullPath = workspacePath + sep + newName.trim();
    try {
      if (creating === 'file') {
        await window.loom.fs.writeFile(fullPath, '');
        onOpenFile(fullPath, '');
      } else if (creating === 'folder') {
        await window.loom.fs.mkdir(fullPath);
      }
      window.dispatchEvent(new CustomEvent('loom:refresh-tree'));
    } catch (e: any) {
      window.dispatchEvent(new CustomEvent('loom:notify', { detail: { message: `${t('sidebar.createFailed')}: ${e.message}`, type: 'error' } }));
    }
    setCreating(null);
    setNewName('');
  };

  return (
    <>
      <div className="sidebar-header">
        <span title={workspacePath}>
          {workspacePath
            ? workspacePath.split(/[\\/]/).pop()?.toUpperCase() || 'EXPLORER'
            : t('sidebar.explorer')}
        </span>
        <div className="sidebar-header-actions">
          <button className="sidebar-header-btn" title={t('sidebar.newFile')} aria-label={t('sidebar.newFile')} onClick={() => { setCreating('file'); setNewName(''); }}>
            <svg viewBox="0 0 16 16" width="16" height="16"><path d="M9 1H4a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2V6l-5-5z" fill="none" stroke="currentColor" strokeWidth="1"/><path d="M9 1v5h5" fill="none" stroke="currentColor" strokeWidth="1"/></svg>
          </button>
          <button className="sidebar-header-btn" title={t('sidebar.newFolder')} aria-label={t('sidebar.newFolder')} onClick={() => { setCreating('folder'); setNewName(''); }}>
            <svg viewBox="0 0 16 16" width="16" height="16"><path d="M1 3a1 1 0 011-1h3.146a.5.5 0 01.354.146L6.707 3.354a.5.5 0 00.354.146H14a1 1 0 011 1v8a1 1 0 01-1 1H2a1 1 0 01-1-1V3z" fill="none" stroke="currentColor" strokeWidth="1"/></svg>
          </button>
          <button className="sidebar-header-btn" title={t('sidebar.refresh')} aria-label={t('sidebar.refresh')} onClick={() => window.dispatchEvent(new CustomEvent('loom:refresh-tree'))}>
            <svg viewBox="0 0 16 16" width="16" height="16"><path d="M13 8a5 5 0 01-9.33 2" fill="none" stroke="currentColor" strokeWidth="1.2"/><path d="M3 8a5 5 0 019.33-2" fill="none" stroke="currentColor" strokeWidth="1.2"/><path d="M11 4l2 2-2 2" fill="none" stroke="currentColor" strokeWidth="1.2"/><path d="M5 12L3 10l2-2" fill="none" stroke="currentColor" strokeWidth="1.2"/></svg>
          </button>
          <button className="sidebar-header-btn" title={t('sidebar.openFolder')} aria-label={t('sidebar.openFolder')} onClick={onOpenFolder}>
            <svg viewBox="0 0 16 16" width="16" height="16"><path d="M1 3.5A1.5 1.5 0 012.5 2h3.146a.5.5 0 01.354.146L7.207 3.293a.5.5 0 00.354.146H13.5A1.5 1.5 0 0115 4.5v8a1.5 1.5 0 01-1.5 1.5h-11A1.5 1.5 0 011 12.5v-9z" fill="none" stroke="currentColor" strokeWidth="1"/></svg>
          </button>
          {workspacePath && (
            <button className="sidebar-header-btn" title={t('sidebar.closeFolder')} aria-label={t('sidebar.closeFolder')} onClick={onCloseFolder}>
              <svg viewBox="0 0 16 16" width="16" height="16"><path d="M2 4a1.5 1.5 0 011.5-1.5h2.8l1.2 1.2H13A1.5 1.5 0 0114.5 5.2V12A1.5 1.5 0 0113 13.5H3A1.5 1.5 0 011.5 12V4z" fill="none" stroke="currentColor" strokeWidth="1"/><path d="M6 7l4 4M10 7l-4 4" fill="none" stroke="currentColor" strokeWidth="1.4"/></svg>
            </button>
          )}
        </div>
      </div>
      <div className="sidebar-content">
        {workspacePath ? (
          <div className="sidebar-section">
            {creating && (
              <div style={{ padding: '6px 10px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 6, alignItems: 'center' }}>
                <input
                  className="search-input"
                  style={{ flex: 1, height: 24, fontSize: 12 }}
                  placeholder={creating === 'file' ? t('sidebar.fileNamePlaceholder') : t('sidebar.folderNamePlaceholder')}
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') { setCreating(null); setNewName(''); } }}
                  autoFocus
                />
                <button className="settings-btn-sm primary" onClick={handleCreate} disabled={!newName.trim()}>OK</button>
                <button className="settings-btn-sm" onClick={() => { setCreating(null); setNewName(''); }} aria-label={t('sidebar.cancel')}>×</button>
              </div>
            )}
            <FileTree workspacePath={workspacePath} onOpenFile={onOpenFile} selectedFile={selectedFile} gitStatusMap={gitStatusMap} />
          </div>
        ) : (
          <div style={{ padding: '24px 16px', textAlign: 'center' }}>
            <p style={{ color: 'var(--text-muted)', fontSize: '12px', marginBottom: '12px' }}>
              {t('sidebar.noFolderOpen')}
            </p>
            <button className="settings-btn-sm primary" onClick={onOpenFolder}>
              {t('sidebar.openFolder')}
            </button>
          </div>
        )}
      </div>
    </>
  );
}
