import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it, vi } from 'vitest';

// Mock Electron so `loadConfig`/`getDataDir` resolve without an Electron runtime.
// The temp dir is created *inside* the factory because `vi.mock` is hoisted to
// the top of the file — module-level `const`s are not yet initialized when the
// factory runs.
// A minimal in-memory mock of Electron's ipcMain sufficient for handler
// registration and inspection in unit tests (no real IPC in the Node runner).
const _handlers = new Map<string, (...args: any[]) => any>();
vi.mock('electron', () => {
  const tmpUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'loom-test-history-'));
  return {
    ipcMain: {
      handle: (ch: string, fn: (...a: any[]) => any) => { _handlers.set(ch, fn); },
      eventNames: () => [..._handlers.keys()].map((k) => [k]),
    },
    app: {
      getPath: (name: string) => name === 'userData' ? tmpUserData : path.join(tmpUserData, name),
      getVersion: () => '0.0.0-test',
    },
    safeStorage: {
      isEncryptionAvailable: () => false,
      encryptString: (s: string) => Buffer.from(s),
      decryptString: (b: Buffer) => b.toString(),
    },
  };
});

vi.mock('./config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./config')>();
  const tmpHistoryParent = fs.mkdtempSync(path.join(os.tmpdir(), 'loom-history-test-'));
  fs.mkdirSync(path.join(tmpHistoryParent, 'history'), { recursive: true });
  return {
    ...actual,
    getDataDir: () => tmpHistoryParent,
  };
});

import { registerHistoryHandlers } from './history-handlers';
import { ipcMain } from 'electron';

describe('Local History rotation', () => {
  it('registers all expected IPC handlers', () => {
    registerHistoryHandlers();
    const names = (ipcMain.eventNames() as any[]).map((c) =>
      Array.isArray(c) ? c[0] : c
    );
    for (const ch of [
      'history:snapshot',
      'history:list',
      'history:get',
      'history:cleanup',
      'history:stats',
    ]) {
      expect(names).toContain(ch);
    }
  });

  it('registers the stats channel', () => {
    const names = (ipcMain.eventNames() as any[]).map((c) =>
      Array.isArray(c) ? c[0] : c
    );
    expect(names).toContain('history:stats');
  });
});
