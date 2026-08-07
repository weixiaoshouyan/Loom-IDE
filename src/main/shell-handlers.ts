/**
 * Shell + verification command handlers.
 *
 * `verification:run-command` enforces path permissions and uses the safe
 * command parser/runner (never a raw shell).
 */
import { ipcMain, shell } from 'electron';
import { parseDevelopmentCommand, runDevelopmentCommand } from '../agent/development-command';

// Path-permissions store (set by index.ts).
let _pathPerms: { hasGrants: () => boolean; canAccess: (p: string) => boolean } | null = null;
export function setPathPerms(p: any) { _pathPerms = p; }

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
}
