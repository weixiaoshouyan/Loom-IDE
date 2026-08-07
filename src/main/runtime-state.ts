/**
 * Runtime state snapshot collector — used by the in-app Debug panel.
 *
 * This module gathers non-sensitive, diagnostic-only state from the live
 * services (terminal sessions, active AI streams, path-permission store, local
 * history stats, plugin list) and returns a single serializable object. It is
 * intentionally read-only — callers cannot mutate live services through it.
 *
 * SECURITY: the returned object strips API keys (uses `maskConfig`) and never
 * returns secrets. It is meant for developer/operator diagnostics only.
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import { getDataDir } from './config';
import { maskConfig } from './config';

/** Snapshot shapes — plain data, no methods, fully serializable. */

export interface TerminalSnapshot {
  id: string;
  shell: string;
  isPty: boolean;
  pid: number | null;
}

export interface StreamSnapshot {
  id: string;
  startedAt: number;
  provider?: string;
  model?: string;
}

export interface PermissionSnapshot {
  grantedRoots: string[];
  deniedAttempts: number;
}

export interface HistorySnapshot {
  files: number;
  totalBytes: number;
}

export interface PluginSnapshot {
  id: string;
  name: string;
  version: string;
  enabled: boolean;
}

export interface RuntimeSnapshot {
  collectedAt: number;
  os: {
    platform: string;
    release: string;
    arch: string;
    hostname: string;
    cpus: number;
    totalMemoryMB: number;
    freeMemoryMB: number;
    uptimeHours: number;
  };
  node: {
    version: string;
    pid: number;
    memoryUsageMB: {
      rss: number;
      heapTotal: number;
      heapUsed: number;
      external: number;
    };
  };
  app: {
    version: string;
    dataDir: string;
    historyDirSizeBytes: number;
  };
  terminals: TerminalSnapshot[];
  streams: StreamSnapshot[];
  permissions: PermissionSnapshot;
  history: HistorySnapshot;
  plugins: PluginSnapshot[];
  config: any; // masked — no API keys
}

// The services that can be queried. Set via setXxx() from index.ts after the
// app boots. Optional — the collector degrades gracefully if a service isn't set.
let _terminalGetter: (() => TerminalSnapshot[]) | null = null;
let _streamGetter: (() => StreamSnapshot[]) | null = null;
let _permissionGetter: (() => PermissionSnapshot) | null = null;
let _pluginGetter: (() => PluginSnapshot[]) | null = null;

export function setTerminalRuntimeGetter(fn: () => TerminalSnapshot[]) {
  _terminalGetter = fn;
}
export function setStreamRuntimeGetter(fn: () => StreamSnapshot[]) {
  _streamGetter = fn;
}
export function setPermissionRuntimeGetter(fn: () => PermissionSnapshot) {
  _permissionGetter = fn;
}
export function setPluginRuntimeGetter(fn: () => PluginSnapshot[]) {
  _pluginGetter = fn;
}

function getHistoryDirSize(): number {
  try {
    const dir = path.join(getDataDir(), 'history');
    if (!fs.existsSync(dir)) return 0;
    let total = 0;
    for (const f of fs.readdirSync(dir)) {
      try { total += fs.statSync(path.join(dir, f)).size; } catch {}
    }
    return total;
  } catch { return 0; }
}

function getHistoryStats(): HistorySnapshot {
  try {
    const dir = path.join(getDataDir(), 'history');
    const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')).length : 0;
    return { files, totalBytes: getHistoryDirSize() };
  } catch { return { files: 0, totalBytes: 0 }; }
}

function getAppVersion(): string {
  try {
    // electron app is available when running in Electron; undefined in unit tests.
     
    return require('electron').app?.getVersion?.() || '0.0.0-dev';
  } catch { return '0.0.0-dev'; }
}

/**
 * Collect the full runtime snapshot. Safe to call from the renderer via IPC.
 */
export function collectRuntimeState(): RuntimeSnapshot {
  const mem = process.memoryUsage();
  const memMB = (b: number) => Math.round((b / 1024 / 1024) * 100) / 100;

  return {
    collectedAt: Date.now(),
    os: {
      platform: process.platform,
      release: os.release(),
      arch: os.arch(),
      hostname: os.hostname(),
      cpus: os.cpus()?.length || 0,
      totalMemoryMB: Math.round(os.totalmem() / 1024 / 1024),
      freeMemoryMB: Math.round(os.freemem() / 1024 / 1024),
      uptimeHours: Math.round((os.uptime() / 3600) * 100) / 100,
    },
    node: {
      version: process.version,
      pid: process.pid,
      memoryUsageMB: {
        rss: memMB(mem.rss),
        heapTotal: memMB(mem.heapTotal),
        heapUsed: memMB(mem.heapUsed),
        external: memMB(mem.external || 0),
      },
    },
    app: {
      version: getAppVersion(),
      dataDir: getDataDir(),
      historyDirSizeBytes: getHistoryDirSize(),
    },
    terminals: _terminalGetter ? _terminalGetter() : [],
    streams: _streamGetter ? _streamGetter() : [],
    permissions: _permissionGetter ? _permissionGetter() : { grantedRoots: [], deniedAttempts: 0 },
    history: getHistoryStats(),
    plugins: _pluginGetter ? _pluginGetter() : [],
    config: (() => {
      try {
         
        const cfg = require('./config').loadConfig();
        return maskConfig(cfg);
      } catch { return {}; }
    })(),
  };
}
