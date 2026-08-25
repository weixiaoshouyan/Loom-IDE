/**
 * Session IPC handlers — 磁盘会话读写（renderer/app-storage 的异步后端）。
 */
import { ipcMain } from 'electron';
import { saveSessionData, loadSessionData } from './session-store';

export function registerSessionHandlers() {
  ipcMain.handle('session:save', (_e: any, data: unknown) => {
    return { ok: saveSessionData(data) };
  });

  ipcMain.handle('session:load', () => {
    return { ok: true, data: loadSessionData() };
  });
}
