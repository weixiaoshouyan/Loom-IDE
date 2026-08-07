import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import { getLoom } from './loom-ipc';
import './styles/globals.css';

const originalError = console.error.bind(console);

// Lightweight error reporter — sends renderer-side errors to main process for
// centralized logging (no absolute Windows paths, no fragile file IO).
function reportError(type: string, ...args: any[]) {
  try {
    const payload = {
      type,
      ts: new Date().toISOString(),
      msg: args.map(a => {
        if (a instanceof Error) return a.stack || a.message;
        if (typeof a === 'object') {
          try { return JSON.stringify(a); } catch { return String(a); }
        }
        return String(a);
      }).join(' '),
    };
    getLoom()?.reportError?.(payload);
  } catch { /* reporting failed, ignore */ }
}

console.error = (...args) => {
  reportError('ERROR', ...args);
  originalError.apply(console, args);
};

window.addEventListener('error', (e) => {
  reportError('UNHANDLED', e.message, `${e.filename}:${e.lineno}:${e.colno}`, e.error?.stack || '');
});

window.addEventListener('unhandledrejection', (e) => {
  const reason: any = e.reason;
  reportError('REJECTION', reason?.message || String(reason), reason?.stack || '');
});

const rootEl = document.getElementById('root');
if (!rootEl) {
  // Fail loudly so the blank-screen problem is visible in DevTools
  document.body.innerHTML =
    '<div style="font-family:system-ui;padding:24px;color:#f44747;background:#1e1e1e;height:100vh;">' +
    '<h2>Loom IDE 启动失败</h2>' +
    '<p>未找到 <code>#root</code> 元素。请检查 <code>src/renderer/index.html</code>。</p>' +
    '</div>';
  throw new Error('Fatal: #root element not found in HTML');
}

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <ErrorBoundary name="Loom IDE">
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
