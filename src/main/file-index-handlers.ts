/**
 * File-index handlers — recursive directory scan with mtime cache.
 *
 * Powers Quick Open (Ctrl+P). Results are cached for 30s and invalidated when
 * the workspace mtime changes.
 */
import { ipcMain } from 'electron';
import fs from 'fs';
import { canAccess } from './path-permissions';

let fileIndex: string[] = [];
let fileIndexCwd = '';
let fileIndexMtime = 0;
let fileIndexBuildTime = 0;

function getDirMtime(cwd: string): number {
  try { return fs.statSync(cwd).mtimeMs; } catch { return 0; }
}

async function buildFileIndex(cwd: string): Promise<string[]> {
  const result: string[] = [];
  const hidden = new Set(['node_modules', '.git', 'dist', 'release', '__pycache__', '.next', 'coverage', '.vscode', '.workbuddy']);

  async function walk(dir: string, depth: number) {
    if (depth > 8 || result.length > 10000) return;
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const e of entries) {
        if (hidden.has(e.name)) continue;
        const full = `${dir}/${e.name}`;
        if (e.isDirectory()) await walk(full, depth + 1);
        else result.push(full);
      }
    } catch {}
  }
  await walk(cwd, 0);
  return result;
}

export function registerFileIndexHandlers() {
  ipcMain.handle('fs:index-files', async (_e: any, cwd: string) => {
    if (!canAccess(cwd)) throw new Error(`Path not allowed: ${cwd}`);
    const now = Date.now();
    const dirMtime = getDirMtime(cwd);
    if (
      fileIndexCwd === cwd && fileIndex.length > 0 &&
      fileIndexMtime === dirMtime && (now - fileIndexBuildTime) < 30000
    ) {
      return fileIndex;
    }
    fileIndex = await buildFileIndex(cwd);
    fileIndexCwd = cwd;
    fileIndexMtime = dirMtime;
    fileIndexBuildTime = now;
    return fileIndex;
  });

  ipcMain.handle('fs:search-files', async (_e: any, cwd: string, query: string) => {
    if (!canAccess(cwd)) throw new Error(`Path not allowed: ${cwd}`);
    const now = Date.now();
    const dirMtime = getDirMtime(cwd);
    if (
      fileIndexCwd !== cwd || fileIndex.length === 0 ||
      fileIndexMtime !== dirMtime || (now - fileIndexBuildTime) >= 30000
    ) {
      fileIndex = await buildFileIndex(cwd);
      fileIndexCwd = cwd;
      fileIndexMtime = dirMtime;
      fileIndexBuildTime = now;
    }
    const q = query.toLowerCase();
    const scored = fileIndex.map(fp => {
      const name = fp.split(/[\\/]/).pop()?.toLowerCase() || '';
      let score = 0;
      if (name === q) score = 100;
      else if (name.startsWith(q)) score = 80;
      else if (name.includes(q)) score = 60;
      else {
        let qi = 0;
        for (let i = 0; i < name.length && qi < q.length; i++) {
          if (name[i] === q[qi]) qi++;
        }
        if (qi === q.length) score = 40;
        else return null;
      }
      return { path: fp, score };
    }).filter(Boolean).sort((a: any, b: any) => b.score - a.score).slice(0, 50);
    return scored.map((s: any) => s.path);
  });
}
