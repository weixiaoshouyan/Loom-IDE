import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock Electron's `app.getPath` so `loadConfig` can resolve a userData dir
// in the Node test runner (no Electron runtime available).
vi.mock('electron', () => {
  const tmpUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'loom-test-config-'));
  return {
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
import {
  normalizeCommandName,
  isCommandAllowed,
  getAllowedCommands,
  getBlockedCommands,
  reloadCommandPolicy,
  validateInterpreterArgs,
  isInlineInterpreterCodeAllowed,
  DEFAULT_ALLOWED_COMMANDS,
  DEFAULT_BLOCKED_COMMANDS,
} from './command-policy';
import { loadConfig, saveConfig } from './config';

describe('normalizeCommandName', () => {
  it('lowercases and strips Windows suffixes', () => {
    expect(normalizeCommandName('GIT.EXE')).toBe('git');
    expect(normalizeCommandName('npm.cmd')).toBe('npm');
    expect(normalizeCommandName('  python3  ')).toBe('python3');
    expect(normalizeCommandName('tsc')).toBe('tsc');
  });
});

describe('default policy', () => {
  beforeEach(() => reloadCommandPolicy());

  it('allows a known development command', () => {
    expect(isCommandAllowed('npm')).toBe(true);
    expect(isCommandAllowed('git')).toBe(true);
    expect(isCommandAllowed('tsc')).toBe(true);
    expect(isCommandAllowed('node')).toBe(true);
  });

  it('blocks a dangerous command even with suffix', () => {
    expect(isCommandAllowed('rm')).toBe(false);
    expect(isCommandAllowed('rmdir')).toBe(false);
    expect(isCommandAllowed('shutdown')).toBe(false);
    expect(isCommandAllowed('bash')).toBe(false);
    expect(isCommandAllowed('sudo.exe')).toBe(false);
  });

  it('blocks unknown commands not in the allow-list', () => {
    expect(isCommandAllowed('unknown-evil-tool')).toBe(false);
    expect(isCommandAllowed('malware.sh')).toBe(false);
  });

  it('rejects empty input', () => {
    expect(isCommandAllowed('')).toBe(false);
    expect(isCommandAllowed('   ')).toBe(false);
  });
});

describe('getAllowedCommands / getBlockedCommands', () => {
  beforeEach(() => reloadCommandPolicy());

  it('returns the default sets', () => {
    const allowed = getAllowedCommands();
    const blocked = getBlockedCommands();
    expect(allowed.has('npm')).toBe(true);
    expect(blocked.has('rm')).toBe(true);
  });

  it('always contains default blocked even after user clears the allow-list', () => {
    const blocked = getBlockedCommands();
    // blocked should be a superset of defaults
    for (const cmd of DEFAULT_BLOCKED_COMMANDS) {
      expect(blocked.has(cmd)).toBe(true);
    }
  });
});

describe('configured policy via loadConfig', () => {
  it('reflects a user-added command on disk', async () => {
    // Simulate a config file written by settings:set('agent.allowedCommands', [...])
    const cfg = loadConfig();
    cfg.agent = {
      commandPolicy: {
        allowedCommands: ['mytool', 'debugserve'],
        extraBlockedCommands: ['internal-secret-tool'],
      },
    };
    await saveConfig(cfg);
    reloadCommandPolicy();

    expect(isCommandAllowed('mytool')).toBe(true);
    expect(isCommandAllowed('debugserve')).toBe(true);
    // unknown still blocked
    expect(isCommandAllowed('unknown')).toBe(false);
    // explicitly blocked even though it could be "mytool-like"
    expect(isCommandAllowed('internal-secret-tool')).toBe(false);

    // Reset to clean defaults for other tests
    const cfg2 = loadConfig();
    cfg2.agent = { commandPolicy: { allowedCommands: null, extraBlockedCommands: [] } };
    await saveConfig(cfg2);
    reloadCommandPolicy();
  });
});

describe('validateInterpreterArgs (inline-code escape hatch)', () => {
  beforeEach(async () => {
    // Ensure the escape hatch is OFF (default-strict) for these tests.
    const cfg = loadConfig();
    cfg.agent = { commandPolicy: { allowInlineInterpreterCode: false } };
    await saveConfig(cfg);
    reloadCommandPolicy();
  });

  afterEach(async () => {
    const cfg = loadConfig();
    cfg.agent = { commandPolicy: {} };
    await saveConfig(cfg);
    reloadCommandPolicy();
  });

  it('blocks node inline-code flags', () => {
    expect(validateInterpreterArgs('node', ['-e', 'process.exit(1)'])).toBeTruthy();
    expect(validateInterpreterArgs('node.exe', ['--eval', 'x'])).toBeTruthy();
    expect(validateInterpreterArgs('node', ['-p', '1+1'])).toBeTruthy();
    expect(validateInterpreterArgs('node', ['--print', '1'])).toBeTruthy();
  });

  it('blocks python -c', () => {
    expect(validateInterpreterArgs('python', ['-c', 'import os'])).toBeTruthy();
    expect(validateInterpreterArgs('python3', ['-c', 'x'])).toBeTruthy();
  });

  it('blocks powershell -Command and its abbreviations / -EncodedCommand', () => {
    expect(validateInterpreterArgs('powershell', ['-Command', 'Get-Process'])).toBeTruthy();
    expect(validateInterpreterArgs('powershell', ['-c', 'ls'])).toBeTruthy();
    expect(validateInterpreterArgs('powershell', ['-com', 'ls'])).toBeTruthy();
    expect(validateInterpreterArgs('powershell', ['-EncodedCommand', 'ZQBjAGgAbwA='])).toBeTruthy();
    expect(validateInterpreterArgs('powershell', ['-enc', 'ZQBjAGgAbwA='])).toBeTruthy();
    expect(validateInterpreterArgs('pwsh', ['-Command', 'x'])).toBeTruthy();
  });

  it('allows benign interpreter invocations (script file / repl / version)', () => {
    expect(validateInterpreterArgs('node', ['script.js'])).toBeUndefined();
    expect(validateInterpreterArgs('node', ['--version'])).toBeUndefined();
    expect(validateInterpreterArgs('python', ['main.py'])).toBeUndefined();
    expect(validateInterpreterArgs('powershell', ['-File', 'build.ps1'])).toBeUndefined();
    expect(validateInterpreterArgs('powershell', ['-NoProfile', '-File', 'build.ps1'])).toBeUndefined();
  });

  it('ignores non-interpreter commands', () => {
    expect(validateInterpreterArgs('git', ['-e', 'whatever'])).toBeUndefined();
    expect(validateInterpreterArgs('npm', ['-c', 'x'])).toBeUndefined();
  });

  it('honors the opt-in escape hatch', async () => {
    const cfg = loadConfig();
    cfg.agent = { commandPolicy: { allowInlineInterpreterCode: true } };
    await saveConfig(cfg);
    reloadCommandPolicy();

    expect(isInlineInterpreterCodeAllowed()).toBe(true);
    expect(validateInterpreterArgs('node', ['-e', 'x'])).toBeUndefined();
    expect(validateInterpreterArgs('powershell', ['-Command', 'x'])).toBeUndefined();
  });
});
