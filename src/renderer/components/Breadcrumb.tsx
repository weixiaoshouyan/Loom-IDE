import React, { useState, useRef, useEffect, useCallback } from 'react';
import { getLoom } from '../loom-ipc';

interface Props {
  filePath: string;
  onOpenFile: (path: string, content: string) => void;
  locale?: 'zh-CN' | 'en-US';
}

interface DirEntry {
  name: string;
  path: string;
  isDir: boolean;
}

const fileColors: Record<string, string> = {
  ts: '#3178c6', tsx: '#3178c6', js: '#f7df1e', jsx: '#61dafb',
  json: '#f7df1e', css: '#563d7c', html: '#e34c26',
  py: '#3572A5', md: '#519aba', go: '#00ADD8', rs: '#dea584',
};

export default function Breadcrumb({ filePath, onOpenFile, locale = 'zh-CN' }: Props) {
  const [dropdown, setDropdown] = useState<{ idx: number; x: number; y: number; entries: DirEntry[] } | null>(null);
  const [loading, setLoading] = useState(false);

  if (!filePath) return null;
  const segments = filePath.split(/[\\/]/).filter(Boolean);

  const closeDropdown = useCallback(() => setDropdown(null), []);

  useEffect(() => {
    if (!dropdown) return;
    const handler = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!t.closest('.context-menu')) closeDropdown();
    };
    setTimeout(() => document.addEventListener('mousedown', handler), 0);
    return () => document.removeEventListener('mousedown', handler);
  }, [dropdown, closeDropdown]);

  const onSegmentClick = useCallback(async (e: React.MouseEvent, idx: number) => {
    e.stopPropagation();
    const sep = navigator.platform.toLowerCase().includes('win') || filePath.includes('\\') ? '\\' : '/';
    const dirPath = segments.slice(0, idx + 1).join(sep);
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setLoading(true);
    try {
      const entries: { name: string; isDirectory: boolean }[] = await getLoom()?.fs?.readDir?.(dirPath) || [];
      const dirEntries: DirEntry[] = entries
        .filter(e => !['node_modules', '.git', 'dist', 'release', '.workbuddy', 'out'].includes(e.name))
        .map(e => ({ name: e.name, path: dirPath + sep + e.name, isDir: e.isDirectory }))
        .sort((a, b) => {
          if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
      setDropdown({ idx, x: rect.left, y: rect.bottom + 4, entries: dirEntries });
    } catch {
      setDropdown(null);
    }
    setLoading(false);
  }, [segments, filePath]);

  const openEntry = useCallback(async (entry: DirEntry) => {
    setDropdown(null);
    if (!entry.isDir) {
      try {
        const content = await getLoom()?.fs?.readFile?.(entry.path);
        if (typeof content !== 'string') return;
        if (content.startsWith('__ERR__:')) {
          window.dispatchEvent(new CustomEvent('loom:notify', { detail: { message: `无法打开文件: ${content.slice('__ERR__:'.length)}`, type: 'error' } }));
          return;
        }
        onOpenFile(entry.path, content);
      } catch (e: any) {
        window.dispatchEvent(new CustomEvent('loom:notify', { detail: { message: `无法打开文件: ${e.message}`, type: 'error' } }));
      }
    }
  }, [onOpenFile]);

  return (
    <>
      <div className="breadcrumb">
        {segments.map((seg, i) => (
          <React.Fragment key={i}>
            <span className="breadcrumb-item" onClick={(e) => onSegmentClick(e, i)} title={seg}>
              {i === segments.length - 1 && (
                <span className="breadcrumb-file-icon" style={{ color: fileColors[seg.split('.').pop()?.toLowerCase() || ''] || 'var(--text-secondary)' }}>
                  <svg viewBox="0 0 16 16" width="12" height="12">
                    <path d="M3 1h7l3 3v9a1 1 0 01-1 1H3a1 1 0 01-1-1V2a1 1 0 011-1z" fill="none" stroke="currentColor" strokeWidth="1" />
                  </svg>
                </span>
              )}
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{seg}</span>
              {i < segments.length - 1 && (
                <svg viewBox="0 0 16 16" width="9" height="9" className="breadcrumb-dropdown-arrow">
                  <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" />
                </svg>
              )}
            </span>
            {i < segments.length - 1 && <span className="breadcrumb-sep">›</span>}
          </React.Fragment>
        ))}
        {loading && <span style={{ fontSize: 10, color: 'var(--text-muted)', marginLeft: 4 }}>…</span>}
      </div>

      {dropdown && (
        <div className="context-menu breadcrumb-dropdown" style={{ left: dropdown.x, top: dropdown.y, position: 'fixed' }}>
          {dropdown.entries.length === 0 ? (
            <div className="context-menu-label">{locale === 'zh-CN' ? '空' : 'Empty'}</div>
          ) : dropdown.entries.map((entry) => (
            <div key={entry.path} className="context-menu-item breadcrumb-entry" onClick={() => openEntry(entry)}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6, overflow: 'hidden' }}>
                {entry.isDir ? (
                  <svg viewBox="0 0 16 16" width="14" height="14" style={{ flexShrink: 0, color: '#dcb67a' }}>
                    <path d="M1.5 3A1.5 1.5 0 013 1.5h3.146a.5.5 0 01.354.146L7.707 2.854a.5.5 0 00.354.146H13A1.5 1.5 0 0114.5 4.5v8A1.5 1.5 0 0113 14H3A1.5 1.5 0 011.5 12.5V3z" fill="currentColor" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 16 16" width="14" height="14" style={{ flexShrink: 0, color: fileColors[entry.name.split('.').pop()?.toLowerCase() || ''] || 'var(--text-secondary)' }}>
                    <path d="M3 1h7l3 3v9a1 1 0 01-1 1H3a1 1 0 01-1-1V2a1 1 0 011-1z" fill="none" stroke="currentColor" strokeWidth="1" />
                  </svg>
                )}
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{entry.name}</span>
              </span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
