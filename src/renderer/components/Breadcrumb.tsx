import React, { useState, useRef, useEffect, useCallback } from 'react';

interface Props {
  filePath: string;
  onOpenFile: (path: string, content: string) => void;
}

interface DirEntry {
  name: string;
  path: string;
  isDir: boolean;
}

export default function Breadcrumb({ filePath, onOpenFile }: Props) {
  if (!filePath) return null;
  const segments = filePath.split(/[\\/]/).filter(Boolean);
  const [dropdown, setDropdown] = useState<{ idx: number; x: number; y: number; entries: DirEntry[] } | null>(null);
  const [loading, setLoading] = useState(false);

  const closeDropdown = useCallback(() => setDropdown(null), []);

  const onSegmentClick = useCallback(async (e: React.MouseEvent, idx: number) => {
    e.stopPropagation();
    const dirPath = segments.slice(0, idx + 1).join(process.platform === 'win32' ? '\\' : '/');
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    setLoading(true);
    try {
      const entries: { name: string; isDirectory: boolean }[] =
        await (window as any).loom?.fs?.readDir?.(dirPath) || [];
      const sep = process.platform === 'win32' ? '\\' : '/';
      const dirEntries: DirEntry[] = entries.map(e => ({
        name: e.name,
        path: dirPath + sep + e.name,
        isDir: e.isDirectory,
      }));
      setDropdown({ idx, x: rect.left, y: rect.bottom + 2, entries: dirEntries });
    } catch {
      setDropdown(null);
    }
    setLoading(false);
  }, [segments]);

  const openEntry = useCallback(async (entry: DirEntry) => {
    setDropdown(null);
    if (!entry.isDir) {
      try {
        const content = await (window as any).loom?.fs?.readFile?.(entry.path);
        onOpenFile(entry.path, content);
      } catch {}
    }
  }, [onOpenFile]);

  const fileIcons: Record<string, string> = {
    ts: 'var(--blue)', tsx: 'var(--blue)', js: 'var(--yellow)', jsx: 'var(--yellow)',
    json: 'var(--yellow)', css: 'var(--purple)', html: 'var(--orange)',
    py: 'var(--green)', md: 'var(--text-secondary)', go: 'var(--cyan)',
  };

  return (
    <>
      <div className="breadcrumb">
        {segments.map((seg, i) => (
          <React.Fragment key={i}>
            <span className="breadcrumb-item" onClick={(e) => onSegmentClick(e, i)}>
              {i === segments.length - 1 && (
                <span className="breadcrumb-file-icon" style={{ color: fileIcons[seg.split('.').pop() || ''] || 'var(--text-secondary)' }}>
                  <svg viewBox="0 0 16 16" width="12" height="12">
                    <path d="M3 1h7l3 3v9a1 1 0 01-1 1H3a1 1 0 01-1-1V2a1 1 0 011-1z" fill="none" stroke="currentColor" strokeWidth="1" />
                  </svg>
                </span>
              )}
              {seg}
              <svg viewBox="0 0 16 16" width="10" height="10" className="breadcrumb-dropdown-arrow">
                <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" />
              </svg>
            </span>
            {i < segments.length - 1 && <span className="breadcrumb-sep">&rsaquo;</span>}
          </React.Fragment>
        ))}
      </div>

      {dropdown && (
        <>
          <div className="context-menu-overlay" onClick={closeDropdown} />
          <div className="context-menu breadcrumb-dropdown" style={{ left: dropdown.x, top: dropdown.y, minWidth: 220 }}>
            {dropdown.entries.length === 0 && (
              <div style={{ padding: '8px 12px', color: 'var(--text-muted)', fontSize: 12 }}>Empty</div>
            )}
            {dropdown.entries.sort((a, b) => {
              if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
              return a.name.localeCompare(b.name);
            }).map((entry) => (
              <div key={entry.path} className="context-menu-item breadcrumb-entry" onClick={() => openEntry(entry)}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6, overflow: 'hidden' }}>
                  {entry.isDir ? (
                    <svg viewBox="0 0 16 16" width="14" height="14" style={{ flexShrink: 0, color: '#dcb67a' }}>
                      <path d="M1.5 3A1.5 1.5 0 013 1.5h3.146a.5.5 0 01.354.146L7.707 2.854a.5.5 0 00.354.146H13A1.5 1.5 0 0114.5 4.5v8A1.5 1.5 0 0113 14H3A1.5 1.5 0 011.5 12.5V3z" fill="currentColor" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 16 16" width="14" height="14" style={{ flexShrink: 0, color: fileIcons[entry.name.split('.').pop() || ''] || 'var(--text-secondary)' }}>
                      <path d="M3 1h7l3 3v9a1 1 0 01-1 1H3a1 1 0 01-1-1V2a1 1 0 011-1z" fill="none" stroke="currentColor" strokeWidth="1" />
                    </svg>
                  )}
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{entry.name}</span>
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}
