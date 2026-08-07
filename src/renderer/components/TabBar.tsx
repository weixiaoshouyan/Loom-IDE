import React, { useRef, useState, useCallback } from 'react';
import type { OpenFile } from '../App';
import { getFileIcon } from './FileIcons';
import { isFileDirty } from '../workspace-state';

interface Props {
  files: OpenFile[];
  activeIdx: number;
  onSelect: (idx: number) => void;
  onClose: (idx: number) => void;
  onCloseAll: () => void;
  onCloseOthers: (idx: number) => void;
  onReorder: (from: number, to: number) => void;
  onRun?: () => void;
  onSplit?: () => void;
  onRevert?: (idx: number) => void;
  locale?: 'zh-CN' | 'en-US';
  staleFiles?: Set<string>;
}

function TabBar({ files, activeIdx, onSelect, onClose, onCloseAll, onCloseOthers, onReorder, onRun, onSplit, onRevert, locale = 'zh-CN', staleFiles }: Props) {
  const dragIdxRef = useRef<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; idx: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const onDragStart = useCallback((e: React.DragEvent, idx: number) => {
    if (!(e.target as HTMLElement).closest('.tab')) return;
    dragIdxRef.current = idx;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(idx));
    requestAnimationFrame(() => (e.target as HTMLElement).classList.add('tab-dragging'));
  }, []);

  const onDragEnd = useCallback((e: React.DragEvent) => {
    (e.target as HTMLElement).classList.remove('tab-dragging');
    setDragOverIdx(null);
    dragIdxRef.current = null;
  }, []);

  const onDragOver = useCallback((e: React.DragEvent, idx: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverIdx(idx);
  }, []);

  const onDrop = useCallback((e: React.DragEvent, toIdx: number) => {
    e.preventDefault();
    const fromIdx = dragIdxRef.current;
    if (fromIdx !== null && fromIdx !== toIdx) {
      onReorder(fromIdx, toIdx);
    }
    setDragOverIdx(null);
    dragIdxRef.current = null;
  }, [onReorder]);

  const onContextMenu = useCallback((e: React.MouseEvent, idx: number) => {
    e.preventDefault();
    setCtxMenu({ x: e.clientX, y: e.clientY, idx });
  }, []);

  const closeCtxMenu = useCallback(() => setCtxMenu(null), []);

  // Scroll wheel to switch tabs
  const onWheel = useCallback((e: React.WheelEvent) => {
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
    e.preventDefault();
    const dir = e.deltaY > 0 ? 1 : -1;
    const next = activeIdx + dir;
    if (next >= 0 && next < files.length) onSelect(next);
  }, [activeIdx, files.length, onSelect]);

  // Middle-click to close
  const onTabMouseDown = useCallback((e: React.MouseEvent, idx: number) => {
    if (e.button === 1) {
      e.preventDefault();
      onClose(idx);
    }
  }, [onClose]);

  return (
    <>
      <div className="tab-bar-wrapper">
        <div className="tabs-container" ref={containerRef} onWheel={onWheel} role="tablist" aria-label={locale === 'zh-CN' ? '编辑器标签页' : 'Editor Tabs'}>
          {files.map((f, i) => {
            const dirty = isFileDirty(f.content, f.originalContent);
            const isDragOver = dragOverIdx === i;
            const isStale = !!staleFiles?.has(f.path);
            const icon = getFileIcon(f.name, false, false);
            return (
              <div
                key={f.path}
                className={`tab ${i === activeIdx ? 'active' : ''} ${isDragOver ? 'drag-over' : ''} ${isStale ? 'stale' : ''}`}
                onClick={() => onSelect(i)}
                onMouseDown={e => onTabMouseDown(e, i)}
                onAuxClick={e => e.button === 1 && e.preventDefault()}
                onDragStart={(e) => onDragStart(e, i)}
                onDragEnd={onDragEnd}
                onDragOver={(e) => onDragOver(e, i)}
                onDrop={(e) => onDrop(e, i)}
                onContextMenu={(e) => onContextMenu(e, i)}
                draggable
                role="tab"
                aria-selected={i === activeIdx}
                tabIndex={i === activeIdx ? 0 : -1}
                title={f.path + (isStale ? `\n${locale === 'zh-CN' ? '文件已在外部修改,右键可重新载入' : 'File changed on disk'}` : '')}
              >
                <span className="tab-icon">{icon.svg}</span>
                <span className="tab-name">{f.name}</span>
                {isStale && (
                  <span
                    className="tab-stale"
                    title={locale === 'zh-CN' ? '外部修改,点击重新载入' : 'Revert from disk'}
                    onClick={(e) => { e.stopPropagation(); onRevert?.(i); }}
                  >⟳</span>
                )}
                {dirty ? (
                  <span
                    className="tab-modified"
                    onClick={(e) => { e.stopPropagation(); onClose(i); }}
                    title={locale === 'zh-CN' ? '未保存，点击关闭' : 'Unsaved, click to close'}
                    style={{ cursor: 'pointer' }}
                  />
                ) : (
                  <button
                    className="tab-close"
                    onClick={(e) => { e.stopPropagation(); onClose(i); }}
                    title={locale === 'zh-CN' ? '关闭' : 'Close'}
                    aria-label="Close"
                  >
                    <svg viewBox="0 0 16 16" width="12" height="12"><path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.4" fill="none"/></svg>
                  </button>
                )}
              </div>
            );
          })}
        </div>
        <div className="tab-bar-actions">
          {onRun && (
            <button
              onClick={onRun}
              title={locale === 'zh-CN' ? '运行活动文件' : 'Run Active File'}
              className="tab-bar-action run"
              aria-label="Run"
            >
              <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor">
                <path d="M4 2.69v10.62a.5.5 0 0 0 .757.429l8-5.31a.5.5 0 0 0 0-.858l-8-5.31A.5.5 0 0 0 4 2.69z"/>
              </svg>
            </button>
          )}
          {onSplit && (
            <button
              onClick={onSplit}
              title={locale === 'zh-CN' ? '拆分编辑器' : 'Split Editor'}
              className="tab-bar-action split"
              aria-label="Split"
            >
              <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5">
                <rect x="2" y="2" width="12" height="12" rx="1" />
                <line x1="8" y1="2" x2="8" y2="14" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {ctxMenu && (
        <>
          <div className="context-menu-overlay" onClick={closeCtxMenu} />
          <div className="context-menu" style={{ left: ctxMenu.x, top: ctxMenu.y }}>
            <div className="context-menu-item" onClick={() => { onClose(ctxMenu.idx); closeCtxMenu(); }}>
              <span>Close</span>
              <span className="context-menu-shortcut">Ctrl+W</span>
            </div>
            <div className="context-menu-item" onClick={() => { onCloseOthers(ctxMenu.idx); closeCtxMenu(); }}>
              <span>Close Others</span>
            </div>
            <div className="context-menu-item" onClick={() => { onCloseAll(); closeCtxMenu(); }}>
              <span>Close All</span>
            </div>
            <div className="context-menu-sep" />
            <div className="context-menu-item" onClick={() => {
              for (let i = files.length - 1; i > ctxMenu.idx; i--) onClose(i);
              closeCtxMenu();
            }}>
              <span>Close to the Right</span>
            </div>
            {onRevert && (
              <>
                <div className="context-menu-sep" />
                <div className="context-menu-item" onClick={() => { onRevert(ctxMenu.idx); closeCtxMenu(); }}>
                  <span>{locale === 'zh-CN' ? '重新载入文件' : 'Revert File'}</span>
                </div>
              </>
            )}
            <div className="context-menu-sep" />
            <div className="context-menu-item" onClick={() => {
              const f = files[ctxMenu.idx];
              if (f) navigator.clipboard?.writeText(f.path);
              closeCtxMenu();
            }}>
              <span>Copy Path</span>
            </div>
            <div className="context-menu-item" onClick={() => {
              const f = files[ctxMenu.idx];
              if (f) navigator.clipboard?.writeText(f.name);
              closeCtxMenu();
            }}>
              <span>Copy File Name</span>
            </div>
          </div>
        </>
      )}
    </>
  );
}

export default React.memo(TabBar);
