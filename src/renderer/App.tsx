import React, { useState } from 'react';
import TitleBar from './components/TitleBar';
import Sidebar from './components/Sidebar';
import Editor from './components/Editor';
import AIAgent from './components/AIAgent';
import StatusBar from './components/StatusBar';

export interface OpenFile {
  path: string;
  name: string;
  content: string;
  language: string;
}

export default function App() {
  const [sidebarTab, setSidebarTab] = useState<'files' | 'agent'>('files');
  const [openFiles, setOpenFiles] = useState<OpenFile[]>([]);
  const [activeFileIdx, setActiveFileIdx] = useState(0);
  const [workspacePath, setWorkspacePath] = useState<string>('');
  const [agentOpen, setAgentOpen] = useState(true);

  const detectLanguage = (filename: string): string => {
    const ext = filename.split('.').pop()?.toLowerCase() || '';
    const map: Record<string, string> = {
      ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
      py: 'python', go: 'go', rs: 'rust', json: 'json', md: 'markdown',
      css: 'css', html: 'html', yml: 'yaml', yaml: 'yaml', sh: 'shell',
      cpp: 'cpp', c: 'c', java: 'java', rb: 'ruby', php: 'php',
    };
    return map[ext] || 'plaintext';
  };

  const handleOpenFile = async () => {
    const result = await (window as any).loom.dialog.openFile();
    if (!result) return;
    const newFile: OpenFile = {
      path: result.path,
      name: result.path.split(/[/\\]/).pop() || 'untitled',
      content: result.content,
      language: detectLanguage(result.path),
    };
    const existing = openFiles.findIndex((f) => f.path === newFile.path);
    if (existing >= 0) {
      setActiveFileIdx(existing);
    } else {
      setOpenFiles([...openFiles, newFile]);
      setActiveFileIdx(openFiles.length);
    }
  };

  const handleOpenFolder = async () => {
    const folder = await (window as any).loom.dialog.openFolder();
    if (folder) setWorkspacePath(folder);
  };

  const activeFile = openFiles[activeFileIdx] || null;

  return (
    <div className="app">
      <TitleBar onOpenFile={handleOpenFile} onOpenFolder={handleOpenFolder} />
      <div className="main-layout">
        <div className="activity-bar">
          <button className={`activity-icon ${sidebarTab === 'files' ? 'active' : ''}`} onClick={() => setSidebarTab('files')} title="资源管理器">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"/></svg>
          </button>
          <button className={`activity-icon ${sidebarTab === 'agent' ? 'active' : ''}`} onClick={() => setSidebarTab('agent')} title="Orca 智能体">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>
          </button>
        </div>

        <Sidebar
          tab={sidebarTab}
          workspacePath={workspacePath}
          onOpenFile={(path, content) => {
            const newFile: OpenFile = { path, name: path.split(/[/\\]/).pop() || 'untitled', content, language: detectLanguage(path) };
            const existing = openFiles.findIndex((f) => f.path === path);
            if (existing >= 0) { setActiveFileIdx(existing); }
            else { setOpenFiles([...openFiles, newFile]); setActiveFileIdx(openFiles.length); }
          }}
        />

        <div className="editor-area">
          {openFiles.length > 0 && (
            <div className="tabs">
              {openFiles.map((f, i) => (
                <div key={f.path} className={`tab ${i === activeFileIdx ? 'active' : ''}`} onClick={() => setActiveFileIdx(i)}>
                  <span>{f.name}</span>
                  <button className="tab-close" onClick={(e) => { e.stopPropagation(); const nf = openFiles.filter((_, j) => j !== i); setOpenFiles(nf); if (activeFileIdx >= nf.length) setActiveFileIdx(Math.max(0, nf.length - 1)); }}>×</button>
                </div>
              ))}
            </div>
          )}
          <Editor file={activeFile} />
        </div>

        {agentOpen && <AIAgent workspacePath={workspacePath} onClose={() => setAgentOpen(false)} />}
      </div>
      <StatusBar workspacePath={workspacePath} activeFile={activeFile} />
    </div>
  );
}
