/**
 * Settings + Code Index IPC handlers.
 *
 * Settings: nested-key get/set with dot-path support (e.g. 'editor.fontSize').
 * Code Index: Tree-sitter symbol index build + search, with mtime-cached reload.
 */
import { ipcMain, app } from 'electron';
import path from 'path';
import { loadConfig, saveConfig, maskConfig, API_KEY_MASK } from './config';
import { ensurePathAllowed } from './path-permissions';
import { buildCodeIndex, loadCodeIndex, saveCodeIndex, searchCodeIndex, CodeIndex } from '../agent/code-index';

// Module-level cache (moved out of index.ts monolith).
let codeIndex: CodeIndex | null = null;

function getIndexDir(workspacePath: string): string {
  return path.join(app.getPath('userData'), 'loom-index', encodeURIComponent(workspacePath));
}

async function buildAndCacheCodeIndex(workspacePath: string): Promise<CodeIndex> {
  const index = await buildCodeIndex(workspacePath);
  saveCodeIndex(index, getIndexDir(workspacePath));
  codeIndex = index;
  return index;
}

export function registerSettingsHandlers() {
  // SECURITY: never send plaintext API keys to the renderer — mask like
  // ai:getConfig does (see maskConfig in config.ts).
  ipcMain.handle('settings:getAll', () => maskConfig(loadConfig()));

  ipcMain.handle('settings:set', (_e: any, key: string, value: any) => {
    // SECURITY: reject prototype-pollution keys — a crafted key like
    // "__proto__.x" or "constructor.prototype.x" would otherwise mutate the
    // main process's Object prototype.
    if (!key || !/^[A-Za-z0-9_.-]+$/.test(key)) return { ok: false };
    const keys = key.split('.');
    for (const p of keys) {
      if (p === '__proto__' || p === 'constructor' || p === 'prototype') return { ok: false };
    }
    const cfg = loadConfig();
    let target: any = cfg;
    for (let i = 0; i < keys.length - 1; i++) {
      if (!target[keys[i]]) target[keys[i]] = {};
      target = target[keys[i]];
    }
    target[keys[keys.length - 1]] = value;
    saveConfig(cfg);
    // Live-reload the command policy if the user just changed it.
    if (key === 'agent.allowedCommands' || key === 'agent.extraBlockedCommands' || key.startsWith('agent.commandPolicy')) {
      const { reloadCommandPolicy } = require('./command-policy');
      reloadCommandPolicy();
    }
    return { ok: true };
  });

  ipcMain.handle('settings:setAll', (_e: any, newCfg: any) => {
    // SECURITY: the renderer round-trips the masked config it got from
    // settings:getAll — never let the placeholder overwrite real keys.
    if (newCfg && Array.isArray(newCfg.aiConfig?.providers)) {
      const existing = loadConfig();
      newCfg.aiConfig.providers = newCfg.aiConfig.providers.map((incoming: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any -- IPC boundary
        if (incoming?.apiKey !== API_KEY_MASK) return incoming;
        const cur = existing.aiConfig?.providers?.find((p: any) => p.id === incoming.id); // eslint-disable-line @typescript-eslint/no-explicit-any -- IPC boundary
        return { ...incoming, apiKey: cur?.apiKey ?? '' };
      });
    }
    saveConfig(newCfg);
  });
}

export function registerCodeIndexHandlers() {
  ipcMain.handle('code-index:build', async (_e: any, workspacePath: string) => {
    if (!ensurePathAllowedSafe(workspacePath)) throw new Error(`Path not allowed: ${workspacePath}`);
    return await buildAndCacheCodeIndex(workspacePath);
  });

  ipcMain.handle('code-index:search', async (_e: any, workspacePath: string, query: string, topK?: number) => {
    if (!ensurePathAllowedSafe(workspacePath)) throw new Error(`Path not allowed: ${workspacePath}`);
    if (!codeIndex || codeIndex.workspacePath !== workspacePath) {
      const cached = loadCodeIndex(getIndexDir(workspacePath));
      if (cached && cached.workspacePath === workspacePath) {
        codeIndex = cached;
      } else {
        codeIndex = await buildAndCacheCodeIndex(workspacePath);
      }
    }
    return searchCodeIndex(codeIndex, query, topK || 10);
  });

  // Idle-time background prebuild (avoids blocking the first @-search).
  ipcMain.handle('codeindex:prebuild', async (_e: any, workspacePath: string) => {
    try {
      if (!workspacePath) return { ok: false, reason: 'no-workspace' };
      if (!ensurePathAllowedSafe(workspacePath)) return { ok: false, reason: 'not-allowed' };
      if (codeIndex && codeIndex.workspacePath === workspacePath) {
        return { ok: true, cached: true, symbols: codeIndex.symbols?.length || 0 };
      }
      const cached = loadCodeIndex(getIndexDir(workspacePath));
      if (cached && cached.workspacePath === workspacePath) {
        codeIndex = cached;
        return { ok: true, cached: true, symbols: cached.symbols?.length || 0 };
      }
      codeIndex = await buildCodeIndex(workspacePath);
      saveCodeIndex(codeIndex, getIndexDir(workspacePath));
      return { ok: true, cached: false, symbols: codeIndex.symbols?.length || 0 };
    } catch {
      return { ok: false };
    }
  });
}

function ensurePathAllowedSafe(targetPath: string): boolean {
  try { ensurePathAllowed(targetPath); return true; } catch { return false; }
}
