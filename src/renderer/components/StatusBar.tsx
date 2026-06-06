import React from 'react';
import type { OpenFile } from '../App';

interface Props {
  workspacePath: string;
  activeFile: OpenFile | null;
}

export default function StatusBar({ workspacePath, activeFile }: Props) {
  return (
    <div className="status-bar">
      <div className="status-left">
        <span className="status-item">⬡ 织网 IDE</span>
        {workspacePath && <span className="status-item">{workspacePath.split(/[/\\]/).pop()}</span>}
      </div>
      <div className="status-right">
        {activeFile && <span className="status-item">{activeFile.language}</span>}
        <span className="status-item">UTF-8</span>
        <span className="status-item">Ln 1, Col 1</span>
      </div>
    </div>
  );
}
