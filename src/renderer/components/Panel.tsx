import React, { useState, useEffect, useRef, useCallback } from 'react';
import Terminal from './Terminal';
import DebugPanel from './DebugPanel';
import { getLoom } from '../loom-ipc';

interface Props {
  visible: boolean;
  height: number;
  onClose: () => void;
  onResize: (h: number) => void;
  problems: { severity: string; message: string; file?: string; line?: number }[];
  outputLines: string[];
  workspacePath?: string;
  /** Clicking a Problems entry opens the file (and jumps to the line). */
  onOpenFile?: (path: string, line?: number) => void;
}

// Safe expression evaluator for the Debug Console.
// Only supports arithmetic, parentheses, and a whitelist of Math functions/constants.
// This intentionally does NOT use new Function/eval to prevent arbitrary code execution.
const SAFE_MATH_FUNCS: Record<string, (...args: number[]) => number> = {
  sqrt: Math.sqrt, abs: Math.abs, sin: Math.sin, cos: Math.cos, tan: Math.tan,
  asin: Math.asin, acos: Math.acos, atan: Math.atan, atan2: Math.atan2,
  floor: Math.floor, ceil: Math.ceil, round: Math.round, trunc: Math.trunc,
  max: Math.max, min: Math.min, pow: Math.pow, log: Math.log, log2: Math.log2,
  log10: Math.log10, exp: Math.exp, random: Math.random,
};
const SAFE_MATH_CONSTS: Record<string, number> = { PI: Math.PI, E: Math.E };

function safeEvaluateExpression(expr: string): number {
  const trimmed = expr.trim();
  if (!trimmed) throw new Error('Empty expression');

  // Whitelist check: only allow numbers, operators, parentheses, commas, dots,
  // whitespace, and whitelisted identifiers.
  const tokenRegex = /(\d+\.?\d*|[-+*/%^(),]|\*\*|[A-Za-z_]\w*|[ \t]+)/g;
  const badChars = trimmed.replace(tokenRegex, '');
  if (badChars.length > 0) {
    throw new Error(`Disallowed characters in expression: ${badChars.slice(0, 20)}`);
  }

  // Tokenize
  const tokens: string[] = [];
  let m: RegExpExecArray | null;
  tokenRegex.lastIndex = 0;
  while ((m = tokenRegex.exec(trimmed)) !== null) {
    const tok = m[0];
    if (tok.trim()) tokens.push(tok);
  }

  let pos = 0;
  function peek() { return tokens[pos]; }
  function consume() { return tokens[pos++]; }

  function parseExpression(): number {
    let left = parseTerm();
    while (peek() === '+' || peek() === '-') {
      const op = consume();
      const right = parseTerm();
      left = op === '+' ? left + right : left - right;
    }
    return left;
  }

  function parseTerm(): number {
    let left = parsePower();
    while (peek() === '*' || peek() === '/' || peek() === '%') {
      const op = consume();
      const right = parsePower();
      if (op === '/' && right === 0) throw new Error('Division by zero');
      left = op === '*' ? left * right : op === '/' ? left / right : left % right;
    }
    return left;
  }

  function parsePower(): number {
    let left = parseFactor();
    while (peek() === '**') {
      consume();
      const right = parseFactor();
      left = Math.pow(left, right);
    }
    return left;
  }

  function parseFactor(): number {
    const tok = peek();
    if (tok === '+') { consume(); return parseFactor(); }
    if (tok === '-') { consume(); return -parseFactor(); }
    if (tok === '(') {
      consume();
      const val = parseExpression();
      if (peek() !== ')') throw new Error('Missing closing parenthesis');
      consume();
      return val;
    }
    if (tok === undefined) throw new Error('Unexpected end of expression');

    if (/^\d/.test(tok)) {
      consume();
      const n = Number(tok);
      if (Number.isNaN(n)) throw new Error(`Invalid number: ${tok}`);
      return n;
    }

    if (/^[A-Za-z_]/.test(tok)) {
      consume();
      if (SAFE_MATH_CONSTS[tok] !== undefined) return SAFE_MATH_CONSTS[tok];
      const fn = SAFE_MATH_FUNCS[tok];
      if (!fn) throw new Error(`Unknown identifier: ${tok}`);
      if (peek() !== '(') throw new Error(`Function ${tok} must be called with parentheses`);
      consume(); // '('
      const args: number[] = [];
      if (peek() !== ')') {
        args.push(parseExpression());
        while (peek() === ',') {
          consume();
          args.push(parseExpression());
        }
      }
      if (peek() !== ')') throw new Error(`Missing closing parenthesis for ${tok}`);
      consume();
      return fn(...args);
    }

    throw new Error(`Unexpected token: ${tok}`);
  }

  const value = parseExpression();
  if (pos < tokens.length) throw new Error(`Unexpected token: ${peek()}`);
  return value;
}

function Panel({ visible, height, onClose, onResize, problems, outputLines, workspacePath, onOpenFile }: Props) {
  const [activeTab, setActiveTab] = useState('terminal');
  const [termCount, setTermCount] = useState(1);
  const [activeTerm, setActiveTerm] = useState(0);
  const termIdsRef = useRef<string[]>(['term-0']);
  const [maximized, setMaximized] = useState(false);
  const [savedHeight, setSavedHeight] = useState(height);
  const [outputAutoScroll, setOutputAutoScroll] = useState(true);
  const [debugHistory, setDebugHistory] = useState<string[]>([]);
  const [debugInput, setDebugInput] = useState('');
  const [debugCmdHistory, setDebugCmdHistory] = useState<string[]>([]);
  const [debugHistIdx, setDebugHistIdx] = useState(-1);
  const outputRef = useRef<HTMLDivElement>(null);
  const debugEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (outputAutoScroll && outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [outputLines, outputAutoScroll]);

  useEffect(() => {
    debugEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [debugHistory]);

  useEffect(() => {
    const handler = (e: CustomEvent) => {
      const tabName = e.detail;
      if (tabName && ['problems', 'output', 'terminal', 'debug'].includes(tabName)) {
        setActiveTab(tabName);
        if (!visible) onResize(240);
      }
    };
    window.addEventListener('loom:open-panel-tab' as any, handler);
    return () => window.removeEventListener('loom:open-panel-tab' as any, handler);
  }, [visible, onResize]);

  const handleClear = () => {
    window.dispatchEvent(new CustomEvent('loom:clear-output'));
  };

  const handleMaximize = () => {
    if (maximized) {
      onResize(savedHeight);
      setMaximized(false);
    } else {
      setSavedHeight(height);
      onResize(Math.max(400, window.innerHeight - 120));
      setMaximized(true);
    }
  };

  const handleDebugEval = useCallback(async () => {
    const cmd = debugInput.trim();
    if (!cmd) return;
    setDebugCmdHistory(prev => [...prev, cmd]);
    setDebugHistIdx(-1);
    setDebugHistory(prev => [...prev, `› ${cmd}`]);
    try {
      const result = safeEvaluateExpression(cmd);
      const formatted = result === undefined ? 'undefined'
        : typeof result === 'object' ? JSON.stringify(result, null, 2)
        : String(result);
      setDebugHistory(prev => [...prev, formatted]);
    } catch (e: any) {
      setDebugHistory(prev => [...prev, `Error: ${e.message}`]);
    }
    setDebugInput('');
  }, [debugInput]);

  // 面板收起时不卸载子树：终端/调试器等有状态组件（PTY 进程、xterm 会话）
  // 必须跨收起/展开存活（VS Code 中终端不随面板关闭销毁）。用 display:none
  // 隐藏而非 return null，Terminal 的 ResizeObserver 会在重新显示时恢复尺寸。
  const errorCount = problems.filter(p => p.severity === 'error').length;
  const warnCount = problems.filter(p => p.severity === 'warning').length;

  const termTabs = Array.from({ length: termCount }, (_, i) => i);

  return (
    <div className="bottom-panel" style={{ height, display: visible ? undefined : 'none' }}>
      <div
        style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 4, cursor: 'row-resize', zIndex: 5 }}
        onMouseDown={(e) => {
          e.preventDefault();
          const startY = e.clientY;
          const startH = height;
          const onMove = (ev: MouseEvent) => onResize(Math.max(120, startH - (ev.clientY - startY)));
          const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
          window.addEventListener('mousemove', onMove);
          window.addEventListener('mouseup', onUp);
        }}
      />
      <div className="panel-header">
        <div className="panel-tabs">
          <div className={`panel-tab ${activeTab === 'problems' ? 'active' : ''}`} onClick={() => setActiveTab('problems')}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor">
                <path d="M8 1a7 7 0 100 14A7 7 0 008 1zm.75 4.5h-1.5v4h1.5v-4zm0 5h-1.5v1.5h1.5V10.5z" />
              </svg>
              PROBLEMS
            </span>
            {(errorCount > 0 || warnCount > 0) && (
              <span style={{ display: 'inline-flex', gap: 3, marginLeft: 6 }}>
                {errorCount > 0 && <span className="panel-tab-badge error">{errorCount}</span>}
                {warnCount > 0 && <span className="panel-tab-badge warning">{warnCount}</span>}
              </span>
            )}
          </div>
          <div className={`panel-tab ${activeTab === 'output' ? 'active' : ''}`} onClick={() => setActiveTab('output')}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor">
                <path d="M2 2h12v12H2V2zm1 1v10h10V3H3z" />
              </svg>
              OUTPUT
            </span>
          </div>
          <div className={`panel-tab ${activeTab === 'terminal' ? 'active' : ''}`} onClick={() => setActiveTab('terminal')}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor">
                <path d="M2 3h12v10H2V3zm1 1v8h10V4H3z" />
              </svg>
              TERMINAL
            </span>
            {termCount > 1 && <span style={{ fontSize: 10, marginLeft: 4, color: 'var(--text-muted)' }}>({termCount})</span>}
          </div>
          <div className={`panel-tab ${activeTab === 'debug' ? 'active' : ''}`} onClick={() => setActiveTab('debug')}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.2">
                <path d="M5.5 2L2 5.5 5.5 9M10.5 2L14 5.5 10.5 9M2 12h12" />
              </svg>
              DEBUG CONSOLE
            </span>
          </div>
          <div className={`panel-tab ${activeTab === 'runtime' ? 'active' : ''}`} onClick={() => setActiveTab('runtime')}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.2">
                <rect x="2" y="2" width="12" height="12" rx="1.5" />
                <path d="M5 8l2 2 4-4" />
              </svg>
              RUNTIME STATE
            </span>
          </div>
        </div>
        <div className="panel-actions">
          {activeTab === 'terminal' && (
            <>
              <button className="panel-action-btn" title="New Terminal" aria-label="New Terminal" onClick={() => {
                const newId = `term-${Date.now()}`;
                termIdsRef.current = [...termIdsRef.current, newId];
                setTermCount(c => c + 1);
                setActiveTerm(termCount);
              }}>
                <svg viewBox="0 0 16 16" width="14" height="14"><path d="M8 1v6M5 4l3-3 3 3" fill="none" stroke="currentColor" strokeWidth="1.2"/><path d="M2 13h12" stroke="currentColor" strokeWidth="1.2"/></svg>
              </button>
              {termCount > 1 && (
                <button className="panel-action-btn" title="Split Terminal" aria-label="Split Terminal" onClick={() => setTermCount(c => c + 1)}>
                  <svg viewBox="0 0 16 16" width="14" height="14"><rect x="1" y="2" width="14" height="12" rx="1" fill="none" stroke="currentColor" strokeWidth="1"/><line x1="8" y1="2" x2="8" y2="14" stroke="currentColor" strokeWidth="1"/></svg>
                </button>
              )}
            </>
          )}
          {activeTab === 'output' && (
            <button
              className={`panel-action-btn ${outputAutoScroll ? 'active' : ''}`}
              title={outputAutoScroll ? 'Auto-scroll ON' : 'Auto-scroll OFF'}
              aria-label={outputAutoScroll ? 'Auto-scroll ON' : 'Auto-scroll OFF'}
              onClick={() => setOutputAutoScroll(!outputAutoScroll)}
            >
              <svg viewBox="0 0 16 16" width="14" height="14"><path d="M8 2v8M5 7l3 3 3-3M3 13h10" fill="none" stroke="currentColor" strokeWidth="1.2"/></svg>
            </button>
          )}
          <button className="panel-action-btn" title="Clear" aria-label="Clear" onClick={handleClear}>
            <svg viewBox="0 0 16 16" width="14" height="14"><path d="M3 3l10 10" stroke="currentColor" strokeWidth="1.2"/><path d="M13 3L3 13" stroke="currentColor" strokeWidth="1.2"/></svg>
          </button>
          <button className="panel-action-btn" title="Maximize Panel" aria-label="Maximize Panel" onClick={handleMaximize}>
            <svg viewBox="0 0 16 16" width="14" height="14"><path d="M3 3h4v1H4v3H3V3zm6 0h4v4h-1V4H9V3zM3 9h1v3h3v1H3V9zm9 0h1v4h-4v-1h3V9z" fill="currentColor"/></svg>
          </button>
          <button className="panel-action-btn" title="Close Panel" aria-label="Close Panel" onClick={onClose}>
            <svg viewBox="0 0 16 16" width="14" height="14"><path d="M3 3l10 10" stroke="currentColor" strokeWidth="1.2"/><path d="M13 3L3 13" stroke="currentColor" strokeWidth="1.2"/></svg>
          </button>
        </div>
      </div>
      <div className="panel-content">
        {activeTab === 'terminal' && (
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            {termCount > 1 && (
              <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', background: 'var(--bg-panel-header)' }}>
                {termTabs.map(i => (
                  <div key={i} className={`panel-tab ${activeTerm === i ? 'active' : ''}`}
                    onClick={() => setActiveTerm(i)}
                    style={{ padding: '0 12px', height: 26, fontSize: 11, cursor: 'pointer', position: 'relative' }}>
                    Terminal {i + 1}
                    <span
                      style={{ display: 'inline-flex', marginLeft: 4, width: 16, height: 16, alignItems: 'center', justifyContent: 'center', borderRadius: 3 }}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (termCount <= 1) return;
                        const tid = termIdsRef.current[i];
                        if (tid) getLoom()?.terminal?.kill?.(tid);
                        termIdsRef.current = termIdsRef.current.filter((_, idx) => idx !== i);
                        if (activeTerm === i) setActiveTerm(Math.max(0, i - 1));
                        else if (activeTerm > i) setActiveTerm(t => Math.max(0, t - 1));
                        setTermCount(c => Math.max(1, c - 1));
                      }}
                    >
                      <svg viewBox="0 0 16 16" width="10" height="10"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" fill="none"/></svg>
                    </span>
                  </div>
                ))}
              </div>
            )}
            <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
              {termTabs.map(i => {
                const termId = termIdsRef.current[i] || `term-${i}`;
                return (
                  <div key={termId} style={{ flex: i === activeTerm ? 1 : 0.8, minWidth: 0, borderRight: i < termTabs.length - 1 ? '1px solid var(--border)' : undefined, display: i === activeTerm || termCount > 1 ? 'flex' : 'none' }}>
                    <Terminal visible={true} termId={termId} workspacePath={workspacePath} />
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {activeTab === 'problems' && (
          <div style={{ padding: '4px 8px', overflow: 'auto', height: '100%' }}>
            {problems.length === 0 ? (
              <div className="panel-empty-state">
                <svg viewBox="0 0 16 16" width="24" height="24" style={{ color: 'var(--green)' }}><path d="M8 1a7 7 0 100 14A7 7 0 008 1zm3.78 5.22l-4.5 5.5a.75.75 0 01-1.12.02l-2-2a.75.75 0 111.06-1.06l1.42 1.42 3.96-4.86a.75.75 0 011.18.98z" fill="currentColor"/></svg>
                <div>No problems detected</div>
              </div>
            ) : (
              problems.map((p, i) => (
                <div
                  key={i}
                  className="tree-item"
                  style={{ paddingLeft: 4, fontSize: 12, gap: 6, cursor: p.file ? 'pointer' : 'default' }}
                  title={p.file ? `${p.file}${p.line ? `:${p.line}` : ''}` : undefined}
                  onClick={() => onOpenFile && p.file && onOpenFile(p.file, p.line)}
                >
                  <span style={{ color: p.severity === 'error' ? 'var(--red)' : p.severity === 'warning' ? 'var(--yellow)' : 'var(--blue)', fontSize: 11, flexShrink: 0, fontWeight: 700 }}>
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
          <div ref={outputRef} style={{ padding: '4px 8px', overflow: 'auto', height: '100%', fontFamily: "'Cascadia Code', Consolas, monospace", fontSize: 12 }}>
            {outputLines.length === 0 ? (
              <div className="panel-empty-state">
                <svg viewBox="0 0 16 16" width="24" height="24" style={{ color: 'var(--text-muted)' }}><path d="M14 3H2l-.5.5v9l.5.5h12l.5-.5v-9L14 3zm-.5 9h-11v-8h11v8z" fill="currentColor"/></svg>
                <div>No output yet</div>
              </div>
            ) : (
              outputLines.map((line, i) => <div key={i} style={{ lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{line}</div>)
            )}
          </div>
        )}

        {activeTab === 'runtime' && (
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
            <DebugPanel />
          </div>
        )}

        {activeTab === 'debug' && (
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <div style={{ flex: 1, overflow: 'auto', padding: '4px 8px', fontFamily: "'Cascadia Code', Consolas, monospace", fontSize: 12 }}>
              {debugHistory.length === 0 ? (
                <div className="panel-empty-state">
                  <svg viewBox="0 0 16 16" width="24" height="24" style={{ color: 'var(--text-muted)' }}><path d="M5.5 2L2 5.5 5.5 9M10.5 2L14 5.5 10.5 9M2 12h12" fill="none" stroke="currentColor" strokeWidth="1.2"/></svg>
                  <div>Debug console ready. Type expressions below.</div>
                </div>
              ) : (
                debugHistory.map((line, i) => (
                  <div key={i} style={{ lineHeight: 1.6, color: line.startsWith('›') ? 'var(--text-primary)' : line.startsWith('Error') ? 'var(--red)' : 'var(--text-secondary)', whiteSpace: 'pre-wrap' }}>
                    {line}
                  </div>
                ))
              )}
              <div ref={debugEndRef} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', padding: '4px 8px', borderTop: '1px solid var(--border)', gap: 4 }}>
              <span style={{ color: 'var(--accent)', fontWeight: 700, fontSize: 12, flexShrink: 0 }}>›</span>
              <input
                style={{ flex: 1, height: 24, fontSize: 12, fontFamily: "'Cascadia Code', Consolas, monospace", background: 'transparent', border: 'none', color: 'var(--text-primary)', outline: 'none' }}
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

export default React.memo(Panel);
