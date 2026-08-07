/**
 * crash-handler.ts
 * Registers global uncaughtException / unhandledRejection handlers that persist
 * the stack to a file. Imported FIRST in index.ts so it is active before any
 * other module is evaluated — this catches both module-load crashes and runtime
 * errors that would otherwise only surface via Electron's (often invisible) error
 * dialog in headless environments.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

// Per-process crash log: multiple Loom instances (or a previous crash) must
// not overwrite each other's diagnostics on the same machine.
const CRASH_LOG = path.join(os.tmpdir(), `loom-crash-${process.pid}.log`);

function writeCrash(kind: string, err: unknown): void {
  try {
    const detail = err instanceof Error ? err.stack || err.message : String(err);
    const msg = `[${new Date().toISOString()}] ${kind}\n${detail}\n\n`;
    fs.appendFileSync(CRASH_LOG, msg);
  } catch {
    /* ignore — last-resort logging must never throw */
  }
}

process.on('uncaughtException', (err: Error) => {
  writeCrash('uncaughtException', err);
  // An uncaught exception leaves the process in an unknown state; continuing
  // silently can corrupt files/config. Give the other listeners (telemetry)
  // a tick to flush, then exit instead of limping along.
  setTimeout(() => process.exit(1), 200);
});

process.on('unhandledRejection', (reason: unknown) => {
  writeCrash('unhandledRejection', reason);
});

export { CRASH_LOG };
