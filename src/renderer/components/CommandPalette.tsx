import React, { useState, useEffect, useRef, useCallback } from 'react';

interface Command {
  id: string;
  label: string;
  shortcut?: string;
  action: () => void;
}

interface Props {
  visible: boolean;
  commands: Command[];
  onClose: () => void;
  workspacePath?: string;
  onOpenFile?: (path: string, content: string) => void;
}

interface FileResult {
  path: string;
  name: string;
  relativePath: string;
}

export default function CommandPalette({ visible, commands, onClose, workspacePath, onOpenFile }: Props) {
  const [query, setQuery] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [fileResults, setFileResults] = useState<FileResult[]>([]);
  const [indexed, setIndexed] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Determine mode: '>' prefix = command mode, otherwise file search
  const isCommandMode = query.startsWith('>');
  const searchTerm = isCommandMode ? query.slice(1).trim() : query.trim();

  // Index files when palette opens
  useEffect(() => {
    if (visible && workspacePath && !indexed) {
      (window as any).loom?.fs?.indexFiles?.(workspacePath).then(() => setIndexed(true)).catch(() => {});
    }
  }, [visible, workspacePath, indexed]);

  // Reset state on open
  useEffect(() => {
    if (visible) {
      setQuery('');
      setSelectedIdx(0);
      setFileResults([]);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [visible]);

  // Search files when query changes (file mode)
  useEffect(() => {
    if (isCommandMode || !visible) { setFileResults([]); return; }
    if (!searchTerm) {
      // Show recent/all files when empty
      setFileResults([]);
      return;
    }
    let cancelled = false;
    (window as any).loom?.fs?.searchFiles?.(workspacePath, searchTerm).then((paths: string[]) => {
      if (cancelled) return;
      const results = (paths || []).slice(0, 50).map((p: string) => {
        const name = p.split(/[\\/]/).pop() || p;
        const relativePath = workspacePath ? p.replace(workspacePath, '').replace(/^[\\/]/, '') : p;
        return { path: p, name, relativePath };
      });
      setFileResults(results);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [searchTerm, isCommandMode, visible, workspacePath]);

  const filteredCommands = isCommandMode
    ? commands.filter(c => c.label.toLowerCase().includes(searchTerm.toLowerCase()))
    : [];

  const items = isCommandMode
    ? filteredCommands.map(c => ({ type: 'command' as const, id: c.id, label: c.label, shortcut: c.shortcut, action: c.action }))
    : fileResults.map(f => ({ type: 'file' as const, id: f.path, label: f.name, shortcut: '', filePath: f.path, relativePath: f.relativePath }));

  useEffect(() => { setSelectedIdx(0); }, [query]);

  useEffect(() => {
    if (listRef.current) {
      const el = listRef.current.children[selectedIdx] as HTMLElement;
      if (el) el.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIdx]);

  const executeItem = useCallback((item: typeof items[0]) => {
    if (item.type === 'command') {
      item.action();
    } else if (item.type === 'file' && onOpenFile && item.filePath) {
      (window as any).loom.fs.readFile(item.filePath).then((content: string) => {
        onOpenFile(item.filePath!, content);
      }).catch(() => {});
    }
    onClose();
  }, [onClose, onOpenFile]);

  if (!visible) return null;

  const placeholder = isCommandMode ? 'Type a command...' : 'Search files by name...';

  return (
    <div className="command-palette-overlay" onClick={onClose}>
      <div className="command-palette" onClick={e => e.stopPropagation()}>
        <div className="command-palette-input-wrapper">
          <svg viewBox="0 0 16 16" width="16" height="16" style={{ flexShrink: 0, color: 'var(--text-muted)', marginRight: 6 }}>
            {isCommandMode ? (
              <path d="M10.5 3L5.5 8l5 5" fill="none" stroke="currentColor" strokeWidth="1.5" />
            ) : (
              <path d="M6.5 4.5v7M4.5 6.5l2-2 2 2M2 8a6 6 0 1012 0A6 6 0 002 8z" fill="none" stroke="currentColor" strokeWidth="1" />
            )}
          </svg>
          <input ref={inputRef} className="command-palette-input" placeholder={placeholder}
            value={query} onChange={e => setQuery(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Escape') onClose();
              else if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIdx(i => Math.min(i + 1, items.length - 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIdx(i => Math.max(i - 1, 0)); }
              else if (e.key === 'Enter' && items[selectedIdx]) { executeItem(items[selectedIdx]); }
            }}
          />
          <span className="command-palette-mode" style={{
            fontSize: 10, color: 'var(--text-muted)', padding: '2px 6px',
            background: 'var(--bg-tertiary)', borderRadius: 3, flexShrink: 0, marginLeft: 4
          }}>
            {isCommandMode ? 'Commands' : 'Files'}
          </span>
        </div>
        <div className="command-palette-list" ref={listRef}>
          {items.length === 0 && searchTerm && (
            <div style={{ padding: '12px', color: 'var(--text-muted)', textAlign: 'center' }}>
              {isCommandMode ? 'No matching commands' : 'No matching files'}
            </div>
          )}
          {items.length === 0 && !searchTerm && !isCommandMode && (
            <div style={{ padding: '12px', color: 'var(--text-muted)', textAlign: 'center', fontSize: 12 }}>
              Type to search files... {!indexed && workspacePath ? '(Indexing...)' : ''}
            </div>
          )}
          {items.map((item, i) => (
            <div key={item.id} className={`command-item ${i === selectedIdx ? 'selected' : ''}`}
              onClick={() => executeItem(item)}
              onMouseEnter={() => setSelectedIdx(i)}
            >
              <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                <span className="command-item-label">{item.label}</span>
                {item.type === 'file' && (item as any).relativePath && (
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {(item as any).relativePath}
                  </span>
                )}
              </div>
              {item.type === 'command' && item.shortcut && <span className="command-item-keybinding">{item.shortcut}</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
