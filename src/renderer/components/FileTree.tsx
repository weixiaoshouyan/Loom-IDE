import React, { useState, useEffect, useCallback } from 'react';

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
}

const HIDDEN = new Set(['node_modules', '.git', '.vscode', 'dist', 'release', '__pycache__', '.next', 'coverage']);
const extColors: Record<string, string> = {
  ts: '#3178c6', tsx: '#3178c6', js: '#f7df1e', jsx: '#61dafb',
  py: '#3572A5', json: '#f7df1e', md: '#083fa1', css: '#563d7c',
  html: '#e34c26', go: '#00ADD8', rs: '#dea584', yml: '#cb171e',
  yaml: '#cb171e', sh: '#89e051', java: '#b07219', rb: '#cc342d',
  php: '#4F5D95', c: '#555555', cpp: '#f34b7d', xml: '#0060ac',
  svg: '#ffb13b', png: '#a855f7', jpg: '#a855f7', gif: '#a855f7',
};

function getFileIcon(name: string, isDir: boolean): { color: string; svg: JSX.Element } {
  if (isDir) {
    return {
      color: '#dcb67a',
      svg: <svg viewBox="0 0 16 16" fill="#dcb67a"><path d="M1.5 3A1.5 1.5 0 013 1.5h3.146a.5.5 0 01.354.146L7.707 2.854a.5.5 0 00.354.146H13A1.5 1.5 0 0114.5 4.5v8A1.5 1.5 0 0113 14H3A1.5 1.5 0 011.5 12.5V3z"/></svg>,
    };
  }
  const ext = name.split('.').pop()?.toLowerCase() || '';
  const color = extColors[ext] || '#cccccc';
  return {
    color,
    svg: <svg viewBox="0 0 16 16"><path d="M4 1.5H3a2 2 0 00-2 2v9a2 2 0 002 2h10a2 2 0 002-2V4.5" fill="none" stroke={color} strokeWidth="1"/><path d="M9 1.5v4a.5.5 0 00.5.5h4" fill="none" stroke={color} strokeWidth="1"/><path d="M12 1.5L14.5 4" fill="none" stroke={color} strokeWidth="1"/></svg>,
  };
}

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

function TreeItem({ entry, depth, onOpenFile, selectedFile, onRefresh }: TreeItemProps) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<FileEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState(entry.name);
  const [deleting, setDeleting] = useState(false);

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
      const dir = entry.path.substring(0, entry.path.lastIndexOf(/[\\/]/.test(entry.path) ? '\\' : '/'));
      const newPath = dir + (entry.path.includes('\\') ? '\\' : '/') + newName.trim();
      await (window as any).loom.fs.rename(entry.path, newPath);
      onRefresh();
    } catch (e: any) {
      console.error('Rename failed:', e.message);
    }
    setRenaming(false);
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await (window as any).loom.fs.deletePath(entry.path);
      onRefresh();
    } catch (e: any) {
      console.error('Delete failed:', e.message);
    }
    setDeleting(false);
  };

  if (HIDDEN.has(entry.name)) return null;
  const icon = getFileIcon(entry.name, entry.isDirectory);
  const isSelected = selectedFile === entry.path;

  const ctxItems = [
    { label: entry.isDirectory ? 'New File...' : 'Open', action: handleClick },
    { label: entry.isDirectory ? 'New Folder...' : 'Rename', action: () => setRenaming(true) },
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
          <span className="tree-item-name">{entry.name}</span>
        )}
      </div>
      {expanded && entry.isDirectory && children.map(child => (
        <TreeItem key={child.path} entry={child} depth={depth + 1} onOpenFile={onOpenFile} selectedFile={selectedFile} onRefresh={onRefresh} />
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
    return <div className="tree-empty" style={{ padding: '16px', textAlign: 'center' }}>No symbols found in document</div>;
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
}

export default function FileTree({ workspacePath, onOpenFile, selectedFile }: Props) {
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

  const handleRefresh = () => setRefreshKey(k => k + 1);

  if (!workspacePath) return <div className="tree-empty">No folder opened</div>;
  if (entries.length === 0) return (
    <div className="tree-empty" style={{ textAlign: 'center', padding: '16px' }}>
      <p style={{ marginBottom: 8 }}>Empty folder</p>
      <button className="welcome-action-btn" style={{ fontSize: 11, padding: '4px 10px' }}
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
        <TreeItem key={entry.path} entry={entry} depth={0} onOpenFile={onOpenFile} selectedFile={selectedFile} onRefresh={handleRefresh} />
      ))}
    </div>
  );
}
