/**
 * Config / Settings persistence.
 *
 * Responsibilities:
 *   - Resolve userData / dataDir / configPath lazily (needs `app` to be ready).
 *   - Load/save the JSON config file with encrypted API keys (safeStorage).
 *   - Provide a sanitized "mask" copy for the renderer (no plaintext keys).
 *
 * Consumers: index.ts and any handler module that needs to read/write settings.
 */
import { safeStorage } from 'electron';
import path from 'path';
import fs from 'fs';
import { app } from 'electron';
import type { AIConfig, AIProvider } from '../agent/ai-engine';
import type { MCPServerConfig } from '../agent/mcp-client';

// ---- Config shape -----------------------------------------------------------

export interface EditorConfig {
  fontSize: number;
  fontFamily: string;
  tabSize: number;
  wordWrap: 'off' | 'on' | 'wordWrapColumn' | 'bounded';
  minimap: boolean;
  lineNumbers: boolean;
  cursorBlinking: string;
  smoothScrolling: boolean;
  formatOnSave: boolean;
  autoSave: 'off' | 'afterDelay' | 'onFocusChange';
}

export interface HistoryConfig {
  maxEntriesPerFile: number;
  maxAgeDays: number;
  maxTotalMB: number;
}

export interface WindowState {
  width: number;
  height: number;
  x?: number;
  y?: number;
  maximized: boolean;
}

export interface LoomConfig {
  aiConfig?: AIConfig | null;
  mcpServers?: MCPServerConfig[];
  theme?: 'dark' | 'light' | 'system';
  locale?: 'zh-CN' | 'en-US';
  editor?: EditorConfig;
  history?: HistoryConfig;
  recentFolders?: string[];
  windowState?: WindowState;
  agent?: {
    commandPolicy?: {
      allowedCommands?: string[] | null;
      extraBlockedCommands?: string[];
      allowInlineInterpreterCode?: boolean;
    };
  };
  [key: string]: unknown;
}

// Lazily initialized after `app` is ready.
let _userData = '';
let _dataDir = '';
let _configPath = '';

export function initPaths() {
  if (!_userData) {
    _userData = app.getPath('userData');
    _dataDir = path.join(_userData, 'data');
    _configPath = path.join(_dataDir, 'config.json');
  }
}

export function getUserData() { initPaths(); return _userData; }
export function getDataDir() { initPaths(); return _dataDir; }
export function getConfigPath() { initPaths(); return _configPath; }

export function ensureDataDir() {
  if (!fs.existsSync(getDataDir())) fs.mkdirSync(getDataDir(), { recursive: true });
}

// ---- Load ------------------------------------------------------------------

export function loadConfig(): LoomConfig {
  ensureDataDir();
  if (!fs.existsSync(getConfigPath())) {
    const defaultConfig: LoomConfig = {
      aiConfig: null as AIConfig | null,
      theme: 'dark' as const,
      locale: 'zh-CN' as const,
      editor: {
        fontSize: 14,
        fontFamily: "'Cascadia Code', 'Fira Code', Consolas, monospace",
        tabSize: 2,
        wordWrap: 'off' as const,
        minimap: true,
        lineNumbers: true,
        cursorBlinking: 'blink',
        smoothScrolling: true,
        formatOnSave: false,
        autoSave: 'off' as const,
      },
      history: {
        // Maximum snapshots retained per file. Oldest entries are pruned first.
        maxEntriesPerFile: 50,
        // Snapshots older than this (days) are pruned regardless of count.
        maxAgeDays: 30,
        // Total history storage budget in MB. When exceeded, oldest files are
        // removed entirely until under the cap.
        maxTotalMB: 100,
      },
      recentFolders: [] as string[],
      windowState: {
        width: 1400,
        height: 900,
        x: undefined as number | undefined,
        y: undefined as number | undefined,
        maximized: false,
      },
    };
    fs.writeFileSync(getConfigPath(), JSON.stringify(defaultConfig, null, 2));
    return defaultConfig;
  }
  try {
    const raw = JSON.parse(fs.readFileSync(getConfigPath(), 'utf-8'));
    return decryptApiKeys(raw);
  } catch {
    return {};
  }
}

// ---- Save (serialized via internalmutex) -----------------------------------

let configWritePromise: Promise<void> | null = null;

export async function saveConfig(config: LoomConfig): Promise<void> {
  // Queue writes so they never interleave.
  const prev = configWritePromise;
  let resolve: () => void;
  configWritePromise = new Promise((r) => { resolve = r; });
  try {
    if (prev) await prev;
  } catch {}
  // try/finally guarantees resolve() runs even if encryption or write fails,
  // otherwise the promise stays pending forever and every future saveConfig
  // deadlocks on `await prev`.
  try {
    ensureDataDir();
    const toSave = JSON.parse(JSON.stringify(config));
    if (toSave.aiConfig?.providers) {
      const canEncrypt = safeStorage.isEncryptionAvailable();
      for (const p of toSave.aiConfig.providers) {
        if (p.apiKey && canEncrypt) {
          p.apiKey = safeStorage.encryptString(p.apiKey).toString('base64');
          p._encrypted = true;
        } else if (p.apiKey) {
          // safeStorage unavailable: never persist a plaintext key.
          console.warn(`[config] safeStorage unavailable; not persisting apiKey for provider "${p.id || p.name || '?'}" to disk.`);
          p.apiKey = '';
          delete p._encrypted;
        }
      }
    }
    // Atomic write: tmp file + rename, so a crash mid-write can never leave a
    // truncated config.json (which would silently wipe all settings + keys).
    const configPath = getConfigPath();
    const tmpPath = `${configPath}.loom-tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(toSave, null, 2));
    try {
      fs.renameSync(tmpPath, configPath);
    } catch {
      // Windows: rename over an existing file can fail (EPERM) — fall back to
      // copy+remove, and clean up the tmp file either way.
      fs.copyFileSync(tmpPath, configPath);
      fs.unlinkSync(tmpPath);
    }
  } finally {
    resolve!();
  }
}

// ---- Crypto helpers ---------------------------------------------------------

/** Provider with the internal `_encrypted` flag used on disk. */
type StoredProvider = AIProvider & { _encrypted?: boolean };

export function decryptApiKeys(config: LoomConfig): LoomConfig {
  if (!config.aiConfig?.providers || !safeStorage.isEncryptionAvailable()) return config;
  for (const p of config.aiConfig.providers as StoredProvider[]) {
    if (p._encrypted && p.apiKey) {
      try {
        p.apiKey = safeStorage.decryptString(Buffer.from(p.apiKey, 'base64'));
        delete p._encrypted;
      } catch {
        // Decryption failed (e.g. the OS safeStorage key changed): the base64
        // ciphertext is NOT a usable key. Keeping it would get re-encrypted on
        // the next save ("double encryption"), permanently bricking the
        // provider — blank it out instead so the user can re-enter the key.
        p.apiKey = '';
        delete p._encrypted;
      }
    }
  }
  return config;
}

/** Mask value shown to the renderer in place of a real API key. */
export const API_KEY_MASK = '********';

/**
 * SECURITY: never send a plaintext API key to the renderer. The real key stays
 * in the main process. We replace it with a stable mask and expose only a
 * `hasKey` boolean for the UI.
 */
export function maskConfig(config: LoomConfig): LoomConfig {
  const copy = JSON.parse(JSON.stringify(config || {}));
  if (Array.isArray(copy?.aiConfig?.providers)) {
    for (const p of copy.aiConfig.providers) {
      if (p && typeof p.apiKey === 'string' && p.apiKey.length > 0) {
        p.hasKey = true;
        p.apiKey = API_KEY_MASK;
      } else {
        p.hasKey = false;
        p.apiKey = '';
      }
    }
  }
  return copy;
}
