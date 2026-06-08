import React, { useState, useEffect, useRef } from 'react';

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
}

export default function CommandPalette({ visible, commands, onClose }: Props) {
  const [query, setQuery] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (visible) {
      setQuery('');
      setSelectedIdx(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [visible]);

  const filtered = commands.filter(c => c.label.toLowerCase().includes(query.toLowerCase()));

  useEffect(() => { setSelectedIdx(0); }, [query]);

  useEffect(() => {
    if (listRef.current) {
      const el = listRef.current.children[selectedIdx] as HTMLElement;
      if (el) el.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIdx]);

  if (!visible) return null;

  return (
    <div className="command-palette-overlay" onClick={onClose}>
      <div className="command-palette" onClick={e => e.stopPropagation()}>
        <div className="command-palette-input-wrapper">
          <input ref={inputRef} className="command-palette-input" placeholder="Type a command..."
            value={query} onChange={e => setQuery(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Escape') onClose();
              else if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIdx(i => Math.min(i + 1, filtered.length - 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIdx(i => Math.max(i - 1, 0)); }
              else if (e.key === 'Enter' && filtered[selectedIdx]) { filtered[selectedIdx].action(); onClose(); }
            }}
          />
        </div>
        <div className="command-palette-list" ref={listRef}>
          {filtered.map((cmd, i) => (
            <div key={cmd.id} className={`command-item ${i === selectedIdx ? 'selected' : ''}`}
              onClick={() => { cmd.action(); onClose(); }}
              onMouseEnter={() => setSelectedIdx(i)}
            >
              <span className="command-item-label">{cmd.label}</span>
              {cmd.shortcut && <span className="command-item-keybinding">{cmd.shortcut}</span>}
            </div>
          ))}
          {filtered.length === 0 && <div style={{ padding: '12px', color: 'var(--text-muted)', textAlign: 'center' }}>No matching commands</div>}
        </div>
      </div>
    </div>
  );
}
