import React, { useState, useEffect, useCallback } from 'react';
import { getFileIcon } from './FileIcons';
import { confirmDialog } from './ConfirmModal';

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
  gitStatusMap?: Record<string, string>;
  workspacePath?: string;
  locale?: 'zh-CN' | 'en-US';
}

const HIDDEN = new Set(['node_modules', '.git', '.vscode', 'dist', 'release', '__pycache__', '.next', 'coverage', '.workbuddy', 'out']);

function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: { label?: string; action?: () => void; separator?: boolean; disabled?: boolean }[]; onClose: () => void }) {
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!t.closest('.context-menu')) onClose();
    };
    setTimeout(() => window.addEventListener('mousedown', handler), 0);
    return () => window.removeEventListener('mousedown', handler);
  }, [onClose]);

  return (
    <>
      <div className="context-menu-overlay" onClick={onClose} />
      <div className="context-menu" style={{ position: 'fixed', left: x, top: y, zIndex: 1000 }}>
        {items.map((item, j) =>
          item.separator ? <div key={j} className="context-menu-sep" /> :
          <div key={j} className={`context-menu-item ${item.disabled ? 'disabled' : ''}`}
            onClick={() => { if (!item.disabled && item.action) { item.action(); onClose(); } }}>
            <span>{item.label}</span>
          </div>
        )}
      </div>
    </>
  );
}

function TreeItem({ entry, depth, onOpenFile, selectedFile, gitStatusMap, workspacePath, locale = 'zh-CN' }: TreeItemProps) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<FileEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState(entry.name);

  const loadChildren = useCallback(async () => {
    try {
      const entries: FileEntry[] = await window.loom.fs.readDir(entry.path);
      const sorted = entries
        .filter(e => !HIDDEN.has(e.name))
        .sort((a, b) => {
          if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
      setChildren(sorted);
      setLoaded(true);
    } catch {
      setChildren([]);
    }
  }, [entry.path]);

  const handleClick = useCallback(async () => {
    if (entry.isDirectory) {
      if (!expanded && !loaded) await loadChildren();
      setExpanded(!expanded);
    } else {
      try {
        const content = await window.loom.fs.readFile(entry.path);
        if (typeof content === 'string' && content.startsWith('__ERR__:')) {
          window.dispatchEvent(new CustomEvent('loom:notify', { detail: { message: `${locale === 'zh-CN' ? '无法打开文件' : 'Cannot open file'}: ${content.slice('__ERR__:'.length)}`, type: 'error' } }));
          return;
        }
        onOpenFile(entry.path, content);
      } catch (e: any) {
        window.dispatchEvent(new CustomEvent('loom:notify', { detail: { message: `${locale === 'zh-CN' ? '无法打开文件' : 'Cannot open file'}: ${e.message}`, type: 'error' } }));
      }
    }
  }, [entry, expanded, loaded, loadChildren, onOpenFile]);

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({ x: e.clientX, y: e.clientY });
  };

  const handleDoubleClick = () => {
    if (entry.isDirectory) {
      setRenaming(true);
    }
  };

  const handleRename = async () => {
    try {
      const sep = entry.path.includes('\\') ? '\\' : '/';
      const dir = entry.path.substring(0, entry.path.lastIndexOf(sep));
      const newPath = dir + sep + newName.trim();
      await window.loom.fs.rename(entry.path, newPath);
      window.dispatchEvent(new CustomEvent('loom:refresh-tree'));
    } catch (e: any) {
      window.dispatchEvent(new CustomEvent('loom:notify', { detail: { message: `${locale === 'zh-CN' ? '重命名失败' : 'Rename failed'}: ${e.message}`, type: 'error' } }));
    }
    setRenaming(false);
  };

  const handleDelete = async () => {
    const confirmMsg = entry.isDirectory
      ? (locale === 'zh-CN' ? `确定删除文件夹 "${entry.name}" 及其所有内容？` : `Delete folder "${entry.name}" and all its contents?`)
      : (locale === 'zh-CN' ? `确定删除 "${entry.name}"？` : `Delete "${entry.name}"?`);
    const ok = await confirmDialog.ask({
      title: locale === 'zh-CN' ? '删除' : 'Delete',
      message: confirmMsg,
      confirmText: locale === 'zh-CN' ? '删除' : 'Delete',
      danger: true,
    });
    if (!ok) return;
    try {
      await window.loom.fs.deletePath(entry.path);
      window.dispatchEvent(new CustomEvent('loom:refresh-tree'));
    } catch (e: any) {
      window.dispatchEvent(new CustomEvent('loom:notify', { detail: { message: `${locale === 'zh-CN' ? '删除失败' : 'Delete failed'}: ${e.message}`, type: 'error' } }));
    }
  };

  if (HIDDEN.has(entry.name)) return null;
  const icon = getFileIcon(entry.name, entry.isDirectory, expanded);
  const isSelected = selectedFile === entry.path;

  const relativePath = workspacePath ? entry.path.replace(workspacePath, '').replace(/^[\\/]/g, '').replace(/\\/g, '/') : entry.name;
  const gitStatus = !entry.isDirectory && gitStatusMap
    ? (gitStatusMap[relativePath] || gitStatusMap[entry.path])
    : undefined;
  const gitColor = gitStatus === 'M' ? 'var(--git-modified)' :
    gitStatus === 'A' || gitStatus === '?' ? 'var(--git-added)' :
    gitStatus === 'D' ? 'var(--git-deleted)' :
    gitStatus === 'R' ? 'var(--git-added)' : undefined;
  const gitLabel = gitStatus === 'M' ? 'M' : gitStatus === 'A' ? 'A' : gitStatus === 'D' ? 'D' :
    gitStatus === '?' ? 'U' : gitStatus === 'R' ? 'R' : undefined;

  const ctxItems = entry.isDirectory
    ? [
        { label: locale === 'zh-CN' ? '新建文件...' : 'New File...', action: () => window.dispatchEvent(new CustomEvent('loom:create-in-directory', { detail: { directory: entry.path, kind: 'file' } })) },
        { label: locale === 'zh-CN' ? '新建文件夹...' : 'New Folder...', action: () => window.dispatchEvent(new CustomEvent('loom:create-in-directory', { detail: { directory: entry.path, kind: 'folder' } })) },
        { separator: true, label: '' },
        { label: locale === 'zh-CN' ? '复制路径' : 'Copy Path', action: () => navigator.clipboard?.writeText(entry.path) },
        { label: locale === 'zh-CN' ? '在文件管理器中显示' : 'Reveal in File Manager', action: () => window.loom?.shell?.showItemInFolder?.(entry.path) },
        { label: locale === 'zh-CN' ? '重命名' : 'Rename', action: () => setRenaming(true) },
        { separator: true, label: '' },
        { label: locale === 'zh-CN' ? '删除' : 'Delete', action: () => handleDelete() },
      ]
    : [
        { label: locale === 'zh-CN' ? '打开' : 'Open', action: handleClick },
        { label: locale === 'zh-CN' ? '重命名' : 'Rename', action: () => setRenaming(true) },
        { separator: true, label: '' },
        { label: locale === 'zh-CN' ? '复制路径' : 'Copy Path', action: () => navigator.clipboard?.writeText(entry.path) },
        { label: locale === 'zh-CN' ? '复制相对路径' : 'Copy Relative Path', action: () => navigator.clipboard?.writeText(entry.name) },
        { separator: true, label: '' },
        { label: locale === 'zh-CN' ? '删除' : 'Delete', action: () => handleDelete() },
      ];

  return (
    <>
      <div
        className={`tree-item ${isSelected ? 'selected' : ''}`}
        style={{ paddingLeft: depth * 16 + 'px' }}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        onDoubleClick={handleDoubleClick}
        role="treeitem"
        aria-selected={isSelected}
        aria-expanded={entry.isDirectory ? expanded : undefined}
        tabIndex={isSelected ? 0 : -1}
      >
        {entry.isDirectory ? (
          <span className={`tree-item-arrow ${expanded ? 'expanded' : ''}`}>
            <svg viewBox="0 0 16 16"><path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
          </span>
        ) : (
          <span style={{ width: 18 }} />
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
      {expanded && entry.isDirectory && children.map(child => (
        <TreeItem
          key={child.path}
          entry={child}
          depth={depth + 1}
          onOpenFile={onOpenFile}
          selectedFile={selectedFile}
          gitStatusMap={gitStatusMap}
          workspacePath={workspacePath}
          locale={locale}
        />
      ))}
      {ctxMenu && <ContextMenu x={ctxMenu.x} y={ctxMenu.y} items={ctxItems} onClose={() => setCtxMenu(null)} />}
    </>
  );
}

// Outline View
export function OutlineView({ filePath, onOpenFile, locale = 'zh-CN' }: { filePath: string; onOpenFile: (path: string, content: string) => void; locale?: 'zh-CN' | 'en-US' }) {
  const [symbols, setSymbols] = useState<{ name: string; kind: string; line: number; containerName?: string }[]>([]);

  useEffect(() => {
    if (!filePath) { setSymbols([]); return; }
    setSymbols([]);
    const fetchSymbols = async () => {
      try {
        const content = await window.loom.fs.readFile(filePath);
        const lines = content.split('\n');
        const found: typeof symbols = [];
        lines.forEach((line: string, i: number) => {
          const trimmed = line.trim();
          // 函数/类：支持 export、export default、async 组合
          const funcMatch = trimmed.match(/^(?:export\s+)?(?:default\s+)?(?:async\s+)?(function|class|const|let|var)\s+(\w+)/);
          if (funcMatch) {
            found.push({ name: funcMatch[2], kind: funcMatch[1] === 'class' ? 'class' : 'function', line: i + 1 });
          }
          // 导入：支持 import type、默认导入、默认+具名混合、命名空间 import * as X
          if (trimmed.startsWith('import ')) {
            const body = trimmed.replace(/^import\s+(?:type\s+)?/, '');
            const defaultMatch = body.match(/^(\w+)\s*(?:,|from|$)/);
            if (defaultMatch && defaultMatch[1] !== 'from') {
              found.push({ name: defaultMatch[1], kind: 'module', line: i + 1 });
            }
            const named = body.match(/\{([^}]+)\}/);
            if (named) {
              named[1].split(',').forEach(n => {
                const clean = n.trim().replace(/^type\s+/, '');
                const name = clean.split(/\s+as\s+/).pop()?.trim() || '';
                if (name) found.push({ name, kind: 'module', line: i + 1 });
              });
            }
            const ns = body.match(/\*\s+as\s+(\w+)/);
            if (ns) found.push({ name: ns[1], kind: 'module', line: i + 1 });
          }
          const typeMatch = trimmed.match(/^(?:export\s+)?(?:default\s+)?(interface|type|enum)\s+(\w+)/);
          if (typeMatch) {
            found.push({ name: typeMatch[2], kind: typeMatch[1], line: i + 1 });
          }
          // 类方法：允许多个修饰符（如 private async foo()），并过滤控制流关键字
          const methodMatch = trimmed.match(/^((?:public|private|protected|static|async|readonly|override|get|set)\s+)*(\w+)\s*\(/);
          if (methodMatch && !funcMatch && !typeMatch && trimmed.includes('{')) {
            const name = methodMatch[2];
            const keywords = ['if', 'for', 'while', 'switch', 'return', 'await', 'catch', 'else', 'do', 'try', 'with', 'function', 'super'];
            if (name && !keywords.includes(name)) {
              found.push({ name, kind: 'method', line: i + 1 });
            }
          }
        });
        setSymbols(found);
      } catch {}
    };
    fetchSymbols();
  }, [filePath]);

  if (!filePath) {
    return (
      <div className="panel-empty-state">
        <div>{locale === 'zh-CN' ? '大纲为空' : 'No outline'}</div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{locale === 'zh-CN' ? '打开代码文件查看其大纲' : 'Open a code file to see its outline'}</div>
      </div>
    );
  }

  if (symbols.length === 0) {
    return (
      <div className="panel-empty-state">
        <div>{locale === 'zh-CN' ? '未找到符合' : 'No symbols found'}</div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{locale === 'zh-CN' ? '打开代码文件查看大纲' : 'Open a code file to see its outline'}</div>
      </div>
    );
  }

  const kindIcons: Record<string, string> = { class: 'C', function: 'F', method: 'M', module: 'M', interface: 'I', type: 'T', enum: 'E' };
  const kindColors: Record<string, string> = { class: 'var(--accent)', function: 'var(--green)', method: 'var(--text-muted)', module: 'var(--purple)', interface: 'var(--cyan)', type: 'var(--yellow)', enum: 'var(--magenta)' };

  return (
    <div className="file-tree">
      {symbols.map((s, i) => (
        <div key={i} className="tree-item" style={{ paddingLeft: 8, gap: 6, fontSize: 12 }}
          onClick={() => window.dispatchEvent(new CustomEvent('loom:go-to-line', { detail: { line: s.line } }))}>
          <span style={{ width: 20, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: kindColors[s.kind] || 'var(--accent)', flexShrink: 0, fontStyle: 'italic' }}>
            {kindIcons[s.kind] || '?'}
          </span>
          <span className="tree-item-name" style={{ fontSize: 12 }}>{s.name}</span>
          <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--text-muted)', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>:{s.line}</span>
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
  locale?: 'zh-CN' | 'en-US';
}

export default function FileTree({ workspacePath, onOpenFile, selectedFile, gitStatusMap, locale = 'zh-CN' }: Props) {
  const [entries, setEntries] = useState<FileEntry[]>([]);

  const loadEntries = useCallback(() => {
    if (!workspacePath) { setEntries([]); return; }
    window.loom.fs.readDir(workspacePath).then((e: FileEntry[]) => {
      const sorted = e
        .filter(f => !HIDDEN.has(f.name))
        .sort((a, b) => {
          if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
      setEntries(sorted);
    }).catch(() => setEntries([]));
  }, [workspacePath]);

  useEffect(() => { loadEntries(); }, [loadEntries]);

  useEffect(() => {
    // 直接调用 loadEntries，避免在 setState updater 内部触发副作用
    // （原实现：setEntries(prev => { loadEntries(); return prev; })）
    // 该反模式在 React 18 严格模式下会双调用、产生嵌套 setState，
    // 并可能引发重复 IPC 请求与潜在死循环。
    const handler = () => loadEntries();
    window.addEventListener('loom:refresh-tree', handler);
    return () => window.removeEventListener('loom:refresh-tree', handler);
  }, [loadEntries]);

  useEffect(() => {
    const handler = () => loadEntries();
    window.addEventListener('loom:file-tree-refresh' as any, handler);
    return () => window.removeEventListener('loom:file-tree-refresh' as any, handler);
  }, [loadEntries]);

  if (!workspacePath) {
    return (
      <div className="panel-empty-state">
        <div>{locale === 'zh-CN' ? '未打开文件夹' : 'No folder opened'}</div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{locale === 'zh-CN' ? '打开文件夹开始浏览' : 'Open a folder to explore files'}</div>
      </div>
    );
  }
  if (entries.length === 0) {
    return (
      <div className="panel-empty-state">
        <div>{locale === 'zh-CN' ? '空文件夹' : 'Empty folder'}</div>
      </div>
    );
  }

  return (
    <div className="file-tree" role="tree" aria-label={locale === 'zh-CN' ? '文件树' : 'File Tree'}>
      {entries.map(entry => (
        <TreeItem
          key={entry.path}
          entry={entry}
          depth={0}
          onOpenFile={onOpenFile}
          selectedFile={selectedFile}
          gitStatusMap={gitStatusMap}
          workspacePath={workspacePath}
          locale={locale}
        />
      ))}
    </div>
  );
}