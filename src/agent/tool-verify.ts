import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';

/**
 * Resolve the workspace-local TypeScript checker (node_modules/typescript/bin/tsc).
 * Returns null when TypeScript isn't installed locally — we never fall back to
 * npx, because that would silently download-and-execute from the registry.
 */
export function resolveLocalTsc(ws: string): string | null {
  const candidates = [
    path.join(ws, 'node_modules', 'typescript', 'bin', 'tsc'),
    path.join(ws, 'node_modules', 'typescript', 'lib', 'tsc.js'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

/**
 * Run `tsc --noEmit` asynchronously (never spawnSync — a long type-check must
 * not freeze the main process event loop for up to a minute). Runs the checker
 * with the app's own bundled Node runtime (ELECTRON_RUN_AS_NODE) so we don't
 * depend on `node` being on PATH and never touch the network.
 */
export function runTscCheck(ws: string, timeoutMs = 120000): Promise<{ ok: boolean; output: string; error?: string }> {
  return new Promise((resolve) => {
    const tscEntry = resolveLocalTsc(ws);
    if (!tscEntry) {
      resolve({
        ok: false,
        output: '',
        error: 'TypeScript is not installed in this workspace (node_modules/typescript missing). Install it locally, or run the project\'s own linter via run_command.',
      });
      return;
    }
    let stdout = '';
    let stderr = '';
    let settled = false;
    const child = spawn(process.execPath, [tscEntry, '--noEmit', '--pretty'], {
      cwd: ws,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      windowsHide: true,
      shell: false,
    });
    const timer = setTimeout(() => {
      try { child.kill(); } catch {}
      finish({ ok: false, output: stdout + stderr, error: `tsc timed out after ${timeoutMs}ms` });
    }, timeoutMs);
    const finish = (payload: { ok: boolean; output: string; error?: string }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(payload);
    };
    child.stdout?.on('data', (d: Buffer) => { stdout += d.toString('utf-8'); });
    child.stderr?.on('data', (d: Buffer) => { stderr += d.toString('utf-8'); });
    child.on('error', (err: Error) => finish({ ok: false, output: '', error: err.message }));
    child.on('close', (code) => finish({ ok: code === 0, output: stdout + stderr }));
  });
}
