/**
 * Telemetry / Audit IPC handlers.
 */
import { ipcMain } from 'electron';
import { telemetry } from './telemetry';

export function registerTelemetryHandlers() {
  ipcMain.handle('telemetry:setConfig', (_e: any, config: any) => {
    telemetry.setConfig(config);
    return { ok: true };
  });

  ipcMain.handle('telemetry:getAuditLog', () => telemetry.getAuditLog());

  ipcMain.handle('telemetry:clearAuditLog', () => {
    telemetry.clearAuditLog();
    return { ok: true };
  });
}
