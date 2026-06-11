import React, { useState, useEffect } from 'react';

interface Props {
  onOpenFile: () => void;
  onOpenFolder: () => void;
  onNewFile: () => void;
  onOpenSettings: () => void;
}

export default function WelcomePage({ onOpenFile, onOpenFolder, onNewFile, onOpenSettings }: Props) {
  const [recentFolders, setRecentFolders] = useState<string[]>([]);
  const [recentFiles, setRecentFiles] = useState<string[]>([]);

  useEffect(() => {
    (window as any).loom?.recent?.getFolders?.().then((folders: string[]) => {
      setRecentFolders(folders || []);
    }).catch(() => {});
  }, []);

  return (
    <div className="welcome-page">
      <div className="welcome-columns">
        {/* Start Column */}
        <div className="welcome-column">
          <div className="welcome-logo-wrap">
            <svg viewBox="0 0 256 256" width="72" height="72">
              <defs>
                <linearGradient id="wlg2" x1="0" y1="1" x2="1" y2="0">
                  <stop offset="0%" stopColor="#007acc"/><stop offset="100%" stopColor="#4ec9b0"/>
                </linearGradient>
              </defs>
              <rect width="256" height="256" rx="48" fill="#1a1a2e"/>
              <circle cx="128" cy="128" r="96" fill="none" stroke="url(#wlg2)" strokeWidth="2" opacity="0.3"/>
              <path d="M72 52 L72 200 L168 200" fill="none" stroke="url(#wlg2)" strokeWidth="10" strokeLinecap="round" strokeLinejoin="round"/>
              <circle cx="128" cy="128" r="6" fill="#4ec9b0" opacity="0.9"/>
            </svg>
            <div className="welcome-title-wrap">
              <h1 className="welcome-title">Loom IDE</h1>
              <span className="welcome-version">v0.2.0</span>
            </div>
          </div>
          <div className="welcome-section">
            <h3 className="welcome-section-title">Start</h3>
            <div className="welcome-item" onClick={onNewFile}>
              <svg viewBox="0 0 16 16" width="16" height="16"><path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.2"/></svg>
              <span>New File</span>
              <span className="welcome-keybinding"><kbd>Ctrl</kbd><kbd>N</kbd></span>
            </div>
            <div className="welcome-item" onClick={onOpenFile}>
              <svg viewBox="0 0 16 16" width="16" height="16"><path d="M4 1.5H3a2 2 0 00-2 2v9a2 2 0 002 2h10a2 2 0 002-2V4.5" fill="none" stroke="currentColor" strokeWidth="1"/><path d="M9 1.5v4a.5.5 0 00.5.5h4" fill="none" stroke="currentColor" strokeWidth="1"/></svg>
              <span>Open File...</span>
              <span className="welcome-keybinding"><kbd>Ctrl</kbd><kbd>O</kbd></span>
            </div>
            <div className="welcome-item" onClick={onOpenFolder}>
              <svg viewBox="0 0 16 16" width="16" height="16"><path d="M1.5 3A1.5 1.5 0 013 1.5h3.146a.5.5 0 01.354.146L7.707 2.854a.5.5 0 00.354.146H13A1.5 1.5 0 0114.5 4.5v8A1.5 1.5 0 0113 14H3A1.5 1.5 0 011.5 12.5V3z" fill="none" stroke="currentColor" strokeWidth="1"/></svg>
              <span>Open Folder...</span>
              <span className="welcome-keybinding"><kbd>Ctrl</kbd><kbd>K</kbd></span>
            </div>
          </div>
        </div>

        {/* Recent Column */}
        <div className="welcome-column">
          <div className="welcome-section">
            <h3 className="welcome-section-title">Recent</h3>
            {recentFolders.length > 0 ? (
              recentFolders.slice(0, 8).map((folder, i) => (
                <div key={i} className="welcome-item welcome-recent-link" onClick={onOpenFolder}>
                  <svg viewBox="0 0 16 16" width="14" height="14" style={{ flexShrink: 0 }}><path d="M1.5 3A1.5 1.5 0 013 1.5h3.146a.5.5 0 01.354.146L7.707 2.854a.5.5 0 00.354.146H13A1.5 1.5 0 0114.5 4.5v8A1.5 1.5 0 0113 14H3A1.5 1.5 0 011.5 12.5V3z" fill="currentColor" opacity="0.6"/></svg>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{folder.split(/[\\/]/).pop()}</span>
                  <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 140 }}>{folder}</span>
                </div>
              ))
            ) : (
              <div className="welcome-empty">No recent folders</div>
            )}
          </div>
        </div>

        {/* Help Column */}
        <div className="welcome-column">
          <div className="welcome-section">
            <h3 className="welcome-section-title">Help</h3>
            <div className="welcome-item" onClick={onOpenSettings}>
              <svg viewBox="0 0 16 16" width="16" height="16"><path d="M8 5a3 3 0 100 6 3 3 0 000-6zM6 8a2 2 0 114 0 2 2 0 01-4 0z" fill="currentColor"/><path d="M8 1l.8.5.9-.2.8.4.4.8.8.6-.1.9.4.8.8.4-.3.9.3.8-.6.6.1.9-.7.6-.2.9-.8.1-.8-.4-.8.2L8 15l-.7-.7-.8-.2-.8.4-.8-.1-.2-.9-.7-.6.1-.9-.6-.6.3-.8-.3-.9.8-.4.4-.8-.1-.9.8-.6.4-.8.9.2.8-.5z" fill="none" stroke="currentColor" strokeWidth="0.7"/></svg>
              <span>Settings</span>
              <span className="welcome-keybinding"><kbd>Ctrl</kbd><kbd>,</kbd></span>
            </div>
            <div className="welcome-item" onClick={() => window.dispatchEvent(new CustomEvent('loom:cmd', { detail: 'openFolder' }))}>
              <svg viewBox="0 0 16 16" width="16" height="16"><path d="M8 1a7 7 0 100 14A7 7 0 008 1zm0 12.5a5.5 5.5 0 110-11 5.5 5.5 0 010 11zM7.25 5h1.5v1.5h-1.5V5zm0 2.5h1.5v4h-1.5v-4z" fill="currentColor"/></svg>
              <span>Documentation</span>
            </div>
            <div className="welcome-item" onClick={() => window.dispatchEvent(new CustomEvent('loom:cmd', { detail: 'openFolder' }))}>
              <svg viewBox="0 0 16 16" width="16" height="16"><path d="M8 1C4.13 1 1 4.13 1 8c0 3.1 2 5.7 4.8 6.6.4.07.5-.17.5-.38 0-.19-.01-.82-.01-1.49-1.77.38-2.15-.87-2.15-.87-.29-.73-.71-.92-.71-.92-.58-.4.04-.39.04-.39.64.04.98.66.98.66.57.97 1.49.69 1.85.53.06-.41.22-.69.4-.85-1.42-.16-2.92-.71-2.92-3.15 0-.7.25-1.27.66-1.72-.07-.16-.29-.81.06-1.68 0 0 .54-.17 1.77.66a6.17 6.17 0 013.22 0c1.22-.83 1.77-.66 1.77-.66.35.87.13 1.52.06 1.68.41.45.66 1.02.66 1.72 0 2.45-1.5 2.99-2.93 3.15.23.2.44.6.44 1.21 0 .88-.01 1.58-.01 1.8 0 .21.11.46.5.38A7.01 7.01 0 0015 8c0-3.87-3.13-7-7-7z" fill="currentColor"/></svg>
              <span>GitHub</span>
            </div>
          </div>

          <div className="welcome-section">
            <h3 className="welcome-section-title">Keyboard Shortcuts</h3>
            <div className="welcome-shortcuts-grid">
              {[
                ['Ctrl+Shift+P', 'Command Palette'],
                ['Ctrl+P', 'Quick Open'],
                ['Ctrl+N', 'New File'],
                ['Ctrl+\\\\', 'Split Editor'],
                ['Ctrl+B', 'Toggle Sidebar'],
                ['Ctrl+`', 'Toggle Terminal'],
              ].map(([key, label]) => (
                <div key={key} className="welcome-shortcut-row">
                  <kbd className="welcome-kbd">{key}</kbd>
                  <span>{label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
