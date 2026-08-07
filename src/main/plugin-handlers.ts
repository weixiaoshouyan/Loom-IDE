/**
 * Plugin System IPC handlers — list, enable, install, uninstall, commands.
 *
 * SECURITY: renderer-supplied paths are never trusted for installation. The
 * plugin folder is always picked via a native dialog in the main process.
 */
import { ipcMain, dialog, BrowserWindow } from 'electron';

// Set by index.ts.
let resolvedMainWindow: BrowserWindow | null = null;
let _pluginManager: any = null;

export function setPluginSingletons(win: any, pm: any) {
  resolvedMainWindow = win;
  _pluginManager = pm;
}

function pm() { return _pluginManager!; }

export function registerPluginHandlers() {
  ipcMain.handle('plugins:getAll', () => {
    return pm().getAllPlugins().map((p: any) => ({
      id: p.id,
      manifest: p.manifest,
      enabled: p.enabled,
      builtin: p.builtin,
      path: p.path,
    }));
  });

  ipcMain.handle('plugins:setEnabled', (_e: any, id: string, enabled: boolean) => {
    return pm().setEnabled(id, enabled);
  });

  ipcMain.handle('plugins:install', async (_e: any, _pluginPath?: string) => {
    if (!resolvedMainWindow) return { ok: false, msg: 'No window' };
    const result = await dialog.showOpenDialog(resolvedMainWindow, {
      properties: ['openDirectory'],
      title: 'Select Plugin Folder',
    });
    if (result.canceled || !result.filePaths[0]) return { ok: false, msg: 'Cancelled' };
    return pm().installPlugin(result.filePaths[0]);
  });

  ipcMain.handle('plugins:uninstall', (_e: any, id: string) => pm().uninstallPlugin(id));

  ipcMain.handle('plugins:getCommands', () => pm().getAllCommands());

  ipcMain.handle('plugins:executeCommand', async (_e: any, id: string, ...args: any[]) => {
    return pm().executeCommand(id, ...args);
  });

  ipcMain.handle('plugins:getConfigurations', () => pm().getAllConfigurations());

  ipcMain.handle('plugins:getUserConfig', () => pm().getUserConfiguration());

  ipcMain.handle('plugins:setUserConfig', (_e: any, key: string, value: any) => {
    pm().setUserConfiguration(key, value);
    return true;
  });

  ipcMain.handle('plugins:getNotifications', () => pm().getNotifications());

  ipcMain.handle('plugins:clearNotifications', () => { pm().clearNotifications(); return true; });

  ipcMain.handle('plugins:installFromFile', async () => {
    if (!resolvedMainWindow) return { ok: false, msg: 'No window' };
    const result = await dialog.showOpenDialog(resolvedMainWindow, {
      properties: ['openDirectory'],
      title: 'Select Plugin Folder',
    });
    if (result.canceled || !result.filePaths[0]) return { ok: false, msg: 'Cancelled' };
    return pm().installPlugin(result.filePaths[0]);
  });

  // Webview panels.
  ipcMain.handle('plugins:getWebviewPanels', () => {
    return pm().getWebviewPanels().map((p: any) => ({ id: p.id, title: p.title, html: p.html, url: p.url }));
  });

  ipcMain.handle('plugins:postMessageToWebview', (_e: any, panelId: string, message: any) => {
    return pm().postMessageToWebview(panelId, message);
  });

  ipcMain.on('plugins:webviewEvent', (event: any, panelId: string, message: any) => {
    pm().postMessageToWebview(panelId, message);
  });
}
