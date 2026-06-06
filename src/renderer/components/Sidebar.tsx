import React, { useEffect, useState } from 'react';

interface FileEntry {
  name: string;
  isDirectory: boolean;
  path: string;
}

interface Props {
  tab: 'files' | 'agent';
  workspacePath: string;
  onOpenFile: (path: string, content: string) => void;
}

export default function Sidebar({ tab, workspacePath, onOpenFile }: Props) {
  const [files, setFiles] = useState<FileEntry[]>([]);

  useEffect(() => {
    if (!workspacePath) { setFiles([]); return; }
    (window as any).loom.fs.readDir(workspacePath).then((entries: FileEntry[]) => {
      setFiles(entries.sort((a, b) => {
        if (a.isDirectory && !b.isDirectory) return -1;
        if (!a.isDirectory && b.isDirectory) return 1;
        return a.name.localeCompare(b.name);
      }));
    });
  }, [workspacePath]);

  if (tab === 'agent') {
    return (
      <div className="sidebar">
        <div className="sidebar-header">Orca 智能体</div>
        <div className="sidebar-content">
          <p className="sidebar-hint">智能体面板在右侧打开</p>
        </div>
      </div>
    );
  }

  return (
    <div className="sidebar">
      <div className="sidebar-header">资源管理器</div>
      <div className="sidebar-content">
        {!workspacePath ? (
          <p className="sidebar-hint">尚未打开文件夹</p>
        ) : (
          <div className="file-tree">
            <div className="tree-folder-header">
              <span className="tree-icon">📁</span>
              <span className="tree-name">{workspacePath.split(/[/\\]/).pop()}</span>
            </div>
            <div className="tree-children">
              {files.map((f) => (
                <div
                  key={f.path}
                  className="tree-item"
                  onClick={async () => {
                    if (f.isDirectory) return;
                    const content = await (window as any).loom.fs.readFile(f.path);
                    onOpenFile(f.path, content);
                  }}
                >
                  <span className="tree-icon">{f.isDirectory ? '📁' : '📄'}</span>
                  <span className="tree-name">{f.name}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
