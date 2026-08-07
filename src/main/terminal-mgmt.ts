/**
 * Terminal management — PTY + fallback spawn, with IPC registration.
 *
 * Multi-window fix: callbacks no longer capture `event.sender` (which is tied
 * to the sending window and breaks when that window closes). Instead we route
 * all terminal output through `mainWindow?.webContents`, which always targets
 * the current primary window.
 */
import { ipcMain } from 'electron';
import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import { canAccess } from './path-permissions';

// Set by index.ts after the window is created.
let resolvedMainWindow: { webContents: { send: (...args: any[]) => void; isDestroyed: () => boolean } } | null = null;
export function setMainWindow(w: any) { resolvedMainWindow = w; }

// Lazily-loaded node-pty spawn.
let ptySpawn: any = null;
function getPty(): any {
  if (!ptySpawn) {
    try { ptySpawn = require('node-pty').spawn; } catch { return null; }
  }
  return ptySpawn;
}

interface TerminalEntry {
  process: any;
  id: string;
  isPty: boolean;
  /** webContents id that created this terminal — write/resize/kill must match. */
  ownerId: number;
}

const terminals = new Map<string, TerminalEntry>();

// termId is user-supplied (used as Map key and echoed back to the renderer):
// reject anything that is not a plain identifier to avoid key confusion.
function isValidTermId(termId: string): boolean {
  return typeof termId === 'string' && termId.length > 0 && termId.length <= 128 && /^[\w.:-]+$/.test(termId);
}

/** Only allow starting the shell inside a path the renderer is permitted to use. */
function resolveShellCwd(requested: string | undefined): string {
  if (requested && canAccess(requested)) return requested;
  return process.env.USERPROFILE || process.env.HOME || '';
}

/**
 * Send terminal data to the renderer through the main window (never through
 * a captured event.sender, which becomes invalid when its window closes).
 */
function sendToRenderer(channel: string, ...args: any[]) {
  const wc = resolvedMainWindow?.webContents;
  if (wc && !wc.isDestroyed()) wc.send(channel, ...args);
}

export function registerTerminalHandlers() {
  ipcMain.handle('terminal:create', async (event: any, termId: string, cwd?: string) => {
    if (!isValidTermId(termId)) return false;
    const ptyFn = getPty();
    const shellCmd = process.env.ComSpec || 'powershell.exe';
    // SECURITY: shell starts in the workspace (or user home), never in an
    // arbitrary attacker-chosen directory.
    const shellCwd = resolveShellCwd(cwd);

    if (ptyFn) {
      try {
        const ptyProcess = ptyFn(shellCmd, [], {
          name: 'xterm-256color',
          cols: 80,
          rows: 24,
          cwd: shellCwd,
          env: process.env as { [key: string]: string },
        });
        terminals.set(termId, { process: ptyProcess, id: termId, isPty: true, ownerId: event.sender.id });
        ptyProcess.onData((data: string) => {
          sendToRenderer('terminal:data', termId, data);
        });
        ptyProcess.onExit((code: { exitCode: number }) => {
          sendToRenderer('terminal:exit', termId, code.exitCode);
          terminals.delete(termId);
        });
        return true;
      } catch (e) {
        console.error('PTY creation failed, falling back to spawn:', e);
      }
    }

    // Fallback: child_process spawn.
    const isPowerShell = shellCmd.toLowerCase().includes('powershell');
    const args = isPowerShell ? ['-NoLogo'] : [];
    const child = spawn(shellCmd, args, {
      cwd: shellCwd,
      env: { ...process.env, TERM: 'xterm-256color' },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    terminals.set(termId, { process: child, id: termId, isPty: false, ownerId: event.sender.id });
    child.stdout?.on('data', (data: Buffer) => { sendToRenderer('terminal:data', termId, data.toString('utf-8')); });
    child.stderr?.on('data', (data: Buffer) => { sendToRenderer('terminal:data', termId, data.toString('utf-8')); });
    child.on('exit', (code: number | null) => { sendToRenderer('terminal:exit', termId, code); terminals.delete(termId); });
    return true;
  });

  ipcMain.on('terminal:write', (event: any, termId: string, data: string) => {
    const t = terminals.get(termId);
    // SECURITY: only the window that created the terminal may write to it.
    if (!t || t.ownerId !== event.sender.id) return;
    // Cap a single write to 64 KB — larger payloads are never legitimate and
    // would only abuse the pty buffer.
    const chunk = typeof data === 'string' ? data.slice(0, 64 * 1024) : '';
    if (t.isPty) {
      t.process.write(chunk);
    } else {
      t.process.stdin?.write(chunk);
    }
  });

  ipcMain.on('terminal:resize', (event: any, termId: string, cols: number, rows: number) => {
    const t = terminals.get(termId);
    if (!t || t.ownerId !== event.sender.id) return;
    // Clamp to sane finite bounds — NaN/negative/huge values have undefined
    // behavior in node-pty.
    const c = Math.min(10000, Math.max(1, Math.floor(Number(cols) || 80)));
    const r = Math.min(10000, Math.max(1, Math.floor(Number(rows) || 24)));
    if (t.isPty) {
      try { t.process.resize(c, r); } catch (e) { console.error('Terminal resize error:', e); }
    }
  });

  ipcMain.on('terminal:kill', (event: any, termId: string) => {
    const t = terminals.get(termId);
    // SECURITY: only the window that created the terminal may kill it.
    if (!t || t.ownerId !== event.sender.id) return;
    try { t.process.kill(); } catch (e) { console.error('Terminal kill error:', e); }
    terminals.delete(termId);
  });
}

/** Kill all terminals (called from app.on('window-all-closed')). */
export function killAllTerminals() {
  terminals.forEach((t) => { try { t.process.kill(); } catch {} });
  terminals.clear();
}

// Exported for the Debug panel — snapshots the live terminal table for display.
export function getActiveTerminalsSnapshot(): { id: string; shell: string; isPty: boolean; pid: number | null }[] {
  const shellCmd = process.env.ComSpec || 'powershell.exe';
  const out: { id: string; shell: string; isPty: boolean; pid: number | null }[] = [];
  terminals.forEach((t) => {
    out.push({ id: t.id, shell: shellCmd, isPty: t.isPty, pid: t.process?.pid ?? null });
  });
  return out;
}

// Re-export for any code that needs the map directly.
export { terminals };
