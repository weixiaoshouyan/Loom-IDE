/**
 * Loom IDE — cross-platform `dev:main` launcher.
 *
 * Replaces `set NODE_ENV=development&& tsc -p tsconfig.main.json && electron .`
 * which only works under Windows cmd.exe and breaks on POSIX shells.
 * Compiles the main process and launches Electron with NODE_ENV=development.
 */
import { spawnSync, spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

const env = { ...process.env, NODE_ENV: 'development' };

// 1) Compile main process (must succeed before launching Electron).
const compile = spawnSync(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['tsc', '-p', path.join('config', 'tsconfig.main.json')],
  { cwd: projectRoot, stdio: 'inherit', shell: false, env },
);
if (compile.status !== 0) {
  process.exit(compile.status ?? 1);
}

// 2) Launch Electron against the freshly built main bundle.
const electron = spawn(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['electron', '.'],
  { cwd: projectRoot, stdio: 'inherit', shell: false, env },
);
electron.on('error', (err) => {
  console.error('[dev:main] failed to launch Electron:', err);
  process.exit(1);
});
electron.on('exit', (code) => process.exit(code ?? 0));
