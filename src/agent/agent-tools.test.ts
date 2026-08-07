import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { executeToolCall, isSensitivePath, destructiveAllowed, type ToolExecutionContext } from './agent-tools';

const createdDirs: string[] = [];

function makeWorkspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'loom-agent-tools-'));
  createdDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of createdDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('executeToolCall preview mode', () => {
  it('previews write_file changes without writing to disk', async () => {
    const workspace = makeWorkspace();
    const target = path.join(workspace, 'created.txt');
    const previews: { filePath: string; content: string; existed: boolean }[] = [];

    const result = await executeToolCall({
      id: 'call_1',
      type: 'function',
      function: {
        name: 'write_file',
        arguments: JSON.stringify({ filePath: 'created.txt', content: 'hello' }),
      },
    }, {
      workspacePath: workspace,
      previewFileWrites: true,
      onFilePreview: (filePath, content, existed) => previews.push({ filePath, content, existed }),
    });

    expect(result).toContain('Proposed write');
    expect(fs.existsSync(target)).toBe(false);
    expect(previews).toEqual([{ filePath: target, content: 'hello', existed: false }]);
  });

  it('previews edit_file changes without mutating existing files', async () => {
    const workspace = makeWorkspace();
    const target = path.join(workspace, 'existing.txt');
    fs.writeFileSync(target, 'old text', 'utf-8');
    const previews: { content: string; existed: boolean }[] = [];

    const result = await executeToolCall({
      id: 'call_2',
      type: 'function',
      function: {
        name: 'edit_file',
        arguments: JSON.stringify({ filePath: 'existing.txt', oldString: 'old', newString: 'new' }),
      },
    }, {
      workspacePath: workspace,
      previewFileWrites: true,
      onFilePreview: (_filePath, content, existed) => previews.push({ content, existed }),
    });

    expect(result).toContain('Proposed edit');
    expect(fs.readFileSync(target, 'utf-8')).toBe('old text');
    expect(previews).toEqual([{ content: 'new text', existed: true }]);
  });
});

describe('executeToolCall audit logging', () => {
  it('records the parsed tool target in audit events', async () => {
    const workspace = makeWorkspace();
    const target = path.join(workspace, 'source.txt');
    fs.writeFileSync(target, 'hello', 'utf-8');
    const auditEvents: { action: string; target?: string; details?: Record<string, any> }[] = [];

    await executeToolCall({
      id: 'call_audit',
      type: 'function',
      function: {
        name: 'read_file',
        arguments: JSON.stringify({ filePath: 'source.txt' }),
      },
    }, {
      workspacePath: workspace,
      onAudit: (_actor, action, target, details) => auditEvents.push({ action, target, details }),
    });

    expect(auditEvents).toEqual([{
      action: 'tool:read_file',
      target: 'source.txt',
      details: { args: JSON.stringify({ filePath: 'source.txt' }) },
    }]);
  });
});

describe('isSensitivePath guard', () => {
  it('flags secrets, key material and git internals', () => {
    expect(isSensitivePath('.env')).toBe(true);
    expect(isSensitivePath('.env.local')).toBe(true);
    expect(isSensitivePath('config/.env.production')).toBe(true);
    expect(isSensitivePath('id_rsa')).toBe(true);
    expect(isSensitivePath('certs/server.pem')).toBe(true);
    expect(isSensitivePath('keys/key.p12')).toBe(true);
    expect(isSensitivePath('a/b/.git/config')).toBe(true);
  });

  it('does not flag ordinary source files', () => {
    expect(isSensitivePath('src/main.ts')).toBe(false);
    expect(isSensitivePath('README.md')).toBe(false);
    expect(isSensitivePath('my.env.txt')).toBe(false);
  });
});

describe('destructiveAllowed gate', () => {
  const ctx = (autoApply: boolean): ToolExecutionContext => ({ workspacePath: '', autoApplyFileWrites: autoApply });

  it('blocks destructive ops without autoApply or explicit confirm', () => {
    expect(destructiveAllowed({ confirm: false }, ctx(false))).toBe(false);
    expect(destructiveAllowed({}, ctx(false))).toBe(false);
  });

  it('allows destructive ops with autoApply or explicit confirm', () => {
    expect(destructiveAllowed({ confirm: true }, ctx(false))).toBe(true);
    expect(destructiveAllowed({}, ctx(true))).toBe(true);
  });
});

describe('executeToolCall destructive protection', () => {
  it('refuses to delete a sensitive path', async () => {
    const workspace = makeWorkspace();
    const target = path.join(workspace, '.env');
    fs.writeFileSync(target, 'SECRET=1', 'utf-8');

    const result = await executeToolCall({
      id: 'call_del_secret',
      type: 'function',
      function: { name: 'delete_file', arguments: JSON.stringify({ filePath: '.env', confirm: true }) },
    }, { workspacePath: workspace });

    expect(result).toContain('Refusing to delete a sensitive path');
    expect(fs.existsSync(target)).toBe(true);
  });

  it('proposes (does not perform) a normal delete without confirm', async () => {
    const workspace = makeWorkspace();
    const target = path.join(workspace, 'temp.txt');
    fs.writeFileSync(target, 'data', 'utf-8');

    const result = await executeToolCall({
      id: 'call_del',
      type: 'function',
      function: { name: 'delete_file', arguments: JSON.stringify({ filePath: 'temp.txt' }) },
    }, { workspacePath: workspace });

    expect(result).toContain('Proposed delete');
    expect(fs.existsSync(target)).toBe(true);
  });

  it('performs a normal delete once confirm is given', async () => {
    const workspace = makeWorkspace();
    const target = path.join(workspace, 'temp.txt');
    fs.writeFileSync(target, 'data', 'utf-8');

    const result = await executeToolCall({
      id: 'call_del_confirm',
      type: 'function',
      function: { name: 'delete_file', arguments: JSON.stringify({ filePath: 'temp.txt', confirm: true }) },
    }, { workspacePath: workspace });

    expect(result).toContain('Successfully deleted file');
    expect(fs.existsSync(target)).toBe(false);
  });

  it('refuses to overwrite an existing sensitive file', async () => {
    const workspace = makeWorkspace();
    const target = path.join(workspace, '.env');
    fs.writeFileSync(target, 'SECRET=1', 'utf-8');

    const result = await executeToolCall({
      id: 'call_write_secret',
      type: 'function',
      function: { name: 'write_file', arguments: JSON.stringify({ filePath: '.env', content: 'SECRET=2' }) },
    }, { workspacePath: workspace, autoApplyFileWrites: true });

    expect(result).toContain('Refusing to write to a sensitive path');
    expect(fs.readFileSync(target, 'utf-8')).toBe('SECRET=1');
  });
});

describe('path traversal protection', () => {
  it('blocks write_file with an absolute path outside the workspace', async () => {
    const workspace = makeWorkspace();
    const outside = path.join(os.tmpdir(), 'loom-traversal-target.txt');

    const result = await executeToolCall({
      id: 'call_trav_write',
      type: 'function',
      function: { name: 'write_file', arguments: JSON.stringify({ filePath: outside, content: 'pwned' }) },
    }, { workspacePath: workspace, autoApplyFileWrites: true });

    expect(result).toContain('Cannot write to path outside workspace');
    expect(fs.existsSync(outside)).toBe(false);
  });

  it('blocks write_file with a relative path that escapes the workspace (../)', async () => {
    const workspace = makeWorkspace();
    const outside = path.join(os.tmpdir(), 'loom-traversal-rel.txt');

    const result = await executeToolCall({
      id: 'call_trav_write_rel',
      type: 'function',
      function: { name: 'write_file', arguments: JSON.stringify({ filePath: '../../loom-traversal-rel.txt', content: 'pwned' }) },
    }, { workspacePath: workspace, autoApplyFileWrites: true });

    expect(result).toContain('Cannot write to path outside workspace');
    expect(fs.existsSync(outside)).toBe(false);
  });

  it('blocks edit_file with a path outside the workspace', async () => {
    const workspace = makeWorkspace();
    const outside = path.join(os.tmpdir(), 'loom-traversal-edit.txt');
    fs.writeFileSync(outside, 'original', 'utf-8');

    const result = await executeToolCall({
      id: 'call_trav_edit',
      type: 'function',
      function: { name: 'edit_file', arguments: JSON.stringify({ filePath: outside, oldString: 'original', newString: 'modified' }) },
    }, { workspacePath: workspace, autoApplyFileWrites: true });

    expect(result).toContain('Cannot edit file outside workspace');
    expect(fs.readFileSync(outside, 'utf-8')).toBe('original');
  });

  it('blocks read_file with a path outside the workspace', async () => {
    const workspace = makeWorkspace();
    const outside = path.join(os.tmpdir(), 'loom-traversal-read.txt');
    fs.writeFileSync(outside, 'secret', 'utf-8');

    const result = await executeToolCall({
      id: 'call_trav_read',
      type: 'function',
      function: { name: 'read_file', arguments: JSON.stringify({ filePath: outside }) },
    }, { workspacePath: workspace });

    expect(result).toContain('Cannot read path outside workspace');
  });

  it('blocks symlink escape (symlink pointing outside workspace)', async () => {
    const workspace = makeWorkspace();
    const outside = path.join(os.tmpdir(), 'loom-symlink-target.txt');
    fs.writeFileSync(outside, 'secret-data', 'utf-8');
    const linkInWorkspace = path.join(workspace, 'escape-link');
    try { fs.symlinkSync(outside, linkInWorkspace); } catch { return; } // skip if symlinks unsupported

    const result = await executeToolCall({
      id: 'call_symlink',
      type: 'function',
      function: { name: 'read_file', arguments: JSON.stringify({ filePath: 'escape-link' }) },
    }, { workspacePath: workspace });

    expect(result).toContain('Cannot read path outside workspace');
  });

  it('blocks creating a file through a directory symlink that points outside', async () => {
    const workspace = makeWorkspace();
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'loom-symlink-dir-'));
    const linkDir = path.join(workspace, 'escape-dir');
    try { fs.symlinkSync(outsideDir, linkDir, 'junction'); } catch { return; } // skip if symlinks unsupported

    const result = await executeToolCall({
      id: 'call_symlink_dir',
      type: 'function',
      function: { name: 'write_file', arguments: JSON.stringify({ filePath: 'escape-dir/new.txt', content: 'x' }) },
    }, { workspacePath: workspace, autoApplyFileWrites: true });

    expect(result).toContain('Cannot write to path outside workspace');
    expect(fs.existsSync(path.join(outsideDir, 'new.txt'))).toBe(false);
  });
});

describe('command blacklist (run_command)', () => {
  it('refuses to execute a blocked destructive command (rm)', async () => {
    const workspace = makeWorkspace();
    const result = await executeToolCall({
      id: 'call_rm',
      type: 'function',
      function: { name: 'run_command', arguments: JSON.stringify({ command: 'rm', args: ['-rf', '/tmp/foo'] }) },
    }, { workspacePath: workspace });

    expect(result).toContain('not in the allowed development command list');
  });

  it('refuses to execute a blocked system command (shutdown)', async () => {
    const workspace = makeWorkspace();
    const result = await executeToolCall({
      id: 'call_shutdown',
      type: 'function',
      function: { name: 'run_command', arguments: JSON.stringify({ command: 'shutdown', args: ['/s'] }) },
    }, { workspacePath: workspace });

    expect(result).toContain('not in the allowed development command list');
  });

  it('refuses to execute a blocked shell interpreter (bash)', async () => {
    const workspace = makeWorkspace();
    const result = await executeToolCall({
      id: 'call_bash',
      type: 'function',
      function: { name: 'run_command', arguments: JSON.stringify({ command: 'bash', args: ['-c', 'echo hi'] }) },
    }, { workspacePath: workspace });

    expect(result).toContain('not in the allowed development command list');
  });

  it('refuses a command with shell metacharacters (pipe)', async () => {
    const workspace = makeWorkspace();
    // The command string itself contains a pipe — basename() won't match any
    // allowed command, so the allow-list rejects it.
    const result = await executeToolCall({
      id: 'call_pipe',
      type: 'function',
      function: { name: 'run_command', arguments: JSON.stringify({ command: 'cat /etc/passwd | grep root', args: [] }) },
    }, { workspacePath: workspace });

    expect(result).toContain('not in the allowed development command list');
  });
});
