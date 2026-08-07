import path from 'path';
import fs from 'fs';

function normalize(inputPath: string): string {
  return path.resolve(inputPath);
}

// 解析符号链接后再做边界检查，避免工作区内的 symlink 逃逸到工作区外
// （例如 Agent 通过 PowerShell 建符号链接指向 C:\Windows\System32 后读取）。
// 若路径不存在（尚未创建的文件），则逐级向上查找最近存在的祖先并 realpath 它，
// 再拼回原路径——这样未创建的文件也能受工作区边界约束。
function resolveRealPath(inputPath: string): string {
  const resolved = path.resolve(inputPath);
  try {
    return fs.realpathSync(resolved);
  } catch {
    // 路径不存在：向上找最近存在的祖先
    let cur = resolved;
    const segments: string[] = [];
    while (cur && cur !== path.dirname(cur)) {
      try {
        const real = fs.realpathSync(cur);
        return segments.length === 0 ? real : path.join(real, ...segments.reverse());
      } catch {
        segments.push(path.basename(cur));
        cur = path.dirname(cur);
      }
    }
    return resolved;
  }
}

function isInside(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel === '' || (!!rel && !rel.startsWith('..') && !path.isAbsolute(rel));
}

// Incremented on every failed requireAccess() — surfaced in the Debug panel as
// a crude "security events" counter. Not persisted across restarts.
let _deniedAttempts = 0;

export class PathPermissionStore {
  private roots = new Set<string>();
  private files = new Set<string>();

  grantRoot(rootPath: string) {
    const norm = normalize(rootPath);
    this.roots.add(norm);
    // 同时授权 realpath 形式：若授权根本身是 symlink，其子路径的 realpath
    // 会落在链接目标下，不加这条会被下方的交集校验误拒。
    try {
      const real = fs.realpathSync(norm);
      if (real !== norm) this.roots.add(real);
    } catch { /* 根尚不存在：仅保留词法形式 */ }
  }

  /** Returns a defensive copy of the granted roots (for the Debug panel). */
  getRoots(): string[] {
    return Array.from(this.roots);
  }

  grantFile(filePath: string) {
    const norm = normalize(filePath);
    this.files.add(norm);
    try {
      const real = fs.realpathSync(norm);
      if (real !== norm) this.files.add(real);
    } catch { /* 文件尚不存在：仅保留词法形式 */ }
  }

  grantPath(targetPath: string, isDirectory: boolean) {
    if (isDirectory) this.grantRoot(targetPath);
    else this.grantFile(targetPath);
  }

  canAccess(targetPath: string): boolean {
    const resolved = normalize(targetPath);
    // 第一关：词法路径必须落在授权范围内。
    const lexicalOk = this.files.has(resolved) || this.matchesAnyRoot(resolved);
    if (!lexicalOk) return false;
    // 第二关：realpath（解析 symlink 后）也必须落在授权范围内。
    // 两关取交集，封死「工作区内 symlink 指向外部被词法判定放行」的旁路。
    const real = resolveRealPath(resolved);
    // Windows 上 fs.realpathSync 可能返回带 `\\?\` 长路径前缀的路径，
    // 直接用原始 real 做 matchesAnyRoot/files.has 会让 path.relative 判定失真，
    // 导致「symlink 指向外部」的逃逸被误判为放行。归一化后再判定。
    const realNorm = normalize(real);
    if (realNorm === resolved) return true;
    return this.files.has(realNorm) || this.matchesAnyRoot(realNorm);
  }

  private matchesAnyRoot(p: string): boolean {
    for (const root of this.roots) {
      if (isInside(root, p)) return true;
    }
    return false;
  }

  hasGrants(): boolean {
    return this.roots.size > 0 || this.files.size > 0;
  }

  requireAccess(targetPath: string) {
    if (!this.canAccess(targetPath)) {
      _deniedAttempts++;
      throw new Error(`Path is not allowed: ${targetPath}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Module-level convenience wrappers (service-locator pattern).
//
// Handler modules (now split out of index.ts) need access to a shared
// PathPermissionStore instance without importing the index.ts singleton
// (which would create a circular dependency). They call `setCurrentPermissionStore`
// once at startup, then use these wrappers exactly like the old local functions
// in index.ts (`ensurePathAllowed`, `grantRoot`, `grantFile`, `canAccess`, …).
// ---------------------------------------------------------------------------

let _currentStore: PathPermissionStore | null = null;

/** Set the shared store (called by index.ts after instantiation). */
export function setCurrentPermissionStore(store: PathPermissionStore) {
  _currentStore = store;
}

function store(): PathPermissionStore {
  if (!_currentStore) throw new Error('PathPermissionStore not initialized — call setCurrentPermissionStore() first.');
  return _currentStore;
}

export function ensurePathAllowed(targetPath: string) {
  if (!store().canAccess(targetPath)) {
    throw new Error(`Path is not allowed: ${targetPath}`);
  }
}

export function canAccess(targetPath: string): boolean {
  return store().canAccess(targetPath);
}

export function grantRoot(p: string) { store().grantRoot(p); }
export function grantFile(p: string) { store().grantFile(p); }
export function grantPath(p: string, isDir: boolean) { store().grantPath(p, isDir); }
export function hasGrants(): boolean { return store().hasGrants(); }

// Exported for the Debug panel — snapshots granted roots.
export function getPermissionSnapshot(): { grantedRoots: string[]; deniedAttempts: number } {
  try {
    const roots = Array.from(store().getRoots());
    return { grantedRoots: roots, deniedAttempts: _deniedAttempts };
  } catch {
    return { grantedRoots: [], deniedAttempts: 0 };
  }
}
