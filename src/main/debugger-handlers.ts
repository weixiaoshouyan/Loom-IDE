/**
 * Debugger IPC — start/stop a language-appropriate debug session.
 *
 * SECURITY: validates that both the script path and working directory are in
 * the path-permissions allow-list before spawning any debugger process.
 */
import { ipcMain } from 'electron';
import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import { canAccess } from './path-permissions';

// Set by index.ts.
let resolvedMainWindow: { webContents: { send: (...args: any[]) => void; isDestroyed: () => boolean }; isDestroyed: () => boolean } | null = null;
export function setMainWindowForDebugger(w: any) { resolvedMainWindow = w; }

let debugProcess: ChildProcess | null = null;

function sendToRenderer(channel: string, ...args: any[]) {
  try {
    const win = resolvedMainWindow;
    if (!win) return;
    // Window may be destroyed while a debug process is emitting output —
    // reading `.webContents` on a destroyed BrowserWindow throws.
    if (typeof win.isDestroyed === 'function' && win.isDestroyed()) return;
    const wc = win.webContents;
    if (wc && !wc.isDestroyed()) wc.send(channel, ...args);
  } catch { /* window destroyed mid-send — drop the event */ }
}

function getDebugCommand(scriptPath: string, cwd: string): { cmd: string; args: string[]; port?: number } {
  const ext = path.extname(scriptPath).toLowerCase();
  const langMap: Record<string, { cmd: string; argsFn: (p: string) => string[]; port?: number }> = {
    '.js':   { cmd: 'node', argsFn: (p) => ['--inspect-brk=9229', p], port: 9229 },
    '.mjs':  { cmd: 'node', argsFn: (p) => ['--inspect-brk=9229', p], port: 9229 },
    '.cjs':  { cmd: 'node', argsFn: (p) => ['--inspect-brk=9229', p], port: 9229 },
    '.ts':   { cmd: 'npx', argsFn: (p) => ['tsx', '--inspect-brk=9229', p], port: 9229 },
    '.tsx':  { cmd: 'npx', argsFn: (p) => ['tsx', '--inspect-brk=9229', p], port: 9229 },
    '.py':   { cmd: 'python', argsFn: (p) => ['-m', 'pdb', p] },
    '.pyw':  { cmd: 'python', argsFn: (p) => ['-m', 'pdb', p] },
    '.go':   { cmd: 'dlv', argsFn: (p) => ['debug', p, '--headless', '--listen=:2345', '--api-version=2'], port: 2345 },
    '.rs':   { cmd: 'rust-gdb', argsFn: (p) => {
      const bin = p.replace(/\.rs$/, process.platform === 'win32' ? '.exe' : '');
      return ['--args', bin];
    } },
    '.java': { cmd: 'jdb', argsFn: (p) => {
      const cls = path.basename(p, '.java');
      return ['-classpath', path.dirname(p), cls];
    } },
    '.cs':   { cmd: 'dotnet', argsFn: () => ['run', '--project', cwd] },
    '.rb':   { cmd: 'ruby', argsFn: (p) => ['-rdebug', p] },
  };
  const cfg = langMap[ext] || { cmd: 'node', argsFn: (p) => ['--inspect-brk=9229', p], port: 9229 };
  return { cmd: cfg.cmd, args: cfg.argsFn(scriptPath), port: cfg.port };
}

export function registerDebuggerHandlers() {
  ipcMain.handle('debug:start', async (_event: any, scriptPath: string, cwd: string) => {
    try {
      if (!scriptPath || !canAccess(scriptPath)) {
        return { ok: false, message: 'Script path is not allowed: ' + scriptPath };
      }
      if (!cwd || !canAccess(cwd)) {
        return { ok: false, message: 'Working directory is not allowed: ' + cwd };
      }
      if (debugProcess) { debugProcess.kill(); debugProcess = null; }
      const { cmd, args, port } = getDebugCommand(scriptPath, cwd);
      debugProcess = spawn(cmd, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
      debugProcess.stdout?.on('data', (data: Buffer) => { sendToRenderer('debug:stdout', data.toString('utf-8')); });
      debugProcess.stderr?.on('data', (data: Buffer) => { sendToRenderer('debug:stderr', data.toString('utf-8')); });
      debugProcess.on('exit', (code) => {
        sendToRenderer('debug:exit', code);
        debugProcess = null;
      });
      const portMsg = port ? ` on port ${port}` : '';
      const ext = path.extname(scriptPath).toUpperCase();
      return { ok: true, message: `Debugger started for ${ext} file${portMsg}` };
    } catch (e: any) {
      return { ok: false, message: e.message };
    }
  });

  ipcMain.handle('debug:stop', async () => {
    try {
      if (debugProcess) { debugProcess.kill(); debugProcess = null; }
      return { ok: true };
    } catch (e: any) {
      return { ok: false, message: e.message };
    }
  });
}

export function killDebugger() {
  if (debugProcess) { try { debugProcess.kill(); } catch {} debugProcess = null; }
}
