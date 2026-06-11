import React, { useRef, useState, useCallback } from 'react';
import type { OpenFile } from '../App';

interface Props {
  files: OpenFile[];
  activeIdx: number;
  onSelect: (idx: number) => void;
  onClose: (idx: number) => void;
  onCloseAll: () => void;
  onCloseOthers: (idx: number) => void;
  onReorder: (from: number, to: number) => void;
}

export default function TabBar({ files, activeIdx, onSelect, onClose, onCloseAll, onCloseOthers, onReorder }: Props) {
  const dragIdxRef = useRef<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; idx: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const onDragStart = useCallback((e: React.DragEvent, idx: number) => {
    dragIdxRef.current = idx;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(idx));
    (e.target as HTMLElement).classList.add('tab-dragging');
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
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return; // horizontal scroll is native
    e.preventDefault();
    const dir = e.deltaY > 0 ? 1 : -1;
    const next = activeIdx + dir;
    if (next >= 0 && next < files.length) onSelect(next);
  }, [activeIdx, files.length, onSelect]);

  return (
    <>
      <div className="tabs-container" ref={containerRef} onWheel={onWheel}>
        {files.map((f, i) => {
          const dirty = f.content !== f.originalContent;
          const isDragOver = dragOverIdx === i;
          return (
            <div key={f.path}
              className={`tab ${i === activeIdx ? 'active' : ''} ${isDragOver ? 'drag-over' : ''}`}
              onClick={() => onSelect(i)}
              onDragStart={(e) => onDragStart(e, i)}
              onDragEnd={onDragEnd}
              onDragOver={(e) => onDragOver(e, i)}
              onDrop={(e) => onDrop(e, i)}
              onContextMenu={(e) => onContextMenu(e, i)}
              draggable
              title={f.path}
            >
              <span className="tab-name">{f.name}</span>
              {dirty && <span className="tab-modified" />}
              <button className="tab-close" onClick={(e) => { e.stopPropagation(); onClose(i); }}>
                <svg viewBox="0 0 16 16" width="12" height="12"><path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.4" /></svg>
              </button>
            </div>
          );
        })}
      </div>

      {ctxMenu && (
        <>
          <div className="context-menu-overlay" onClick={closeCtxMenu} />
          <div className="context-menu" style={{ left: ctxMenu.x, top: ctxMenu.y }}>
            <div className="context-menu-item" onClick={() => { onClose(ctxMenu.idx); closeCtxMenu(); }}>
              Close <span className="context-menu-shortcut">Ctrl+W</span>
            </div>
            <div className="context-menu-item" onClick={() => { onCloseOthers(ctxMenu.idx); closeCtxMenu(); }}>
              Close Others
            </div>
            <div className="context-menu-item" onClick={() => { onCloseAll(); closeCtxMenu(); }}>
              Close All
            </div>
            <div className="context-menu-sep" />
            <div className="context-menu-item" onClick={() => {
              for (let i = files.length - 1; i > ctxMenu.idx; i--) onClose(i);
              closeCtxMenu();
            }}>
              Close to the Right
            </div>
            <div className="context-menu-item" onClick={() => {
              const f = files[ctxMenu.idx];
              if (f) navigator.clipboard?.writeText(f.path);
              closeCtxMenu();
            }}>
              Copy Path
            </div>
          </div>
        </>
      )}
    </>
  );
}
