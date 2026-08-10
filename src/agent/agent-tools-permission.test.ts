import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { executeToolCall } from './agent-tools';

const createdDirs: string[] = [];

function makeWorkspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'loom-agent-perm-'));
  createdDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of createdDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('executeToolCall permission store integration', () => {
  it('honors the main-process PathPermissionStore when it has grants', async () => {
    const { PathPermissionStore, setCurrentPermissionStore } = await import('../main/path-permissions');
    const workspace = makeWorkspace();
    const store = new PathPermissionStore();
    store.grantRoot(workspace);
    setCurrentPermissionStore(store);

    try {
      // Inside the granted root → allowed
      const inside = await executeToolCall({
        id: 'call_store_1',
        type: 'function',
        function: { name: 'write_file', arguments: JSON.stringify({ filePath: 'inside.txt', content: 'ok' }) },
      }, { workspacePath: workspace, autoApplySafeEdits: true });
      expect(inside).toContain('Successfully');

      // Outside the granted root → blocked, even though workspacePath matches
      const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'loom-agent-outside-'));
      createdDirs.push(outsideDir);
      const outside = await executeToolCall({
        id: 'call_store_2',
        type: 'function',
        function: { name: 'write_file', arguments: JSON.stringify({ filePath: path.join(outsideDir, 'x.txt'), content: 'nope' }) },
      }, { workspacePath: workspace, autoApplySafeEdits: true });
      expect(outside).toContain('Cannot write');
    } finally {
      // Reset to an empty store so other test files fall back to workspace checks.
      setCurrentPermissionStore(new PathPermissionStore());
    }
  });

  it('blocks delete_file unless the user approves it via onDestructiveApproval', async () => {
    const workspace = makeWorkspace();
    const target = path.join(workspace, 'victim.txt');
    fs.writeFileSync(target, 'data', 'utf-8');

    // User rejects → file survives
    const rejected = await executeToolCall({
      id: 'call_del_1',
      type: 'function',
      function: { name: 'delete_file', arguments: JSON.stringify({ filePath: 'victim.txt' }) },
    }, {
      workspacePath: workspace,
      onDestructiveApproval: async () => false,
    });
    expect(rejected).toContain('User rejected');
    expect(fs.existsSync(target)).toBe(true);

    // User approves → file is deleted
    const approved = await executeToolCall({
      id: 'call_del_2',
      type: 'function',
      function: { name: 'delete_file', arguments: JSON.stringify({ filePath: 'victim.txt' }) },
    }, {
      workspacePath: workspace,
      onDestructiveApproval: async () => true,
    });
    expect(approved).toContain('Successfully deleted');
    expect(fs.existsSync(target)).toBe(false);
  });
});
