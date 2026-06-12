import React, { useState, useEffect, useRef, useCallback } from 'react';
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
  const [maximized, setMaximized] = useState(false);
  const [savedHeight, setSavedHeight] = useState(height);
  const [outputAutoScroll, setOutputAutoScroll] = useState(true);
  const [debugHistory, setDebugHistory] = useState<string[]>([]);
  const [debugInput, setDebugInput] = useState('');
  const [debugCmdHistory, setDebugCmdHistory] = useState<string[]>([]);
  const [debugHistIdx, setDebugHistIdx] = useState(-1);
  const outputRef = useRef<HTMLDivElement>(null);
  const debugEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll output when new lines arrive
  useEffect(() => {
    if (outputAutoScroll && outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [outputLines, outputAutoScroll]);

  // Scroll debug console to bottom
  useEffect(() => {
    debugEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [debugHistory]);

  const handleClear = () => {
    window.dispatchEvent(new CustomEvent('loom:clear-output'));
  };

  const handleMaximize = () => {
    if (maximized) {
      onResize(savedHeight);
      setMaximized(false);
    } else {
      setSavedHeight(height);
      onResize(Math.max(600, window.innerHeight - 100));
      setMaximized(true);
    }
  };

  const handleDebugEval = useCallback(async () => {
    const cmd = debugInput.trim();
    if (!cmd) return;
    setDebugCmdHistory(prev => [...prev, cmd]);
    setDebugHistIdx(-1);
    setDebugHistory(prev => [...prev, `> ${cmd}`]);
    try {
      const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
      const fn = new AsyncFunction('"use strict"; return (' + cmd + ')');
      const result = await fn();
      setDebugHistory(prev => [...prev, result === undefined ? 'undefined' : String(result)]);
    } catch (e: any) {
      setDebugHistory(prev => [...prev, `Error: ${e.message}`]);
    }
    setDebugInput('');
  }, [debugInput]);

  if (!visible) return null;

  const errorCount = problems.filter(p => p.severity === 'error').length;
  const warnCount = problems.filter(p => p.severity === 'warning').length;

  const termTabs = Array.from({ length: termCount }, (_, i) => i);

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
              {termCount > 1 && (
                <button className="panel-action-btn" title="Split Terminal" onClick={() => setTermCount(c => c + 1)}>
                  <svg viewBox="0 0 16 16" width="14" height="14"><rect x="1" y="2" width="14" height="12" rx="1" fill="none" stroke="currentColor" strokeWidth="1"/><line x1="8" y1="2" x2="8" y2="14" stroke="currentColor" strokeWidth="1"/></svg>
                </button>
              )}
            </>
          )}
          {activeTab === 'output' && (
            <button className={`panel-action-btn ${outputAutoScroll ? 'active' : ''}`} title={outputAutoScroll ? 'Auto-scroll ON' : 'Auto-scroll OFF'}
              onClick={() => setOutputAutoScroll(!outputAutoScroll)}>
              <svg viewBox="0 0 16 16" width="14" height="14"><path d="M8 2v8M5 7l3 3 3-3M3 13h10" fill="none" stroke="currentColor" strokeWidth="1.2"/></svg>
            </button>
          )}
          <button className="panel-action-btn" title="Clear" onClick={handleClear}>
            <svg viewBox="0 0 16 16" width="14" height="14"><path d="M3 3l10 10" stroke="currentColor" strokeWidth="1.2"/><path d="M13 3L3 13" stroke="currentColor" strokeWidth="1.2"/></svg>
          </button>
          <button className="panel-action-btn" title="Maximize Panel" onClick={handleMaximize}>
            <svg viewBox="0 0 16 16" width="14" height="14"><path d="M3 3h4v1H4v3H3V3zm6 0h4v4h-1V4H9V3zM3 9h1v3h3v1H3V9zm9 0h1v4h-4v-1h3V9z" fill="currentColor"/></svg>
          </button>
          <button className="panel-action-btn" title="Close Panel" onClick={onClose}>
            <svg viewBox="0 0 16 16" width="14" height="14"><path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.2"/></svg>
          </button>
        </div>
      </div>
      <div className="panel-content">
        {/* Terminal Tab */}
        {activeTab === 'terminal' && (
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            {termCount > 1 && (
              <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', background: 'var(--bg-panel-header)' }}>
                {termTabs.map(i => (
                  <div key={i} className={`panel-tab ${activeTerm === i ? 'active' : ''}`}
                    onClick={() => setActiveTerm(i)}
                    style={{ padding: '0 12px', height: 26, fontSize: 11, cursor: 'pointer', position: 'relative' }}>
                    Terminal {i + 1}
                    {termCount > 1 && (
                      <span className="tab-close" style={{ display: 'inline-flex', marginLeft: 4, width: 14, height: 14 }}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (termCount <= 1) return;
                          // Kill the terminal process
                          (window as any).loom?.terminal?.kill?.(`term-${i}`);
                          if (activeTerm === i) setActiveTerm(Math.max(0, i - 1));
                          else if (activeTerm > i) setActiveTerm(t => Math.max(0, t - 1));
                          setTermCount(c => Math.max(1, c - 1));
                        }}>
                        <svg viewBox="0 0 16 16" width="10" height="10"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5"/></svg>
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
            {termCount <= 2 ? (
              <div style={{ display: 'flex', flex: 1 }}>
                {termTabs.map(i => (
                  <div key={i} style={{ flex: i === activeTerm ? 1 : 0.8, borderRight: i < termTabs.length - 1 ? '1px solid var(--border)' : undefined, display: i === activeTerm ? 'flex' : (termCount > 1 ? 'flex' : 'none') }}>
                    <Terminal visible={true} termId={`term-${i}`} />
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ flex: 1 }}>
                <Terminal visible={true} termId={`term-${activeTerm}`} />
              </div>
            )}
          </div>
        )}

        {/* Problems Tab */}
        {activeTab === 'problems' && (
          <div style={{ padding: '4px 8px', overflow: 'auto', height: '100%' }}>
            {problems.length === 0 ? (
              <div className="panel-empty-state">
                <svg viewBox="0 0 16 16" width="24" height="24" style={{ color: 'var(--text-muted)', marginBottom: 8 }}><path d="M8 1a7 7 0 100 14A7 7 0 008 1zm3.78 5.22l-4.5 5.5a.75.75 0 01-1.12.02l-2-2a.75.75 0 111.06-1.06l1.42 1.42 3.96-4.86a.75.75 0 111.18.98z" fill="currentColor"/></svg>
                <div>No problems detected</div>
              </div>
            ) : (
              problems.map((p, i) => (
                <div key={i} className="tree-item" style={{ paddingLeft: 4, fontSize: 12, gap: 6 }}>
                  <span style={{ color: p.severity === 'error' ? 'var(--red)' : p.severity === 'warning' ? 'var(--yellow)' : 'var(--blue)', fontSize: 10, flexShrink: 0 }}>
                    {p.severity === 'error' ? '\u25cf' : p.severity === 'warning' ? '\u25b2' : '\u2139'}
                  </span>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.message}</span>
                  {p.file && <span style={{ color: 'var(--text-muted)', fontSize: 11, flexShrink: 0 }}>{p.file.split(/[\\/]/).pop()}{p.line ? `:${p.line}` : ''}</span>}
                </div>
              ))
            )}
          </div>
        )}

        {/* Output Tab with Auto-scroll */}
        {activeTab === 'output' && (
          <div ref={outputRef} style={{ padding: '4px 8px', overflow: 'auto', height: '100%', fontFamily: "'Cascadia Code', Consolas, monospace", fontSize: 12 }}>
            {outputLines.length === 0 ? (
              <div className="panel-empty-state">
                <svg viewBox="0 0 16 16" width="24" height="24" style={{ color: 'var(--text-muted)', marginBottom: 8 }}><path d="M14 3H2l-.5.5v9l.5.5h12l.5-.5v-9L14 3zm-.5 9h-11v-8h11v8z" fill="currentColor"/></svg>
                <div>No output yet</div>
              </div>
            ) : (
              outputLines.map((line, i) => <div key={i} style={{ lineHeight: 1.5 }}>{line}</div>)
            )}
          </div>
        )}

        {/* Debug Console REPL */}
        {activeTab === 'debug' && (
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <div style={{ flex: 1, overflow: 'auto', padding: '4px 8px', fontFamily: "'Cascadia Code', Consolas, monospace", fontSize: 12 }}>
              {debugHistory.length === 0 ? (
                <div className="panel-empty-state">
                  <svg viewBox="0 0 16 16" width="24" height="24" style={{ color: 'var(--text-muted)', marginBottom: 8 }}><path d="M5.5 2L2 5.5 5.5 9M10.5 2L14 5.5 10.5 9M2 12h12" fill="none" stroke="currentColor" strokeWidth="1.2"/></svg>
                  <div>Debug console ready. Type expressions below.</div>
                </div>
              ) : (
                debugHistory.map((line, i) => (
                  <div key={i} style={{ lineHeight: 1.6, color: line.startsWith('>') ? 'var(--text-primary)' : line.startsWith('Error') ? 'var(--red)' : 'var(--text-secondary)' }}>
                    {line}
                  </div>
                ))
              )}
              <div ref={debugEndRef} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', padding: '4px 8px', borderTop: '1px solid var(--border)', gap: 4 }}>
              <span style={{ color: 'var(--accent)', fontWeight: 700, fontSize: 12, flexShrink: 0 }}>&gt;</span>
              <input
                style={{ flex: 1, height: 22, fontSize: 12, fontFamily: "'Cascadia Code', Consolas, monospace", background: 'transparent', border: 'none', color: 'var(--text-primary)', outline: 'none' }}
                placeholder="Evaluate expression..."
                value={debugInput}
                onChange={e => setDebugInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') handleDebugEval();
                  if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    if (debugCmdHistory.length > 0) {
                      const newIdx = debugHistIdx + 1;
                      if (newIdx < debugCmdHistory.length) {
                        setDebugHistIdx(newIdx);
                        setDebugInput(debugCmdHistory[debugCmdHistory.length - 1 - newIdx]);
                      }
                    }
                  }
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    if (debugHistIdx > 0) {
                      const newIdx = debugHistIdx - 1;
                      setDebugHistIdx(newIdx);
                      setDebugInput(debugCmdHistory[debugCmdHistory.length - 1 - newIdx]);
                    } else {
                      setDebugHistIdx(-1);
                      setDebugInput('');
                    }
                  }
                }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
