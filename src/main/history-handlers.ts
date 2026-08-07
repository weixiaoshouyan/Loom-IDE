/**
 * Local file history (snapshots) — append-only JSONL per file.
 *
 * Each file's edit history is stored as a JSONL file keyed by a base64 hash of
 * the absolute path. Snapshots are written on every editor save.
 *
 * Storage management — the three knobs below govern an automatic rotation and
 * cleanup loop. All three live under `history` in the persisted config so the
 * user can tune them in Settings:
 *   - maxEntriesPerFile: cap on retained entries per file (count-based prune).
 *   - maxAgeDays: entries older than this are pruned (time-based prune).
 *   - maxTotalMB: total budget for the whole history dir; oldest files are
 *     unlinked until the budget is satisfied.
 */
import { ipcMain } from 'electron';
import fs from 'fs';
import path from 'path';
import { getDataDir, ensureDataDir, loadConfig, saveConfig } from './config';
import { ensurePathAllowed } from './path-permissions';

const historyDir = path.join(getDataDir(), 'history');

function ensureHistoryDir() {
  if (!fs.existsSync(historyDir)) fs.mkdirSync(historyDir, { recursive: true });
}

function historyFileFor(filePath: string): string {
  const hash = Buffer.from(filePath).toString('base64').replace(/[/+=]/g, '_');
  return path.join(historyDir, `${hash}.jsonl`);
}

/** Read the current history policy from config, with safe fallbacks. */
function getPolicy() {
  try {
    const cfg = loadConfig();
    const h = cfg.history;
    return {
      maxEntriesPerFile: typeof h?.maxEntriesPerFile === 'number' && h.maxEntriesPerFile > 0
        ? h.maxEntriesPerFile : 50,
      maxAgeDays: typeof h?.maxAgeDays === 'number' && h.maxAgeDays > 0
        ? h.maxAgeDays : 30,
      maxTotalMB: typeof h?.maxTotalMB === 'number' && h.maxTotalMB > 0
        ? h.maxTotalMB : 100,
    };
  } catch {
    return { maxEntriesPerFile: 50, maxAgeDays: 30, maxTotalMB: 100 };
  }
}

interface HistoryEntry {
  ts: number;
  size: number;
  content: string;
  prevOriginal?: string;
}

function readEntries(filePath: string): HistoryEntry[] {
  const fp = historyFileFor(filePath);
  if (!fs.existsSync(fp)) return [];
  const lines = fs.readFileSync(fp, 'utf-8').split('\n').filter(Boolean);
  const entries: HistoryEntry[] = [];
  for (const line of lines) {
    try { entries.push(JSON.parse(line)); } catch { /* skip corrupt line */ }
  }
  return entries;
}

function writeEntries(filePath: string, entries: HistoryEntry[]) {
  const fp = historyFileFor(filePath);
  const body = entries.map((e) => JSON.stringify(e)).join('\n');
  // Atomic write: temp + rename so a crash mid-write can't leave a truncated
  // JSONL file behind.
  const tmp = fp + '.tmp';
  fs.writeFileSync(tmp, body + (entries.length ? '\n' : ''), 'utf-8');
  fs.renameSync(tmp, fp);
}

/**
 * Read a JSONL history file, apply the per-file rotation policy, and write it
 * back if anything was pruned. Returns the number of entries removed.
 */
function pruneFile(filePath: string, policy: ReturnType<typeof getPolicy>): number {
  const entries = readEntries(filePath);
  if (entries.length === 0) return 0;

  const cutoffTs = Date.now() - policy.maxAgeDays * 24 * 60 * 60 * 1000;
  // Keep entries that are young enough; among those, cap by count.
  const kept = entries
    .filter((e) => e.ts >= cutoffTs)
    .slice(0, policy.maxEntriesPerFile);

  if (kept.length === entries.length) return 0;

  if (kept.length === 0) {
    // Nothing left — remove the file entirely.
    try { fs.unlinkSync(historyFileFor(filePath)); } catch {}
    return entries.length;
  }
  writeEntries(filePath, kept);
  return entries.length - kept.length;
}

/** Sum the sizes (bytes) of every `.jsonl` file in the history directory. */
function totalHistoryBytes(): number {
  let total = 0;
  try {
    for (const f of fs.readdirSync(historyDir)) {
      if (!f.endsWith('.jsonl')) continue;
      try { total += fs.statSync(path.join(historyDir, f)).size; } catch {}
    }
  } catch {}
  return total;
}

interface FileStat {
  file: string;   // history file name (base64 hash)
  mtime: number;  // oldest entry timestamp (approximated via file mtime)
  size: number;
}

/**
 * Whole-directory cleanup: if total usage exceeds maxTotalMB, unlink the
 * oldest history files (by mtime) until under budget. This is the "nuclear"
 * option — it removes an entire file's history, not individual entries.
 */
function pruneDirToBudget(policy: ReturnType<typeof getPolicy>): number {
  const budgetBytes = policy.maxTotalMB * 1024 * 1024;
  if (totalHistoryBytes() <= budgetBytes) return 0;

  // Collect file stats, sort oldest-first.
  const stats: FileStat[] = [];
  try {
    for (const f of fs.readdirSync(historyDir)) {
      if (!f.endsWith('.jsonl')) continue;
      const full = path.join(historyDir, f);
      try {
        const st = fs.statSync(full);
        stats.push({ file: f, mtime: st.mtimeMs, size: st.size });
      } catch {}
    }
  } catch { return 0; }
  stats.sort((a, b) => a.mtime - b.mtime);

  let removed = 0;
  let current = totalHistoryBytes();
  for (const st of stats) {
    if (current <= budgetBytes) break;
    try {
      fs.unlinkSync(path.join(historyDir, st.file));
      current -= st.size;
      removed++;
    } catch {}
  }
  return removed;
}

/**
 * Run the full rotation/cleanup pass. Called automatically after writes
 * (debounced) and exposed via the `history:cleanup` IPC for on-demand runs.
 */
export function runHistoryCleanup(): { entriesPruned: number; filesRemoved: number } {
  const policy = getPolicy();
  ensureHistoryDir();

  // Per-file rotation (count + age).
  let entriesPruned = 0;
  try {
    for (const f of fs.readdirSync(historyDir)) {
      if (!f.endsWith('.jsonl')) continue;
      // We don't know the original path from the hash here — but the JSONL
      // file IS the per-file store, so we can prune directly by file.
      entriesPruned += pruneHistoryFile(f, policy);
    }
  } catch {}

  // Directory-level budget cap.
  const filesRemoved = pruneDirToBudget(policy);

  return { entriesPruned, filesRemoved };
}

// Overload: prune a specific JSONL file by its stored name.
function pruneHistoryFile(fileName: string, policy: ReturnType<typeof getPolicy>): number {
  const fp = path.join(historyDir, fileName);
  if (!fs.existsSync(fp)) return 0;
  // Read, parse, filter — same logic as pruneFile but keyed on disk name.
  const lines = fs.readFileSync(fp, 'utf-8').split('\n').filter(Boolean);
  const entries: HistoryEntry[] = [];
  for (const line of lines) {
    try { entries.push(JSON.parse(line)); } catch {}
  }
  if (entries.length === 0) return 0;

  const cutoffTs = Date.now() - policy.maxAgeDays * 24 * 60 * 60 * 1000;
  const kept = entries.filter((e) => e.ts >= cutoffTs).slice(0, policy.maxEntriesPerFile);

  if (kept.length === entries.length) return 0;
  if (kept.length === 0) {
    try { fs.unlinkSync(fp); } catch {}
    return entries.length;
  }
  const body = kept.map((e) => JSON.stringify(e)).join('\n') + '\n';
  const tmp = fp + '.tmp';
  fs.writeFileSync(tmp, body, 'utf-8');
  fs.renameSync(tmp, fp);
  return entries.length - kept.length;
}

// ---- Debounced cleanup -------------------------------------------------------
// Don't run the full directory scan on every keystroke-save. Wait until writes
// are quiet for a bit, then do one pass.
let cleanupTimer: ReturnType<typeof setTimeout> | null = null;
const CLEANUP_DEBOUNCE_MS = 30_000;

function scheduleCleanup() {
  if (cleanupTimer) clearTimeout(cleanupTimer);
  cleanupTimer = setTimeout(() => {
    cleanupTimer = null;
    try { runHistoryCleanup(); } catch {}
  }, CLEANUP_DEBOUNCE_MS);
}

// ---- IPC handlers -----------------------------------------------------------

export function registerHistoryHandlers() {
  ipcMain.handle('history:snapshot', (_e: any, filePath: string, content: string, prevOriginal: string) => {
    // SECURITY: reading/writing history for an arbitrary path would leak file
    // contents outside the granted workspace.
    if (!ensureHistoryPathAllowed(filePath)) return false;
    try {
      ensureHistoryDir();
      const fp = historyFileFor(filePath);
      const line = JSON.stringify({
        ts: Date.now(),
        size: Buffer.byteLength(content, 'utf-8'),
        // Cap the snapshot payload — oversized contents would bloat the local
        // history file and degrade snapshot/restore.
        content: Buffer.byteLength(content || '', 'utf-8') > 1024 * 1024 ? '' : content,
        prevOriginal: (prevOriginal || '').slice(0, 1000),
      });
      fs.appendFileSync(fp, line + '\n', 'utf-8');
      scheduleCleanup();
      return true;
    } catch (e) {
      console.error('[history] write failed', e);
      return false;
    }
  });

  ipcMain.handle('history:list', (_e: any, filePath: string) => {
    if (!ensureHistoryPathAllowed(filePath)) return [];
    try {
      const entries = readEntries(filePath);
      const out = entries.map((o, i) => ({ ts: o.ts, size: o.size, isInitial: i === entries.length - 1 }));
      return out.reverse(); // newest first
    } catch { return []; }
  });

  ipcMain.handle('history:get', (_e: any, filePath: string, ts: number): string | null => {
    if (!ensureHistoryPathAllowed(filePath)) return null;
    try {
      const entries = readEntries(filePath);
      const hit = entries.find((o) => o.ts === ts);
      return hit ? hit.content : null;
    } catch { return null; }
  });

  ipcMain.handle('history:restore', (_e: any, filePath: string, content: string) => {
    try {
      ensurePathAllowed(filePath);
      // Atomic write via temp + rename.
      const tmp = filePath + '.tmp';
      fs.writeFileSync(tmp, content, 'utf-8');
      fs.renameSync(tmp, filePath);
      return true;
    } catch { return false; }
  });

  ipcMain.handle('history:cleanup', () => {
    try { return runHistoryCleanup(); }
    catch { return { entriesPruned: 0, filesRemoved: 0 }; }
  });

  ipcMain.handle('history:stats', () => {
    try {
      const files = fs.readdirSync(historyDir).filter((f) => f.endsWith('.jsonl')).length;
      return { files, totalBytes: totalHistoryBytes() };
    } catch { return { files: 0, totalBytes: 0 }; }
  });
}

// Local wrapper so this module doesn't throw on ungranted paths (handlers
// return empty/error values instead). `ensurePathAllowed` throws; we translate
// that. Untitled files (no real path) are allowed — history is keyed in memory.
function ensureHistoryPathAllowed(filePath: string): boolean {
  if (!filePath || filePath.startsWith('untitled-')) return true;
  try {
    ensurePathAllowed(filePath);
    return true;
  } catch { return false; }
}

// Exposed for unit tests and for shutdown registration in index.ts.
export function stopHistoryCleanupTimer() {
  if (cleanupTimer) {
    clearTimeout(cleanupTimer);
    cleanupTimer = null;
  }
}
