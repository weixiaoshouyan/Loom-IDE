/**
 * File system IPC handlers — read/write/dir/stat/exists/mkdir/delete/rename.
 *
 * Every handler enforces path-permission checks before touching the disk.
 */
import { ipcMain } from 'electron';
import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';
import { ensurePathAllowed, grantRoot, grantFile } from './path-permissions';

export function registerFileHandlers() {
  ipcMain.handle('fs:read-file', async (_e: any, filePath: string) => {
    try {
      ensurePathAllowed(filePath);
      return fs.readFileSync(filePath, 'utf-8');
    } catch (e: any) {
      return `__ERR__:${e.message}`;
    }
  });

  ipcMain.handle('fs:write-file', async (_e: any, filePath: string, content: string) => {
    ensurePathAllowed(filePath);
    // Atomic write: write to a temp file in the same directory, then rename.
    // Guarantees that a crash mid-write never leaves a truncated target file.
    const dir = path.dirname(filePath);
    const tmp = path.join(dir, `.loom-tmp-${process.pid}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
    // fsync before rename so the rename never publishes partially-flushed data
    // (crash-consistency for the whole file, not just the rename).
    const fd = fs.openSync(tmp, 'w');
    try {
      fs.writeSync(fd, content, null, 'utf-8');
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, filePath);
    return true;
  });

  ipcMain.handle('fs:read-dir', async (_e: any, dirPath: string) => {
    ensurePathAllowed(dirPath);
    const entries = await fsPromises.readdir(dirPath, { withFileTypes: true });
    return entries.map((e) => ({
      name: e.name,
      isDirectory: e.isDirectory(),
      path: path.join(dirPath, e.name),
    }));
  });

  ipcMain.handle('fs:stat', async (_e: any, filePath: string) => {
    ensurePathAllowed(filePath);
    const stat = fs.statSync(filePath);
    return { isDirectory: stat.isDirectory(), size: stat.size, mtime: stat.mtimeMs };
  });

  ipcMain.handle('fs:exists', async (_e: any, filePath: string) => {
    try { ensurePathAllowed(filePath); return fs.existsSync(filePath); }
    catch { return false; }
  });

  ipcMain.handle('fs:mkdir', async (_e: any, dirPath: string) => {
    ensurePathAllowed(path.dirname(dirPath));
    fs.mkdirSync(dirPath, { recursive: true });
    grantRoot(dirPath);
    return true;
  });

  ipcMain.handle('fs:delete', async (_e: any, targetPath: string) => {
    ensurePathAllowed(targetPath);
    const stat = fs.statSync(targetPath);
    if (stat.isDirectory()) fs.rmSync(targetPath, { recursive: true });
    else fs.unlinkSync(targetPath);
    return true;
  });

  ipcMain.handle('fs:rename', async (_e: any, oldPath: string, newPath: string) => {
    ensurePathAllowed(oldPath);
    ensurePathAllowed(path.dirname(newPath));
    fs.renameSync(oldPath, newPath);
    grantFile(newPath);
    return true;
  });
}
