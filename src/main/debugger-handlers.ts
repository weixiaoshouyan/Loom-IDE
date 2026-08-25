/**
 * Debugger IPC — Node/TS 真断点调试（基于 Node inspector CDP）。
 *
 * 相比旧版（只 spawn --inspect-brk 裸跑）：
 *   - 启动后自动连接 CDP WebSocket（InspectorClient）并启用 Debugger 域；
 *   - 支持 继续/暂停/单步（over/into/out）、按 URL+行号设置断点；
 *   - Debugger.paused 时把调用栈与顶层作用域变量推给渲染进程。
 *
 * SECURITY: 启动前校验脚本路径与工作目录在路径权限允许列表内。
 */
import { ipcMain } from 'electron';
import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import { canAccess } from './path-permissions';
import { InspectorClient, waitForInspectorEndpoint, InspectorPausedEvent } from './inspector-client';

// Set by index.ts.
let resolvedMainWindow: { webContents: { send: (...args: any[]) => void; isDestroyed: () => boolean }; isDestroyed: () => boolean } | null = null;
export function setMainWindowForDebugger(w: any) { resolvedMainWindow = w; }

let debugProcess: ChildProcess | null = null;
let inspector: InspectorClient | null = null;
let debugPort = 9229;

function sendToRenderer(channel: string, ...args: any[]) {
  try {
    const win = resolvedMainWindow;
    if (!win) return;
    if (typeof win.isDestroyed === 'function' && win.isDestroyed()) return;
    const wc = win.webContents;
    if (wc && !wc.isDestroyed()) wc.send(channel, ...args);
  } catch { /* window destroyed mid-send — drop the event */ }
}

function getDebugCommand(scriptPath: string, cwd: string): { cmd: string; args: string[]; port?: number } {
  const ext = path.extname(scriptPath).toLowerCase();
  const langMap: Record<string, { cmd: string; argsFn: (p: string) => string[]; port?: number }> = {
    '.js':   { cmd: 'node', argsFn: (p) => [`--inspect-brk=${debugPort}`, p], port: debugPort },
    '.mjs':  { cmd: 'node', argsFn: (p) => [`--inspect-brk=${debugPort}`, p], port: debugPort },
    '.cjs':  { cmd: 'node', argsFn: (p) => [`--inspect-brk=${debugPort}`, p], port: debugPort },
    '.ts':   { cmd: 'npx', argsFn: (p) => ['tsx', `--inspect-brk=${debugPort}`, p], port: debugPort },
    '.tsx':  { cmd: 'npx', argsFn: (p) => ['tsx', `--inspect-brk=${debugPort}`, p], port: debugPort },
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
  const cfg = langMap[ext] || { cmd: 'node', argsFn: (p) => [`--inspect-brk=${debugPort}`, p], port: debugPort };
  return { cmd: cfg.cmd, args: cfg.argsFn(scriptPath), port: cfg.port };
}

/** 是否支持 CDP 断点调试（Node/TS 走 inspector；其他语言降级为裸跑）。 */
function supportsCdp(scriptPath: string): boolean {
  const ext = path.extname(scriptPath).toLowerCase();
  return ['.js', '.mjs', '.cjs', '.ts', '.tsx'].includes(ext);
}

async function connectInspector(port: number): Promise<boolean> {
  try {
    const url = await waitForInspectorEndpoint(port, 15000);
    const client = new InspectorClient();
    client.onEvent = (method, params) => {
      if (method === 'Debugger.paused' && params?.callFrames) {
        const evt: InspectorPausedEvent = { callFrames: params.callFrames, reason: params.reason };
        const stack = evt.callFrames.map((f) => ({
          functionName: f.functionName || '(anonymous)',
          url: f.url || '',
          line: f.location.lineNumber + 1,
          callFrameId: f.callFrameId,
        }));
        // 顶层帧的局部变量（尽力而为）
        const top = evt.callFrames[0];
        void (async () => {
          let vars: { name: string; value?: string }[] = [];
          try {
            if (top && top.scopeChain?.length) {
              const localScope = [...top.scopeChain].reverse().find(s => s.type === 'local');
              if (localScope?.object?.objectId) {
                vars = await client.getProperties(localScope.object.objectId);
              }
            }
          } catch { /* vars best-effort */ }
          sendToRenderer('debug:paused', { reason: evt.reason, stack, variables: vars });
        })();
      } else if (method === 'Debugger.resumed') {
        sendToRenderer('debug:resumed');
      } else if (method === 'Runtime.executionContextDestroyed' || method === 'Debugger.scriptParsed') {
        // ignore
      }
    };
    await client.connect(url);
    await client.enable();
    inspector = client;
    return true;
  } catch {
    inspector = null;
    return false;
  }
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
      inspector?.disconnect();
      inspector = null;
      const { cmd, args, port } = getDebugCommand(scriptPath, cwd);
      debugPort = port || debugPort;
      debugProcess = spawn(cmd, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
      debugProcess.stdout?.on('data', (data: Buffer) => { sendToRenderer('debug:stdout', data.toString('utf-8')); });
      debugProcess.stderr?.on('data', (data: Buffer) => { sendToRenderer('debug:stderr', data.toString('utf-8')); });
      debugProcess.on('exit', (code) => {
        sendToRenderer('debug:exit', code);
        inspector?.disconnect();
        inspector = null;
        debugProcess = null;
      });
      debugProcess.on('error', (err) => {
        sendToRenderer('debug:stderr', String(err?.message || err));
      });

      const cdp = supportsCdp(scriptPath);
      let connected = false;
      if (cdp) {
        connected = await connectInspector(debugPort);
      }
      const portMsg = port ? ` on port ${port}` : '';
      const ext = path.extname(scriptPath).toUpperCase();
      return {
        ok: true,
        message: `Debugger started for ${ext} file${portMsg}`,
        cdp,
        connected,
      };
    } catch (e: any) {
      return { ok: false, message: e.message };
    }
  });

  ipcMain.handle('debug:stop', async () => {
    if (debugProcess) { debugProcess.kill(); debugProcess = null; }
    inspector?.disconnect();
    inspector = null;
    return { ok: true };
  });

  // ---- 断点调试控制（仅 CDP 支持时有效）----
  ipcMain.handle('debug:continue', async () => {
    try { await inspector?.resume(); return { ok: true }; } catch (e: any) { return { ok: false, message: e.message }; }
  });
  ipcMain.handle('debug:pause', async () => {
    try { await inspector?.pause(); return { ok: true }; } catch (e: any) { return { ok: false, message: e.message }; }
  });
  ipcMain.handle('debug:step', async (_e: any, kind: 'over' | 'into' | 'out') => {
    try {
      if (kind === 'into') await inspector?.stepInto();
      else if (kind === 'out') await inspector?.stepOut();
      else await inspector?.stepOver();
      return { ok: true };
    } catch (e: any) { return { ok: false, message: e.message }; }
  });
  ipcMain.handle('debug:set-breakpoint', async (_e: any, fileUrl: string, line: number) => {
    try {
      if (!inspector) return { ok: false, message: 'Inspector not connected' };
      if (line < 0) return { ok: true, removed: true }; // 移除断点（当前实现为幂等占位）
      const id = await inspector.setBreakpointByUrl(fileUrl, line);
      return { ok: true, breakpointId: id };
    } catch (e: any) { return { ok: false, message: e.message }; }
  });
  ipcMain.handle('debug:is-connected', () => ({ ok: true, connected: !!inspector?.connected }));
}

export function killDebugger() {
  if (debugProcess) { try { debugProcess.kill(); } catch {} debugProcess = null; }
  inspector?.disconnect();
  inspector = null;
}
