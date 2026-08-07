import fs from 'fs';
import os from 'os';
import path from 'path';

const TRACE_FILE = path.join(os.tmpdir(), 'loom-trace.log');

export function clearTrace() {
  try {
    fs.writeFileSync(TRACE_FILE, `=== trace start ${new Date().toISOString()} pid=${process.pid} ===\n`);
  } catch {}
}

export function trace(step: string) {
  try {
    const line = `${new Date().toISOString()} [${process.pid}] ${step}\n`;
    fs.appendFileSync(TRACE_FILE, line);
  } catch {}
}
