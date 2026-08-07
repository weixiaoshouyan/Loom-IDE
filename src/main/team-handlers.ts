/**
 * Team / Cloud Sync IPC handlers — team rules per workspace.
 */
import { ipcMain } from 'electron';
import fs from 'fs';
import path from 'path';
import { canAccess } from './path-permissions';

// Set by index.ts.
let _cloudSync: any = null;
export function setCloudSyncForHandlers(c: any) { _cloudSync = c; }

export function registerTeamHandlers() {
  ipcMain.handle('team:loadRules', (_e: any, workspacePath: string) => {
    const rules = _cloudSync.loadTeamRules(workspacePath);
    return _cloudSync.formatRulesPrompt(rules);
  });

  // Returns per-file instructions for a given relative path, e.g. the UI can
  // show a breadcrumb: "3 rules apply to src/app.ts".
  ipcMain.handle('team:getRulesForFile', (_e: any, workspacePath: string, relPath: string) => {
    const rules = _cloudSync.loadTeamRules(workspacePath);
    return _cloudSync.getRulesForFile(rules, relPath);
  });

  ipcMain.handle('team:saveRules', (_e: any, workspacePath: string, content: string) => {
    try {
      // SECURITY: never write .loom/rules into an arbitrary directory.
      if (!workspacePath || !canAccess(workspacePath)) {
        return { ok: false, error: 'Workspace path is not allowed.' };
      }
      const rulesDir = path.join(workspacePath, '.loom');
      if (!fs.existsSync(rulesDir)) fs.mkdirSync(rulesDir, { recursive: true });
      fs.writeFileSync(path.join(rulesDir, 'rules'), content, 'utf-8');
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('team:getUser', async () => _cloudSync.getUser());

  ipcMain.handle('team:signIn', async (_e: any, credentials?: Record<string, string>) => {
    return _cloudSync.signIn(credentials);
  });

  ipcMain.handle('team:signOut', async () => { _cloudSync.signOut(); });
}
