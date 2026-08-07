import { _electron as electron, ElectronApplication, Page } from '@playwright/test';
import path from 'path';

/**
 * Resolved path to the compiled main process entry.
 * Playwright's Electron runner needs the actual JS entry, not the .ts source.
 */
const MAIN_ENTRY = path.resolve(
  process.cwd(),
  process.env.E2E_MAIN_ENTRY || 'dist/main/index.js'
);

/**
 * Resolved path to the Electron distribution.
 */
const ELECTRON_DIST = path.resolve(
  process.cwd(),
  process.env.E2E_ELECTRON_DIST || 'node_modules/electron/dist'
);

export interface BootedApp {
  app: ElectronApplication;
  firstWindow: Page;
}

/**
 * Launch a fresh Loom IDE instance and wait for the first window to load.
 * The main entry is compiled ahead of time by `tsc -p tsconfig.main.json`.
 *
 * Pass additional args via e.g. `--no-sandbox` in CI containers.
 */
export async function launchLoom(extraArgs: string[] = []): Promise<BootedApp> {
  const app = await electron.launch({
    args: [MAIN_ENTRY, '--no-sandbox', ...extraArgs],
    executablePath: process.env.ELECTRON_EXE
      ? path.resolve(process.cwd(), process.env.ELECTRON_EXE)
      : undefined,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      E2E: '1',
    },
  });

  const firstWindow = await app.firstWindow();
  return { app, firstWindow };
}

/**
 * Gracefully close an Electron app. Force-kills if it does not exit cleanly
 * within the timeout so the test runner never hangs on a rogue process.
 */
export async function closeLoom(app: ElectronApplication, timeoutMs = 8000): Promise<void> {
  try {
    await app.close();
  } catch {
    // If close() rejects (e.g. renderer process already gone), ignore.
  }
  // Belt-and-suspenders: ensure the main process is gone.
  if (!app.process().killed) {
    const timer = setTimeout(() => app.process().kill('SIGKILL'), timeoutMs);
    await app.process().on('exit', () => clearTimeout(timer));
  }
}
