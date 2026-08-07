import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  isAllowedDevelopmentCommand,
  parseDevelopmentCommand,
  runDevelopmentCommand,
  DevelopmentCommandQueue,
  runDevelopmentCommandStreaming,
} from './development-command';

// The command policy blocks interpreter inline-code flags (e.g. `node -e`) by
// default. These runner tests exercise the spawn/stream/retry/queue machinery,
// not the policy, so they drive a real script *file* — the legitimate,
// non-inline path — instead of `node -e "..."`.
let tmpDir = '';
let printer = '';

/** node printer.cjs "<message>" [exitCode] -> prints message, exits with code. */
beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'loom-devcmd-'));
  printer = path.join(tmpDir, 'printer.cjs');
  fs.writeFileSync(
    printer,
    'const msg = process.argv[2] || "";\n'
    + 'if (msg) console.log(msg);\n'
    + 'process.exit(Number(process.argv[3] || 0));\n',
  );
});

afterAll(() => {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best effort */ }
});

describe('development-command', () => {
  it('parses quoted development commands into command and args', () => {
    expect(parseDevelopmentCommand('npm run "test:run"')).toEqual({
      command: 'npm',
      args: ['run', 'test:run'],
    });
  });

  it('rejects shell interpreters and metacharacters', () => {
    expect(isAllowedDevelopmentCommand('cmd')).toBe(false);
    expect(parseDevelopmentCommand('npm run lint && del package.json')).toEqual({
      error: 'Command contains unsupported shell syntax.',
    });
  });

  it('allows constrained PowerShell execution for agent-style workspace automation', () => {
    expect(isAllowedDevelopmentCommand('powershell')).toBe(true);
    expect(parseDevelopmentCommand('powershell -NoProfile -File "build.ps1"')).toEqual({
      command: 'powershell',
      args: ['-NoProfile', '-File', 'build.ps1'],
    });
  });

  it('blocks destructive PowerShell commands before execution', () => {
    const result = runDevelopmentCommand({
      command: 'powershell',
      args: ['-NoProfile', '-File', 'cleanup.ps1', 'Remove-Item'],
      cwd: process.cwd(),
      workspacePath: process.cwd(),
      timeoutMs: 5000,
    });

    expect(result.exitCode).toBeNull();
    expect(result.stderr).toContain('blocked by the PowerShell safety policy');
  });

  it('blocks interpreter inline-code execution by default', () => {
    const result = runDevelopmentCommand({
      command: 'node',
      args: ['-e', 'console.log("should-not-run")'],
      cwd: process.cwd(),
      workspacePath: process.cwd(),
      timeoutMs: 5000,
    });

    expect(result.exitCode).toBeNull();
    expect(result.stderr).toContain('Inline code execution');
  });

  it('runs allowed commands with structured output', () => {
    const result = runDevelopmentCommand({
      command: 'node',
      args: [printer, 'verification-ok'],
      cwd: process.cwd(),
      workspacePath: process.cwd(),
      timeoutMs: 5000,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('verification-ok');
    expect(result.stderr).toBe('');
  });

  it('streams command lifecycle events and records output', async () => {
    const events: string[] = [];
    const result = await runDevelopmentCommandStreaming({
      command: 'node',
      args: [printer, 'stream-ok'],
      cwd: process.cwd(),
      workspacePath: process.cwd(),
      timeoutMs: 5000,
    }, event => {
      events.push(event.type);
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('stream-ok');
    expect(events).toContain('started');
    expect(events).toContain('stdout');
    expect(events).toContain('exit');
    expect(result.history.length).toBeGreaterThanOrEqual(3);
  });

  it('retries failed streaming commands when retryCount is provided', async () => {
    const events: string[] = [];
    const result = await runDevelopmentCommandStreaming({
      command: 'node',
      args: [printer, '', '7'],
      cwd: process.cwd(),
      workspacePath: process.cwd(),
      timeoutMs: 5000,
      retryCount: 1,
    }, event => {
      events.push(event.type);
    });

    expect(result.exitCode).toBe(7);
    expect(events.filter(type => type === 'started')).toHaveLength(2);
    expect(events).toContain('retry');
  });

  it('keeps queued command history snapshots', async () => {
    const queue = new DevelopmentCommandQueue();
    const result = await queue.enqueue({
      command: 'node',
      args: [printer, 'queued-ok'],
      cwd: process.cwd(),
      workspacePath: process.cwd(),
      timeoutMs: 5000,
    });
    const history = queue.list();

    expect(result.exitCode).toBe(0);
    expect(history[0].status).toBe('succeeded');
    expect(history[0].history.some(event => event.type === 'stdout')).toBe(true);
  });

  it('retries a finished queued command with the same request', async () => {
    const queue = new DevelopmentCommandQueue();
    const result = await queue.enqueue({
      command: 'node',
      args: [printer, 'retry-ok'],
      cwd: process.cwd(),
      workspacePath: process.cwd(),
      timeoutMs: 5000,
    });

    const retried = queue.retry(result.taskId!);
    expect(retried).toBeTruthy();
    const retryResult = await retried!;
    const history = queue.list();

    expect(retryResult.exitCode).toBe(0);
    expect(retryResult.stdout).toContain('retry-ok');
    expect(history).toHaveLength(2);
    expect(history[0].request.args).toEqual([printer, 'retry-ok']);
  });
});
