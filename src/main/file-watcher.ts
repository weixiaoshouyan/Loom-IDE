/**
 * File watcher — recursive fs.watch with debounced change events.
 *
 * Routes change notifications through `mainWindow?.webContents` (set by index.ts)
 * rather than a captured event.sender, matching the terminal module's approach.
 */
import { ipcMain } from 'electron';
import fs from 'fs';

let resolvedMainWindow: { webContents: { send: (...args: any[]) => void; isDestroyed: () => boolean }; isDestroyed: () => boolean } | null = null;
export function setMainWindowForWatcher(w: any) { resolvedMainWindow = w; }

let fileWatcher: fs.FSWatcher | null = null;
let watchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
const watchedPaths = new Set<string>();

function sendToRenderer(channel: string, ...args: any[]) {
  try {
    const win = resolvedMainWindow;
    if (!win) return;
    // Window may be destroyed while a watcher event is in flight — reading
    // `.webContents` on a destroyed BrowserWindow throws.
    if (typeof win.isDestroyed === 'function' && win.isDestroyed()) return;
    const wc = win.webContents;
    if (wc && !wc.isDestroyed()) wc.send(channel, ...args);
  } catch { /* window destroyed mid-send — drop the event */ }
}

// Ignore build artifacts and dependency directories to reduce event/handle
// pressure on Windows recursive watchers.
function isIgnoredWatchPath(filename: string): boolean {
  const lower = filename.toLowerCase().replace(/\\/g, '/');
  return /(^|[\\/])(node_modules|dist|release|\.git|\.workbuddy|__pycache__|\.next|coverage|\.venv)([\\/]|$)/.test(lower)
    || lower.includes('/.loom-index/')
    || lower.endsWith('.loom-index');
}

export function registerFileWatcherHandlers() {
  ipcMain.handle('watcher:start', (_e: any, cwd: string) => {
    stopFileWatcher();
    try {
      // Lazy import to avoid circular dependency at module load.
      const { ensurePathAllowed } = require('./path-permissions');
      ensurePathAllowed(cwd);
      fileWatcher = fs.watch(cwd, { recursive: true }, (_eventType: string, filename: string | null) => {
        if (!filename) return;
        const rel = filename.toString();
        if (isIgnoredWatchPath(rel)) return;
        if (watchedPaths.has(rel)) return;
        watchedPaths.add(rel);
        // Debounce: collect changes over 300ms, then emit.
        if (watchDebounceTimer) clearTimeout(watchDebounceTimer);
        watchDebounceTimer = setTimeout(() => {
          const allChanged = [...watchedPaths];
          watchedPaths.clear();
          sendToRenderer('watcher:change', cwd, allChanged);
        }, 300);
      });
      fileWatcher.on('error', (err: Error) => {
        console.error('File watcher error:', err);
      });
      return true;
    } catch (e: any) {
      console.error('Failed to start file watcher:', e);
      return false;
    }
  });

  ipcMain.handle('watcher:stop', () => {
    stopFileWatcher();
    return true;
  });
}

export function stopFileWatcher() {
  if (fileWatcher) {
    try { fileWatcher.close(); } catch {}
    fileWatcher = null;
  }
  if (watchDebounceTimer) {
    clearTimeout(watchDebounceTimer);
    watchDebounceTimer = null;
  }
  watchedPaths.clear();
}
