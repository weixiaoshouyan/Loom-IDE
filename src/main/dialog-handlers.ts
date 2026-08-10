/**
 * File dialog IPC handlers — open file, open folder, save file, recent folders.
 *
 * SECURITY: plugin/vnderer-supplied arbitrary paths are never trusted for
 * installation or direct access. Folder picks always flow through a native
 * dialog in the main process.
 */
import { ipcMain, dialog, BrowserWindow } from 'electron';
import fs from 'fs';
import path from 'path';
import { loadConfig, saveConfig } from './config';
import { grantRoot, grantFile, canAccess, grantPath } from './path-permissions';
import { toSaveFileResult } from './dialog-contract';

// Set by index.ts after the window is created.
let resolvedMainWindow: BrowserWindow | null = null;
export function setMainWindowForDialog(w: BrowserWindow | null) { resolvedMainWindow = w; }

export function registerDialogHandlers() {
  ipcMain.handle('dialog:open-file', async () => {
    if (!resolvedMainWindow) return null;
    const result = await dialog.showOpenDialog(resolvedMainWindow, {
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'All Files', extensions: ['*'] }],
    });
    if (result.canceled) return null;
    const files: { path: string; content: string }[] = [];
    for (const fp of result.filePaths) {
      try {
        const content = fs.readFileSync(fp, 'utf-8');
        grantFile(fp);
        files.push({ path: fp, content });
      } catch {}
    }
    return files;
  });

  ipcMain.handle('dialog:open-folder', async () => {
    try {
      if (!resolvedMainWindow || resolvedMainWindow.isDestroyed()) {
        return { ok: false, message: 'Main window is not available. Please restart the app.' };
      }
      const result = await dialog.showOpenDialog(resolvedMainWindow, {
        properties: ['openDirectory'],
        title: 'Open Folder',
        message: 'Select a folder to open as workspace',
      });
      if (result.canceled || !result.filePaths[0]) {
        return { ok: false, canceled: true, message: 'No folder selected.' };
      }
      const folder = result.filePaths[0];
      grantRoot(folder);
      await importCursorMCPConfig(folder);
      const cfg = loadConfig();
      const recent: string[] = cfg.recentFolders || [];
      const filtered = recent.filter(r => r !== folder);
      cfg.recentFolders = [folder, ...filtered].slice(0, 10);
      saveConfig(cfg);
      return { ok: true, folder };
    } catch (e: any) {
      return { ok: false, message: e?.message || 'Failed to open folder.' };
    }
  });

  ipcMain.handle('dialog:open-folder-by-path', async (_e: any, folder: string) => {
    try {
      if (!folder || !fs.existsSync(folder)) return { ok: false, message: 'Folder does not exist' };
      const stat = fs.statSync(folder);
      if (!stat.isDirectory()) return { ok: false, message: 'Path is not a directory' };
      const realFolder = fs.realpathSync(folder);
      if (!canAccess(realFolder)) {
        // TEST-ONLY ESCAPE HATCH: the Playwright e2e suite boots the app with
        // E2E=1 and drives openFolderByPath via window.loom; a native dialog
        // cannot be automated. Never set in production runs.
        if (process.env.E2E === '1') {
          grantRoot(realFolder);
          return { ok: true, folder: realFolder };
        }
        if (!resolvedMainWindow || resolvedMainWindow.isDestroyed()) {
          return { ok: false, message: 'No window to confirm path authorization.' };
        }
        const confirm = await dialog.showMessageBox(resolvedMainWindow, {
          type: 'warning',
          buttons: ['Cancel', 'Open Folder'],
          defaultId: 0,
          cancelId: 0,
          title: 'Open Folder',
          message: 'Open this folder and grant it full file access?',
          detail: realFolder,
        });
        if (confirm.response !== 1) return { ok: false, message: 'User canceled path authorization.' };
      }
      grantRoot(realFolder);
      return { ok: true, folder: realFolder };
    } catch (e: any) {
      return { ok: false, message: e.message };
    }
  });

  ipcMain.handle('dialog:save-file', async (_e: any, filePath: string) => {
    if (!resolvedMainWindow) return null;
    const result = await dialog.showSaveDialog(resolvedMainWindow, { defaultPath: filePath });
    const normalized = toSaveFileResult(result);
    if (normalized.filePath) grantFile(normalized.filePath);
    return normalized;
  });

  // Recent folders.
  ipcMain.handle('recent:getFolders', () => {
    const cfg = loadConfig();
    return cfg.recentFolders || [];
  });

  ipcMain.handle('recent:clearFolders', () => {
    const cfg = loadConfig();
    cfg.recentFolders = [];
    saveConfig(cfg);
  });
}

async function importCursorMCPConfig(workspacePath: string) {
  try {
    const { normalizeMCPServerConfigs, MCPClient } = require('../agent/mcp-client');
    const mcpPath = path.join(workspacePath, '.cursor', 'mcp.json');
    if (!fs.existsSync(mcpPath)) return;
    // mcpClient is set by index.ts; we require it lazily to avoid a cycle.
    const mcpClient = (global as any).__loom_mcpClient as InstanceType<typeof MCPClient> | undefined;
    if (!mcpClient) return;
    const parsed = JSON.parse(fs.readFileSync(mcpPath, 'utf-8'));
    const servers = normalizeMCPServerConfigs(parsed) || [];
    const existing = new Set(mcpClient.getAllServers().map((s: any) => s.id));
    const fresh = servers.filter((s: any) => !existing.has(s.id)); // eslint-disable-line @typescript-eslint/no-explicit-any -- IPC boundary
    if (fresh.length === 0) return;

    // SECURITY: never silently import and spawn servers from a project file.
    // `.cursor/mcp.json` entries commonly run `npx -y <pkg>`, which downloads
    // and executes arbitrary code from npm — a malicious repo could otherwise
    // get a shell-equivalent running on folder open.
    const names = fresh.map((s: any) => s.id).join(', '); // eslint-disable-line @typescript-eslint/no-explicit-any -- IPC boundary
    const win = resolvedMainWindow && !resolvedMainWindow.isDestroyed() ? resolvedMainWindow : undefined;
    const { response } = await dialog.showMessageBox(win!, {
      type: 'question',
      buttons: ['导入并添加', '不导入'],
      defaultId: 1,
      cancelId: 1,
      title: '导入 Cursor MCP 配置',
      message: `检测到 ${fresh.length} 个 MCP 服务器（${names}）`,
      detail: '这些服务器来自该文件夹的 .cursor/mcp.json。导入后不会自动启动，你可以在 MCP 设置中手动连接。'
        + ' 注意：npx 命令会从 npm 下载并执行代码，请确认配置来源可信。',
    });
    if (response !== 0) return;

    for (const server of fresh) {
      // Imported servers must not auto-spawn — the user connects explicitly.
      mcpClient.addServer({ ...server, autoConnect: false });
      existing.add(server.id);
    }
  } catch (e) {
    console.warn('Failed to import Cursor MCP config:', e);
  }
}
