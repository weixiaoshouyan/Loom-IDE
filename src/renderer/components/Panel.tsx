import React, { useState } from 'react';
import Terminal from './Terminal';

interface Props {
  visible: boolean;
  height: number;
  onClose: () => void;
  onResize: (h: number) => void;
  problems: { severity: string; message: string; file?: string; line?: number }[];
  outputLines: string[];
}

export default function Panel({ visible, height, onClose, onResize, problems, outputLines }: Props) {
  const [activeTab, setActiveTab] = useState('terminal');
  const [termCount, setTermCount] = useState(1);
  const [activeTerm, setActiveTerm] = useState(0);

  if (!visible) return null;

  const errorCount = problems.filter(p => p.severity === 'error').length;
  const warnCount = problems.filter(p => p.severity === 'warning').length;

  return (
    <div className="bottom-panel" style={{ height }}>
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 4, cursor: 'row-resize' }}
        onMouseDown={(e) => {
          const startY = e.clientY;
          const startH = height;
          const onMove = (ev: MouseEvent) => onResize(Math.max(100, startH - (ev.clientY - startY)));
          const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
          window.addEventListener('mousemove', onMove);
          window.addEventListener('mouseup', onUp);
        }}
      />
      <div className="panel-header">
        <div className="panel-tabs">
          <div className={`panel-tab ${activeTab === 'problems' ? 'active' : ''}`} onClick={() => setActiveTab('problems')}>
            PROBLEMS
            {(errorCount > 0 || warnCount > 0) && (
              <span className="panel-tab-badge" style={{ display: 'flex', gap: 2, marginLeft: 6 }}>
                {errorCount > 0 && <span className="panel-tab-badge error">{errorCount}</span>}
                {warnCount > 0 && <span className="panel-tab-badge warning">{warnCount}</span>}
              </span>
            )}
          </div>
          <div className={`panel-tab ${activeTab === 'output' ? 'active' : ''}`} onClick={() => setActiveTab('output')}>OUTPUT</div>
          <div className={`panel-tab ${activeTab === 'terminal' ? 'active' : ''}`} onClick={() => setActiveTab('terminal')}>
            TERMINAL {termCount > 1 && <span style={{ fontSize: 10, marginLeft: 4, color: 'var(--text-muted)' }}>({termCount})</span>}
          </div>
          <div className={`panel-tab ${activeTab === 'debug' ? 'active' : ''}`} onClick={() => setActiveTab('debug')}>DEBUG CONSOLE</div>
        </div>
        <div className="panel-actions">
          {activeTab === 'terminal' && (
            <>
              <button className="panel-action-btn" title="New Terminal" onClick={() => { setTermCount(c => c + 1); setActiveTerm(termCount); }}>
                <svg viewBox="0 0 16 16" width="14" height="14"><path d="M2 2h12v12H2V2zm1 1v10h10V3H3z" fill="none" stroke="currentColor" strokeWidth="1"/><path d="M5 8h6M8 5v6" stroke="currentColor" strokeWidth="1"/></svg>
              </button>
              <button className="panel-action-btn" title="Split Terminal">
                <svg viewBox="0 0 16 16" width="14" height="14"><rect x="1" y="2" width="14" height="12" rx="1" fill="none" stroke="currentColor" strokeWidth="1"/><line x1="8" y1="2" x2="8" y2="14" stroke="currentColor" strokeWidth="1"/></svg>
              </button>
            </>
          )}
          <button className="panel-action-btn" title="Clear">
            <svg viewBox="0 0 16 16" width="14" height="14"><path d="M3 3l10 10" stroke="currentColor" strokeWidth="1.2"/><path d="M13 3L3 13" stroke="currentColor" strokeWidth="1.2"/></svg>
          </button>
          <button className="panel-action-btn" title="Maximize Panel">
            <svg viewBox="0 0 16 16" width="14" height="14"><path d="M3 3h4v1H4v3H3V3zm6 0h4v4h-1V4H9V3zM3 9h1v3h3v1H3V9zm9 0h1v4h-4v-1h3V9z" fill="currentColor"/></svg>
          </button>
          <button className="panel-action-btn" title="Close Panel" onClick={onClose}>
            <svg viewBox="0 0 16 16" width="14" height="14"><path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.2"/></svg>
          </button>
        </div>
      </div>
      <div className="panel-content">
        {activeTab === 'terminal' && (
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            {termCount > 1 && (
              <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', background: 'var(--bg-panel-header)' }}>
                {Array.from({ length: termCount }, (_, i) => (
                  <div key={i} className={`panel-tab ${activeTerm === i ? 'active' : ''}`}
                    onClick={() => setActiveTerm(i)}
                    style={{ padding: '0 12px', height: 26, fontSize: 11, cursor: 'pointer' }}>
                    Terminal {i + 1}
                    {termCount > 1 && (
                      <span className="tab-close" style={{ display: 'inline-flex', marginLeft: 4, width: 14, height: 14 }}
                        onClick={(e) => { e.stopPropagation(); if (termCount > 1) setTermCount(c => Math.max(1, c - 1)); }}>
                        <svg viewBox="0 0 16 16" width="10" height="10"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5"/></svg>
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
            <div style={{ flex: 1 }}>
              <Terminal visible={true} termId={`term-${activeTerm}`} />
            </div>
          </div>
        )}
        {activeTab === 'problems' && (
          <div style={{ padding: '4px 8px', overflow: 'auto', height: '100%' }}>
            {problems.length === 0 ? (
              <div style={{ padding: '8px', color: 'var(--text-muted)', fontSize: 12 }}>No problems have been detected in the workspace.</div>
            ) : (
              problems.map((p, i) => (
                <div key={i} className="tree-item" style={{ paddingLeft: 4, fontSize: 12, gap: 6 }}>
                  <span style={{ color: p.severity === 'error' ? 'var(--red)' : p.severity === 'warning' ? 'var(--yellow)' : 'var(--blue)', fontSize: 10, flexShrink: 0 }}>
                    {p.severity === 'error' ? '●' : p.severity === 'warning' ? '▲' : 'ℹ'}
                  </span>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.message}</span>
                  {p.file && <span style={{ color: 'var(--text-muted)', fontSize: 11, flexShrink: 0 }}>{p.file.split(/[\\/]/).pop()}{p.line ? `:${p.line}` : ''}</span>}
                </div>
              ))
            )}
          </div>
        )}
        {activeTab === 'output' && (
          <div style={{ padding: '4px 8px', overflow: 'auto', height: '100%', fontFamily: "'Cascadia Code', Consolas, monospace", fontSize: 12 }}>
            {outputLines.length === 0 ? (
              <div style={{ padding: '8px', color: 'var(--text-muted)' }}>No output available.</div>
            ) : (
              outputLines.map((line, i) => <div key={i} style={{ lineHeight: 1.5 }}>{line}</div>)
            )}
          </div>
        )}
        {activeTab === 'debug' && (
          <div style={{ padding: '4px 8px', overflow: 'auto', height: '100%', fontFamily: "'Cascadia Code', Consolas, monospace", fontSize: 12 }}>
            <div style={{ padding: '8px', color: 'var(--text-muted)' }}>Debug console is ready. Start debugging with F5.</div>
          </div>
        )}
      </div>
    </div>
  );
}
