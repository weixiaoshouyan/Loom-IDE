import React, { useState, useCallback } from 'react';
import Editor from './Editor';
import type { OpenFile } from '../App';

interface Props {
  openFiles: OpenFile[];
  leftIdx: number;
  rightIdx: number;
  splitDirection: 'horizontal' | 'vertical';
  splitRatio: number;
  onLeftIdxChange: (idx: number) => void;
  onRightIdxChange: (idx: number) => void;
  onRatioChange: (ratio: number) => void;
  onContentChange: (path: string, content: string) => void;
  onCloseSplit: (side: 'left' | 'right') => void;
  onFocusSide: (side: 'left' | 'right') => void;
  focusSide: 'left' | 'right';
  workspacePath?: string;
}

export default function EditorGroup({
  openFiles, leftIdx, rightIdx, splitDirection, splitRatio,
  onLeftIdxChange, onRightIdxChange, onRatioChange,
  onContentChange, onCloseSplit, onFocusSide, focusSide,
  workspacePath,
}: Props) {
  const [dragging, setDragging] = useState(false);
  const isHorizontal = splitDirection === 'horizontal';

  const onDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setDragging(true);
    const startX = e.clientX;
    const startY = e.clientY;
    const startRatio = splitRatio;
    const container = (e.target as HTMLElement).parentElement;
    if (!container) return;
    const rect = container.getBoundingClientRect();

    const onMove = (ev: MouseEvent) => {
      if (isHorizontal) {
        const pct = ((ev.clientX - rect.left) / rect.width) * 100;
        onRatioChange(Math.max(20, Math.min(80, pct)));
      } else {
        const pct = ((ev.clientY - rect.top) / rect.height) * 100;
        onRatioChange(Math.max(20, Math.min(80, pct)));
      }
    };
    const onUp = () => {
      setDragging(false);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [splitRatio, isHorizontal, onRatioChange]);

  const leftFile = openFiles[leftIdx] || null;
  const rightFile = openFiles[rightIdx] || null;
  const openFilePaths = openFiles.map(f => f.path);

  const renderTabBar = (activeIdx: number, onIdxChange: (i: number) => void, side: 'left' | 'right') => (
    <div className="split-tabs-container">
      {openFiles.map((f, i) => {
        const dirty = f.content !== f.originalContent;
        return (
          <div key={f.path}
            className={`tab ${i === activeIdx ? 'active' : ''}`}
            onClick={() => { onIdxChange(i); onFocusSide(side); }}>
            <span className="tab-name">{f.name}</span>
            {dirty && <span className="tab-modified" />}
          </div>
        );
      })}
      <button className="split-close-btn" onClick={() => onCloseSplit(side)} title="Close split">
        <svg viewBox="0 0 16 16" width="12" height="12"><path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.4" /></svg>
      </button>
    </div>
  );

  const style = isHorizontal
    ? { flexDirection: 'row' as const }
    : { flexDirection: 'column' as const };

  return (
    <div className="editor-split" style={style}>
      <div
        className={`split-pane ${focusSide === 'left' ? 'focused' : ''}`}
        style={{ flex: `0 0 ${splitRatio}%` }}
        onClick={() => onFocusSide('left')}
      >
        {renderTabBar(leftIdx, onLeftIdxChange, 'left')}
        <div className="split-editor-wrapper">
          <Editor file={leftFile} openFilePaths={openFilePaths} onContentChange={onContentChange} workspacePath={workspacePath} />
        </div>
      </div>

      <div
        className={`split-divider ${isHorizontal ? 'horizontal' : 'vertical'} ${dragging ? 'dragging' : ''}`}
        onMouseDown={onDragStart}
      />

      <div
        className={`split-pane ${focusSide === 'right' ? 'focused' : ''}`}
        style={{ flex: 1 }}
        onClick={() => onFocusSide('right')}
      >
        {renderTabBar(rightIdx, onRightIdxChange, 'right')}
        <div className="split-editor-wrapper">
          <Editor file={rightFile} openFilePaths={openFilePaths} onContentChange={onContentChange} workspacePath={workspacePath} />
        </div>
      </div>
    </div>
  );
}
