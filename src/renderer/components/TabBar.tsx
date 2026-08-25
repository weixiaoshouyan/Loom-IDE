import React, { useRef, useState, useCallback } from 'react';
import type { OpenFile } from '../App';
import { getFileIcon } from './FileIcons';
import { isFileDirty } from '../workspace-state';
import { t } from '@/shared/i18n';

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
  /** 钉住预览标签（点击标签 / 双击文件树）。 */
  onPin?: (path: string) => void;
  locale?: 'zh-CN' | 'en-US';
  staleFiles?: Set<string>;
}

function TabBar({ files, activeIdx, onSelect, onClose, onCloseAll, onCloseOthers, onReorder, onRun, onSplit, onRevert, onPin, staleFiles }: Props) {
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
        <div className="tabs-container" ref={containerRef} role="tablist" aria-label={t('tabs.editorTabs')}>
          {files.map((f, i) => {
            const dirty = f.dirty === true || (f.dirty === undefined && isFileDirty(f.content, f.originalContent));
            const isDragOver = dragOverIdx === i;
            const isStale = !!staleFiles?.has(f.path);
            const icon = getFileIcon(f.name, false, false);
            return (
              <div
                key={f.path}
                className={`tab ${i === activeIdx ? 'active' : ''} ${isDragOver ? 'drag-over' : ''} ${isStale ? 'stale' : ''} ${f.isPreview ? 'preview' : ''}`}
                onClick={() => { onSelect(i); if (f.isPreview) onPin?.(f.path); }}
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
                title={f.path + (f.isPreview ? `\n${t('tabs.previewHint')}` : '') + (isStale ? `\n${t('tabs.fileModifiedExternally')}` : '')}
              >
                <span className="tab-icon">{icon.svg}</span>
                <span className="tab-name">{f.name}</span>
                {isStale && (
                  <span
                    className="tab-stale"
                    title={t('tabs.reloadFile')}
                    onClick={(e) => { e.stopPropagation(); onRevert?.(i); }}
                  >⟳</span>
                )}
                {dirty ? (
                  <span
                    className="tab-modified"
                    onClick={(e) => { e.stopPropagation(); onSelect(i); }}
                    title={t('tabs.unsavedClickClose')}
                    style={{ cursor: 'pointer' }}
                  />
                ) : (
                  <button
                    className="tab-close"
                    onClick={(e) => { e.stopPropagation(); onClose(i); }}
                    title={t('tabs.close')}
                    aria-label={t('tabs.close')}
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
              title={t('tabs.runActiveFile')}
              className="tab-bar-action run"
              aria-label={t('tabs.runActiveFile')}
            >
              <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor">
                <path d="M4 2.69v10.62a.5.5 0 0 0 .757.429l8-5.31a.5.5 0 0 0 0-.858l-8-5.31A.5.5 0 0 0 4 2.69z"/>
              </svg>
            </button>
          )}
          {onSplit && (
            <button
              onClick={onSplit}
              title={t('tabs.splitEditor')}
              className="tab-bar-action split"
              aria-label={t('tabs.splitEditor')}
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
              <span>{t('tabs.close')}</span>
              <span className="context-menu-shortcut">Ctrl+W</span>
            </div>
            <div className="context-menu-item" onClick={() => { onCloseOthers(ctxMenu.idx); closeCtxMenu(); }}>
              <span>{t('tabs.closeOthers')}</span>
            </div>
            <div className="context-menu-item" onClick={() => { onCloseAll(); closeCtxMenu(); }}>
              <span>{t('tabs.closeAll')}</span>
            </div>
            <div className="context-menu-sep" />
            <div className="context-menu-item" onClick={() => {
              for (let i = files.length - 1; i > ctxMenu.idx; i--) onClose(i);
              closeCtxMenu();
            }}>
              <span>{t('tabs.closeToRight')}</span>
            </div>
            {onRevert && (
              <>
                <div className="context-menu-sep" />
                <div className="context-menu-item" onClick={() => { onRevert(ctxMenu.idx); closeCtxMenu(); }}>
                  <span>{t('tabs.reloadFile')}</span>
                </div>
              </>
            )}
            <div className="context-menu-sep" />
            <div className="context-menu-item" onClick={() => {
              const f = files[ctxMenu.idx];
              if (f) navigator.clipboard?.writeText(f.path);
              closeCtxMenu();
            }}>
              <span>{t('tabs.copyPath')}</span>
            </div>
            <div className="context-menu-item" onClick={() => {
              const f = files[ctxMenu.idx];
              if (f) navigator.clipboard?.writeText(f.name);
              closeCtxMenu();
            }}>
              <span>{t('tabs.copyFileName')}</span>
            </div>
          </div>
        </>
      )}
    </>
  );
}

export default React.memo(TabBar);
