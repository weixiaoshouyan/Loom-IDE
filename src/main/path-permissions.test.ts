import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { PathPermissionStore } from './path-permissions';

describe('PathPermissionStore', () => {
  it('allows files inside granted roots', () => {
    const store = new PathPermissionStore();
    const root = path.resolve('D:/workspace/project');
    store.grantRoot(root);

    expect(store.canAccess(path.join(root, 'src/index.ts'))).toBe(true);
  });

  it('denies sibling paths with the same prefix', () => {
    const store = new PathPermissionStore();
    const root = path.resolve('D:/workspace/project');
    store.grantRoot(root);

    expect(store.canAccess(path.resolve('D:/workspace/project-evil/file.ts'))).toBe(false);
  });

  it('allows explicitly granted files outside a root', () => {
    const store = new PathPermissionStore();
    const file = path.resolve('D:/notes/scratch.md');
    store.grantFile(file);

    expect(store.canAccess(file)).toBe(true);
    expect(store.canAccess(path.resolve('D:/notes/other.md'))).toBe(false);
  });

  it('denies a symlink inside a granted root that points outside (intersection check)', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'loom-perm-root-'));
    const outside = path.join(os.tmpdir(), `loom-perm-outside-${Date.now()}.txt`);
    fs.writeFileSync(outside, 'secret', 'utf-8');
    const link = path.join(root, 'escape-link');
    try { fs.symlinkSync(outside, link); } catch { return; } // skip if symlinks unsupported
    // Some sandboxed/containerized runtimes emulate symlinks without producing a
    // real one (lstat().isSymbolicLink() === false). In that case the "link" is
    // just a plain in-root file and there is no escape to detect — skip rather
    // than asserting on an artifact that doesn't exercise the security check.
    try { if (!fs.lstatSync(link).isSymbolicLink()) return; } catch { return; }

    const store = new PathPermissionStore();
    store.grantRoot(root);

    // 普通子路径（含尚未创建的文件）仍可访问
    expect(store.canAccess(path.join(root, 'ok.txt'))).toBe(true);
    // 指向外部的 symlink：词法在根内但 realpath 越界 → 拒绝
    expect(store.canAccess(link)).toBe(false);
  });

  it('still resolves paths under a granted root that is itself a symlink', () => {
    const target = fs.mkdtempSync(path.join(os.tmpdir(), 'loom-perm-target-'));
    const linkRoot = path.join(os.tmpdir(), `loom-perm-linkroot-${Date.now()}`);
    try { fs.symlinkSync(target, linkRoot, 'junction'); } catch { return; } // skip if symlinks unsupported

    const store = new PathPermissionStore();
    store.grantRoot(linkRoot);

    fs.writeFileSync(path.join(target, 'inside.txt'), 'ok', 'utf-8');
    expect(store.canAccess(path.join(linkRoot, 'inside.txt'))).toBe(true);
  });
});
