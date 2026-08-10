/**
 * Shell + verification command handlers.
 *
 * `verification:run-command` enforces path permissions and uses the safe
 * command parser/runner (never a raw shell). The streaming variant
 * `verification:run-command-stream` drives `runDevelopmentCommandStreaming`
 * (async spawn + abort support) and forwards stdout/stderr/exit events to the
 * renderer, so long-running commands (dev servers, test watchers) never block
 * the main process event loop.
 */
import { ipcMain, shell, type WebContents } from 'electron';
import {
  parseDevelopmentCommand,
  runDevelopmentCommand,
  runDevelopmentCommandStreaming,
} from '../agent/development-command';

// Path-permissions store (set by index.ts).
let _pathPerms: { hasGrants: () => boolean; canAccess: (p: string) => boolean } | null = null;
export function setPathPerms(p: any) { _pathPerms = p; }

// Streaming runs: rid -> AbortController. Aborted by the renderer or on app quit.
const activeRuns = new Map<string, AbortController>();
let runTargetWindow: WebContents | null = null;
export function setShellMainWindow(w: WebContents | null) { runTargetWindow = w; }

/** Abort every in-flight streaming run (called on app quit). */
export function killAllRuns() {
  for (const controller of activeRuns.values()) controller.abort();
  activeRuns.clear();
}

function sendRunEvent(rid: string, type: string, payload: unknown) {
  if (runTargetWindow && !runTargetWindow.isDestroyed()) {
    runTargetWindow.send('verification:run-event', rid, type, payload);
  }
}

export function registerShellHandlers() {
  ipcMain.handle('shell:open-external', async (_e: any, url: string) => {
    // SECURITY: only allow safe protocols to prevent file:// or javascript: attacks.
    try {
      const parsed = new URL(url);
      if (!['http:', 'https:', 'mailto:'].includes(parsed.protocol)) {
        console.warn(`[shell] Blocked open-external with protocol: ${parsed.protocol}`);
        return;
      }
    } catch {
      console.warn(`[shell] Blocked invalid URL: ${url}`);
      return;
    }
    return shell.openExternal(url);
  });

  ipcMain.handle('verification:run-command', async (_e: any, workspacePath: string, commandLine: string) => {
    // SECURITY: only run commands inside workspaces the user has actually opened.
    if (!_pathPerms?.hasGrants() || !_pathPerms?.canAccess(workspacePath)) {
      return {
        command: commandLine,
        exitCode: null,
        stdout: '',
        stderr: 'Refusing to run: workspace is not an authorized/opened folder.',
      };
    }
    const parsed = parseDevelopmentCommand(String(commandLine || ''));
    if (parsed.error || !parsed.command) {
      return {
        command: commandLine,
        exitCode: null,
        stdout: '',
        stderr: parsed.error || 'Command is required.',
      };
    }
    return {
      command: commandLine,
      ...runDevelopmentCommand({
        command: parsed.command,
        args: parsed.args || [],
        cwd: workspacePath,
        workspacePath,
        timeoutMs: 120000,
      }),
    };
  });

  // Streaming run — the "Run (no debug)" path. Fire-and-forget send channel;
  // all output/exit events come back over `verification:run-event`.
  ipcMain.on('verification:run-command-stream', (_e: any, rid: string, workspacePath: string, commandLine: string) => {
    if (!rid || typeof rid !== 'string') return;
    // SECURITY: only run inside workspaces the user has actually opened.
    if (!_pathPerms?.hasGrants() || !_pathPerms?.canAccess(workspacePath)) {
      sendRunEvent(rid, 'exit', { exitCode: null, stdout: '', stderr: 'Refusing to run: workspace is not an authorized/opened folder.', error: 'workspace-not-allowed' });
      return;
    }
    const parsed = parseDevelopmentCommand(String(commandLine || ''));
    if (parsed.error || !parsed.command) {
      sendRunEvent(rid, 'exit', { exitCode: null, stdout: '', stderr: parsed.error || 'Command is required.', error: 'invalid-command' });
      return;
    }
    if (activeRuns.has(rid)) return; // duplicate rid — ignore

    const controller = new AbortController();
    activeRuns.set(rid, controller);
    runDevelopmentCommandStreaming({
      command: parsed.command,
      args: parsed.args || [],
      cwd: workspacePath,
      workspacePath,
      timeoutMs: 600000, // up to 10 min; the user can abort at any time
      abortSignal: controller.signal,
    }, (event) => {
      if (event.type === 'stdout' || event.type === 'stderr') {
        sendRunEvent(rid, 'output', { stream: event.type, data: event.data || '' });
      }
    }).then((result) => {
      sendRunEvent(rid, 'exit', {
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        error: result.error,
        attempts: result.attempts,
      });
    }).finally(() => {
      activeRuns.delete(rid);
    });
  });

  ipcMain.on('verification:run-command-abort', (_e: any, rid: string) => {
    activeRuns.get(rid)?.abort();
  });
}
