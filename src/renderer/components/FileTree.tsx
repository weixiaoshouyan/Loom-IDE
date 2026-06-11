import React, { useState, useEffect, useCallback } from 'react';
import { getFileIcon } from './FileIcons';

interface FileEntry {
  name: string;
  isDirectory: boolean;
  path: string;
}

interface TreeItemProps {
  entry: FileEntry;
  depth: number;
  onOpenFile: (path: string, content: string) => void;
  selectedFile: string;
  onRefresh: () => void;
  gitStatusMap?: Record<string, string>;
  workspacePath?: string;
}

const HIDDEN = new Set(['node_modules', '.git', '.vscode', 'dist', 'release', '__pycache__', '.next', 'coverage']);

// Context menu component
function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: { label: string; action: () => void; separator?: boolean; disabled?: boolean }[]; onClose: () => void }) {
  useEffect(() => {
    const handler = () => onClose();
    window.addEventListener('click', handler);
    return () => window.removeEventListener('click', handler);
  }, [onClose]);

  return (
    <>
      <div className="context-menu-overlay" onClick={onClose} />
      <div className="context-menu" style={{ position: 'fixed', left: x, top: y, zIndex: 1000 }}>
        {items.map((item, j) =>
          item.separator ? <div key={j} className="context-menu-sep" /> :
          <div key={j} className={`context-menu-item ${item.disabled ? 'disabled' : ''}`}
            onClick={() => { if (!item.disabled) { item.action(); onClose(); } }}>
            <span>{item.label}</span>
          </div>
        )}
      </div>
    </>
  );
}

function TreeItem({ entry, depth, onOpenFile, selectedFile, onRefresh, gitStatusMap, workspacePath }: TreeItemProps) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<FileEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState(entry.name);
  const [deleting, setDeleting] = useState(false);
  const [creatingInDir, setCreatingInDir] = useState<'file' | 'folder' | null>(null);
  const [newItemName, setNewItemName] = useState('');

  const handleClick = useCallback(async () => {
    if (entry.isDirectory) {
      if (!expanded && !loaded) {
        try {
          const entries: FileEntry[] = await (window as any).loom.fs.readDir(entry.path);
          setChildren(entries.sort((a, b) => {
            if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
            return a.name.localeCompare(b.name);
          }).filter(e => !HIDDEN.has(e.name)));
          setLoaded(true);
        } catch { setChildren([]); }
      }
      setExpanded(!expanded);
    } else {
      try {
        const content = await (window as any).loom.fs.readFile(entry.path);
        onOpenFile(entry.path, content);
      } catch {}
    }
  }, [entry, expanded, loaded, onOpenFile]);

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({ x: e.clientX, y: e.clientY });
  };

  const handleRename = async () => {
    if (!newName.trim() || newName === entry.name) { setRenaming(false); return; }
    try {
      const sep = entry.path.includes('\\') ? '\\' : '/';
      const dir = entry.path.substring(0, entry.path.lastIndexOf(sep));
      const newPath = dir + sep + newName.trim();
      await (window as any).loom.fs.rename(entry.path, newPath);
      onRefresh();
    } catch (e: any) {
      console.error('Rename failed:', e.message);
    }
    setRenaming(false);
  };

  const handleDelete = async () => {
    if (!window.confirm(`Delete "${entry.name}"? ${entry.isDirectory ? 'This will remove the entire folder and its contents.' : 'This action cannot be undone.'}`)) return;
    setDeleting(true);
    try {
      await (window as any).loom.fs.deletePath(entry.path);
      onRefresh();
    } catch (e: any) {
      window.dispatchEvent(new CustomEvent('loom:notify', { detail: { message: `Delete failed: ${e.message}`, type: 'error' } }));
    }
    setDeleting(false);
  };

  const handleCreateInDir = async () => {
    if (!newItemName.trim() || !entry.isDirectory) return;
    const sep = entry.path.includes('\\') ? '\\' : '/';
    const fullPath = entry.path + sep + newItemName.trim();
    try {
      if (creatingInDir === 'file') {
        await (window as any).loom.fs.writeFile(fullPath, '');
      } else if (creatingInDir === 'folder') {
        await (window as any).loom.fs.mkdir(fullPath);
      }
      onRefresh();
      // Auto-expand directory
      if (!expanded) {
        setExpanded(true);
        if (!loaded) {
          const entries: FileEntry[] = await (window as any).loom.fs.readDir(entry.path);
          setChildren(entries.sort((a, b) => {
            if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
            return a.name.localeCompare(b.name);
          }).filter(e => !HIDDEN.has(e.name)));
          setLoaded(true);
        }
      }
    } catch (e: any) {
      console.error('Failed to create:', e.message);
    }
    setCreatingInDir(null);
    setNewItemName('');
  };

  if (HIDDEN.has(entry.name)) return null;
  const icon = getFileIcon(entry.name, entry.isDirectory, expanded);
  const isSelected = selectedFile === entry.path;
  
  // Git status
  const relativePath = workspacePath ? entry.path.replace(workspacePath, '').replace(/^[\\/]/, '').replace(/\\/g, '/') : entry.name;
  const gitStatus = !entry.isDirectory && gitStatusMap ? gitStatusMap[relativePath] : undefined;
  const gitColor = gitStatus === 'M' ? 'var(--git-modified)' :
    gitStatus === 'A' || gitStatus === '?' ? 'var(--git-added)' :
    gitStatus === 'D' ? 'var(--git-deleted)' :
    gitStatus === 'R' ? 'var(--git-added)' : undefined;
  const gitLabel = gitStatus === 'M' ? 'M' : gitStatus === 'A' ? 'A' : gitStatus === 'D' ? 'D' :
    gitStatus === '?' ? 'U' : gitStatus === 'R' ? 'R' : undefined;

  const ctxItems = entry.isDirectory
    ? [
        { label: 'New File...', action: () => { setCreatingInDir('file'); setNewItemName(''); } },
        { label: 'New Folder...', action: () => { setCreatingInDir('folder'); setNewItemName(''); } },
        { separator: true, label: '' },
        { label: 'Copy Path', action: () => navigator.clipboard?.writeText(entry.path) },
        { label: 'Rename', action: () => setRenaming(true) },
        { separator: true, label: '' },
        { label: 'Delete', action: handleDelete },
      ]
    : [
        { label: 'Open', action: handleClick },
        { label: 'Rename', action: () => setRenaming(true) },
        { separator: true, label: '' },
        { label: 'Copy Path', action: () => navigator.clipboard?.writeText(entry.path) },
        { label: 'Copy Relative Path', action: () => navigator.clipboard?.writeText(entry.name) },
        { separator: true, label: '' },
        { label: 'Delete', action: handleDelete },
      ];

  if (deleting) {
    return (
      <div className="tree-item" style={{ paddingLeft: depth * 16 + 'px', color: 'var(--text-muted)', fontStyle: 'italic' }}>
        Deleting...
      </div>
    );
  }

  return (
    <>
      <div className={`tree-item ${isSelected ? 'selected' : ''}`}
        style={{ paddingLeft: depth * 16 + 'px' }}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
      >
        {entry.isDirectory ? (
          <span className={`tree-item-arrow ${expanded ? 'expanded' : ''}`}>
            <svg viewBox="0 0 16 16"><path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.5"/></svg>
          </span>
        ) : (
          <span style={{ width: 16 }} />
        )}
        <span className="tree-item-icon">{icon.svg}</span>
        {renaming ? (
          <input
            className="tree-rename-input"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') handleRename();
              if (e.key === 'Escape') { setRenaming(false); setNewName(entry.name); }
            }}
            onBlur={() => handleRename()}
            autoFocus
            onClick={e => e.stopPropagation()}
            style={{ flex: 1, height: 18, fontSize: 12, padding: '0 4px', background: 'var(--bg-input)', border: '1px solid var(--border-focus)', color: 'var(--text-primary)' }}
          />
        ) : (
          <span className="tree-item-name" style={gitColor ? { color: gitColor } : undefined}>
            {entry.name}
            {gitLabel && <span className="git-status-badge" style={{ color: gitColor }}>{gitLabel}</span>}
          </span>
        )}
      </div>
      {creatingInDir && ctxMenu === null && (
        <div style={{ paddingLeft: (depth + 1) * 16 + 'px', padding: '4px 8px 4px ' + ((depth + 1) * 16) + 'px', display: 'flex', gap: 4, alignItems: 'center' }}>
          <input className="search-input" style={{ flex: 1, height: 20, fontSize: 12 }}
            placeholder={creatingInDir === 'file' ? 'filename.ext' : 'folder name'}
            value={newItemName} onChange={e => setNewItemName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleCreateInDir(); if (e.key === 'Escape') { setCreatingInDir(null); setNewItemName(''); } }}
            autoFocus />
          <button className="settings-btn-sm" onClick={handleCreateInDir} disabled={!newItemName.trim()} style={{ fontSize: 10, padding: '2px 6px' }}>OK</button>
        </div>
      )}
      {expanded && entry.isDirectory && children.map(child => (
        <TreeItem key={child.path} entry={child} depth={depth + 1} onOpenFile={onOpenFile} selectedFile={selectedFile} onRefresh={onRefresh} gitStatusMap={gitStatusMap} workspacePath={workspacePath} />
      ))}
      {ctxMenu && <ContextMenu x={ctxMenu.x} y={ctxMenu.y} items={ctxItems} onClose={() => setCtxMenu(null)} />}
    </>
  );
}

// Outline View
export function OutlineView({ filePath, onOpenFile }: { filePath: string; onOpenFile: (path: string, content: string) => void }) {
  const [symbols, setSymbols] = useState<{ name: string; kind: string; line: number; containerName?: string }[]>([]);

  useEffect(() => {
    if (!filePath) { setSymbols([]); return; }
    // Use Monaco's language service to get document symbols
    // For now display basic info based on file extension
    const ext = filePath.split('.').pop()?.toLowerCase() || '';
    setSymbols([]);
    // Monaco document symbols would be fetched via editor
    const fetchSymbols = async () => {
      try {
        const content = await (window as any).loom.fs.readFile(filePath);
        const lines = content.split('\n');
        const found: typeof symbols = [];
        lines.forEach((line: string, i: number) => {
          const trimmed = line.trim();
          // Detect function/method definitions
          const funcMatch = trimmed.match(/^(export\s+)?(async\s+)?(function|class|const|let|var)\s+(\w+)/);
          if (funcMatch) {
            found.push({ name: funcMatch[4], kind: funcMatch[3] === 'class' ? 'class' : 'function', line: i + 1 });
          }
          // Detect import statements
          if (trimmed.startsWith('import ')) {
            found.push({ name: trimmed.substring(0, 60) + (trimmed.length > 60 ? '...' : ''), kind: 'module', line: i + 1 });
          }
          // Detect interface/type
          const typeMatch = trimmed.match(/^(export\s+)?(interface|type|enum)\s+(\w+)/);
          if (typeMatch) {
            found.push({ name: typeMatch[3], kind: typeMatch[2], line: i + 1 });
          }
        });
        setSymbols(found);
      } catch {}
    };
    fetchSymbols();
  }, [filePath]);

  const kindIcons: Record<string, string> = {
    function: '\u0192', class: 'C', module: 'M', interface: 'I', type: 'T', enum: 'E',
  };

  if (symbols.length === 0) {
    return (
      <div className="panel-empty-state">
        <svg viewBox="0 0 16 16" width="24" height="24" style={{ color: 'var(--text-muted)', marginBottom: 8 }}><path d="M14 2H2v12h12V2zM3 3v10h10V3H3zm2 2h6v1H5V5zm0 3h6v1H5V8zm0 3h4v1H5v-1z" fill="currentColor"/></svg>
        <div>{filePath ? 'No symbols found' : 'No file opened'}</div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>{filePath ? 'Open a code file to see symbols' : 'Open a file to view its outline'}</div>
      </div>
    );
  }

  return (
    <div className="file-tree">
      {symbols.map((s, i) => (
        <div key={i} className="tree-item" style={{ paddingLeft: 8, gap: 6 }}
          onClick={() => {
            // Navigate to line
            window.dispatchEvent(new CustomEvent('loom:go-to-line', { detail: { file: filePath, line: s.line } }));
          }}>
          <span style={{ width: 20, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, color: 'var(--accent)', flexShrink: 0 }}>
            {kindIcons[s.kind] || '?'}
          </span>
          <span className="tree-item-name">{s.name}</span>
          <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--text-muted)', flexShrink: 0 }}>:{s.line}</span>
        </div>
      ))}
    </div>
  );
}

interface Props {
  workspacePath: string;
  onOpenFile: (path: string, content: string) => void;
  selectedFile: string;
  gitStatusMap?: Record<string, string>;
}

export default function FileTree({ workspacePath, onOpenFile, selectedFile, gitStatusMap }: Props) {
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);

  const loadEntries = useCallback(() => {
    if (!workspacePath) { setEntries([]); return; }
    (window as any).loom.fs.readDir(workspacePath).then((e: FileEntry[]) => {
      setEntries(e.sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
        return a.name.localeCompare(b.name);
      }).filter(f => !HIDDEN.has(f.name)));
    }).catch(() => setEntries([]));
  }, [workspacePath]);

  useEffect(() => {
    loadEntries();
  }, [loadEntries, refreshKey]);

  useEffect(() => {
    const handler = () => setRefreshKey(k => k + 1);
    window.addEventListener('loom:refresh-tree', handler);
    return () => window.removeEventListener('loom:refresh-tree', handler);
  }, []);

  // Listen for collapse-all
  useEffect(() => {
    const handler = () => {
      // Force re-mount all tree items by resetting entries
      setRefreshKey(k => k + 1);
    };
    window.addEventListener('loom:collapse-all', handler);
    return () => window.removeEventListener('loom:collapse-all', handler);
  }, []);

  const handleRefresh = () => setRefreshKey(k => k + 1);

  if (!workspacePath) return (
    <div className="panel-empty-state">
      <svg viewBox="0 0 16 16" width="24" height="24" style={{ color: 'var(--text-muted)', marginBottom: 8 }}><path d="M1.5 3A1.5 1.5 0 013 1.5h3.146a.5.5 0 01.354.146L7.707 2.854a.5.5 0 00.354.146H13A1.5 1.5 0 0114.5 4.5v8A1.5 1.5 0 0113 14H3A1.5 1.5 0 011.5 12.5V3z" fill="none" stroke="currentColor" strokeWidth="1"/></svg>
      <div>No folder opened</div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>Open a folder to explore files</div>
    </div>
  );
  if (entries.length === 0) return (
    <div className="panel-empty-state">
      <svg viewBox="0 0 16 16" width="24" height="24" style={{ color: 'var(--text-muted)', marginBottom: 8 }}><path d="M1.5 3A1.5 1.5 0 013 1.5h3.146a.5.5 0 01.354.146L7.707 2.854a.5.5 0 00.354.146H13A1.5 1.5 0 0114.5 4.5v8A1.5 1.5 0 0113 14H3A1.5 1.5 0 011.5 12.5V3z" fill="none" stroke="currentColor" strokeWidth="1"/><path d="M5 7h6M8 5v4" fill="none" stroke="currentColor" strokeWidth="1"/></svg>
      <div>Empty folder</div>
      <button className="welcome-action-btn" style={{ fontSize: 11, padding: '4px 10px', marginTop: 8 }}
        onClick={() => {
          window.dispatchEvent(new CustomEvent('loom:refresh-tree'));
        }}>
        Refresh
      </button>
    </div>
  );

  return (
    <div className="file-tree">
      {entries.map(entry => (
        <TreeItem key={entry.path} entry={entry} depth={0} onOpenFile={onOpenFile} selectedFile={selectedFile} onRefresh={handleRefresh} gitStatusMap={gitStatusMap} workspacePath={workspacePath} />
      ))}
    </div>
  );
}
