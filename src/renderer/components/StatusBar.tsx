import React, { useState, useEffect } from 'react';
import type { OpenFile } from '../App';

interface Props {
  workspacePath: string;
  activeFile: OpenFile | null;
  agentStatus?: 'online' | 'offline';
}

export default function StatusBar({ workspacePath, activeFile, agentStatus = 'offline' }: Props) {
  const [cursor, setCursor] = useState({ line: 1, col: 1 });

  useEffect(() => { setCursor({ line: 1, col: 1 }); }, [activeFile?.path]);

  useEffect(() => {
    const handler = (e: CustomEvent) => setCursor({ line: e.detail.line, col: e.detail.column });
    window.addEventListener('loom:cursor-change' as any, handler);
    return () => window.removeEventListener('loom:cursor-change' as any, handler);
  }, []);

  return (
    <div className="statusbar">
      <div className="statusbar-left">
        <div className="statusbar-item" style={{ background: agentStatus === 'online' ? 'rgba(106,153,85,0.8)' : 'rgba(150,150,150,0.5)' }}>
          <svg viewBox="0 0 16 16" width="12" height="12"><circle cx="8" cy="8" r="5" fill="none" stroke="currentColor" strokeWidth="1.2"/><circle cx="8" cy="8" r="2" fill="currentColor"/></svg>
          Orca {agentStatus === 'online' ? 'Online' : 'Offline'}
        </div>
        {workspacePath && (
          <div className="statusbar-item">
            <svg viewBox="0 0 16 16" width="12" height="12"><path d="M1.5 3A1.5 1.5 0 013 1.5h3.146a.5.5 0 01.354.146L7.707 2.854a.5.5 0 00.354.146H13A1.5 1.5 0 0114.5 4.5v8A1.5 1.5 0 0113 14H3A1.5 1.5 0 011.5 12.5V3z" fill="none" stroke="currentColor" strokeWidth="1"/></svg>
            {workspacePath.split(/[\\/]/).pop()}
          </div>
        )}
      </div>
      <div className="statusbar-right">
        {activeFile && <div className="statusbar-item">Ln {cursor.line}, Col {cursor.col}</div>}
        {activeFile && <div className="statusbar-item">Spaces: 2</div>}
        {activeFile && <div className="statusbar-item">{activeFile.language.charAt(0).toUpperCase() + activeFile.language.slice(1)}</div>}
        <div className="statusbar-item">UTF-8</div>
        <div className="statusbar-item">LF</div>
      </div>
    </div>
  );
}
