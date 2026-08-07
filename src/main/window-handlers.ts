/**
 * Window control IPC — minimize / maximize / close.
 *
 * The main window reference is set by index.ts right after creation.
 */
import { ipcMain } from 'electron';

let resolvedMainWindow: {
  minimize: () => void;
  maximize: () => void;
  unmaximize: () => void;
  isMaximized: () => boolean;
  close: () => void;
} | null = null;

export function setMainWindowForControls(w: any) { resolvedMainWindow = w; }

export function registerWindowHandlers() {
  ipcMain.on('window:minimize', () => resolvedMainWindow?.minimize());
  ipcMain.on('window:maximize', () => {
    if (resolvedMainWindow?.isMaximized()) resolvedMainWindow.unmaximize();
    else resolvedMainWindow?.maximize();
  });
  ipcMain.on('window:close', () => resolvedMainWindow?.close());
}
