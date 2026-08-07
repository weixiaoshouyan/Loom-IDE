/**
 * Debug-panel IPC — exposes internal runtime state for the in-app Debug panel.
 *
 * The panel is a read-only diagnostic surface: it surfaces active terminals, AI
 * streams, path-permission roots, local history stats, plugin list, and a masked
 * config snapshot. It never exposes API keys or plaintext secrets.
 */
import { ipcMain } from 'electron';
import { collectRuntimeState } from './runtime-state';

export function registerDebugRuntimeHandlers() {
  ipcMain.handle('debug:runtime:get', () => {
    try { return { ok: true, data: collectRuntimeState() }; }
    catch (e: any) { return { ok: false, error: e?.message || String(e) }; }
  });
}
