/**
 * Git operations — spawn-based helpers + IPC registration.
 *
 * `runGit` is exported because the AI agent's `onGitCommand` callback also
 * uses it. All handlers enforce path-permission checks before spawning.
 */
import { ipcMain } from 'electron';
import { spawn } from 'child_process';
import path from 'path';
import { ensurePathAllowed } from './path-permissions';

/**
 * SECURITY: git options that let a crafted argument escape the workspace or
 * execute external hooks. `-c key=val` (incl. `core.hooksPath=...`), `-C <dir>`,
 * `--git-dir` / `--work-tree` / `--exec-path` / `--config-env` all redirect
 * git's behavior to attacker-chosen paths — the AI agent's onGitCommand and
 * every UI handler route through runGit, so blocking here covers both.
 */
const UNSAFE_GIT_ARGS = new Set(['-c', '-C', '--config-env', '--work-tree', '--git-dir', '--exec-path', '--namespace']);
const UNSAFE_GIT_ARG_PREFIXES = ['-c=', '--config-env=', '--work-tree=', '--git-dir=', '--exec-path=', '--namespace='];

export function hasUnsafeGitArg(args: string[]): boolean {
  for (const a of args) {
    if (UNSAFE_GIT_ARGS.has(a)) return true;
    if (UNSAFE_GIT_ARG_PREFIXES.some(p => a.startsWith(p))) return true;
  }
  return false;
}

export function runGit(cwd: string, args: string[]): Promise<string> {
  if (hasUnsafeGitArg(args)) {
    return Promise.reject(new Error('Unsafe git argument blocked (c/hooks/--work-tree/--git-dir etc.)'));
  }
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { cwd, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });
    child.on('close', (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(stderr.trim() || `git exited with code ${code}`));
    });
    child.on('error', (err) => reject(err));
  });
}

/** List git branches in a workspace (local + current-branch marker stripped). */
async function thisBranchList(cwd: string): Promise<string[]> {
  try {
    const out = await runGit(cwd, ['branch', '--list', '--no-color']);
    return out.split('\n').map(b => b.replace(/^\*?\s*/, '').trim()).filter(Boolean);
  } catch {
    return [];
  }
}

export function registerGitHandlers() {
  // Combined status+branch in a single `git status -sb` call (avoids 3 spawns).
  ipcMain.handle('git:status', async (_e: any, cwd: string) => {    try {
      if (!ensurePathAllowedSafe(cwd)) return { branch: '', branches: [], changes: [] };
      const out = await runGit(cwd, ['status', '-sb', '--untracked-files=all']);
      const lines = out.split('\n').filter(Boolean);
      let branch = '';
      const changes: { status: string; file: string }[] = [];
      for (const line of lines) {
        if (line.startsWith('## ')) {
          branch = line.slice(3).trim().split('...')[0].split(/\s/)[0].trim() || '';
          continue;
        }
        const status = line.substring(0, 2);
        let file = line.substring(3).trim();
        if (file.includes(' -> ')) file = file.split(' -> ')[1];
        changes.push({ status, file });
      }
      return { branch, branches: await thisBranchList(cwd), changes };
    } catch {
      return { branch: '', branches: [], changes: [] };
    }
  });

  // Branch list: on-demand (panel switch), never polled periodically.
  ipcMain.handle('git:branches', async (_e: any, cwd: string) => {
    try {
      if (!ensurePathAllowedSafe(cwd)) return [];
      return await thisBranchList(cwd);
    } catch { return []; }
  });

  ipcMain.handle('git:stage', async (_e: any, cwd: string, file: string) => {
    try {
      if (!ensurePathAllowedSafe(cwd)) return false;
      // SECURITY: `--` prevents a crafted filename starting with `-` (e.g.
      // `-p`) from being parsed as a git option and hanging in interactive mode.
      if (file && !ensurePathAllowedSafe(path.resolve(cwd, file))) return false;
      await runGit(cwd, ['add', '--', file]);
      return true;
    }
    catch { return false; }
  });

  ipcMain.handle('git:unstage', async (_e: any, cwd: string, file: string) => {
    try {
      if (!ensurePathAllowedSafe(cwd)) return false;
      if (file && !ensurePathAllowedSafe(path.resolve(cwd, file))) return false;
      await runGit(cwd, ['reset', 'HEAD', '--', file]);
      return true;
    }
    catch { return false; }
  });

  ipcMain.handle('git:commit', async (_e: any, cwd: string, message: string) => {
    try { if (!ensurePathAllowedSafe(cwd)) return false; await runGit(cwd, ['commit', '-m', message]); return true; }
    catch { return false; }
  });

  ipcMain.handle('git:pull', async (_e: any, cwd: string) => {
    try { if (!ensurePathAllowedSafe(cwd)) return 'Error: workspace not allowed'; return await runGit(cwd, ['pull']); }
    catch (e: any) { return `Error: ${e.message}`; }
  });

  ipcMain.handle('git:push', async (_e: any, cwd: string) => {
    try { if (!ensurePathAllowedSafe(cwd)) return 'Error: workspace not allowed'; return await runGit(cwd, ['push']); }
    catch (e: any) { return `Error: ${e.message}`; }
  });

  ipcMain.handle('git:checkout', async (_e: any, cwd: string, branch: string) => {
    try {
      if (!ensurePathAllowedSafe(cwd)) return false;
      // SECURITY: a branch starting with `-` would be parsed as a git option.
      if (!branch || !/^[A-Za-z0-9._/+-]+$/.test(branch) || branch.startsWith('-')) return false;
      await runGit(cwd, ['checkout', branch]);
      return true;
    }
    catch { return false; }
  });

  ipcMain.handle('git:log', async (_e: any, cwd: string, count: number = 20) => {
    try {
      if (!ensurePathAllowedSafe(cwd)) return [];
      // Clamp so a crafted count cannot become an option-like `-N` beyond
      // sane limits (e.g. `-9999999` or negative values).
      const n = Math.min(100, Math.max(1, Math.floor(Number(count) || 20)));
      const output = await runGit(cwd, ['log', `-${n}`, '--oneline', '--decorate', '--graph']);
      return output.split('\n').filter(Boolean);
    } catch { return []; }
  });

  ipcMain.handle('git:diff', async (_e: any, cwd: string, file?: string) => {
    try {
      if (!ensurePathAllowedSafe(cwd)) return '';
      // SECURITY: the file must live inside the granted workspace too.
      if (file && !ensurePathAllowedSafe(path.resolve(cwd, file))) return '';
      const args = ['diff'];
      if (file) args.push('--', file);
      return await runGit(cwd, args);
    } catch { return ''; }
  });

  // Original (HEAD or index) content of a file — feeds the diff view. Returns
  // '' for untracked files. `file` must be a workspace-relative git path.
  ipcMain.handle('git:show', async (_e: any, cwd: string, file: string) => {
    try {
      if (!ensurePathAllowedSafe(cwd)) return '';
      const rel = String(file || '').replace(/\\/g, '/');
      // SECURITY: reject traversal segments — the file must stay inside the repo.
      if (!rel || rel.startsWith('/') || rel.split('/').includes('..')) return '';
      if (!ensurePathAllowedSafe(path.resolve(cwd, rel))) return '';
      try {
        return await runGit(cwd, ['show', `HEAD:${rel}`]);
      } catch {
        // Not committed yet — try the index (staged new file).
        return await runGit(cwd, ['show', `:${rel}`]);
      }
    } catch { return ''; }
  });
}

// Local wrapper so this module doesn't throw on ungranted paths (handlers return
// empty/error values instead). `ensurePathAllowed` throws; we translate that.
function ensurePathAllowedSafe(targetPath: string): boolean {
  try {
    ensurePathAllowed(targetPath);
    return true;
  } catch { return false; }
}
