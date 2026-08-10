import { test, expect, _electron } from '@playwright/test';
import path from 'path';
import { closeLoom } from './electron-helper';

/**
 * Packaged-app smoke: launches the electron-builder output (win-unpacked)
 * directly and verifies the UI boots. Confirms the rebuilt native modules
 * (node-pty / tree-sitter) load correctly inside the asar bundle.
 *
 * NOTE: `app.close()` can hang on the packaged app (tray/async teardown), so
 * we reuse closeLoom's race + taskkill fallback for teardown.
 */
const PACKAGED_EXE = path.resolve(process.cwd(), 'release', 'win-unpacked', 'Loom IDE.exe');

/**
 * The packaged app shares the dev userData dir, so a previous run's persisted
 * session (open files / workspace) may hide the welcome page. Reloading a
 * packaged page is unreliable, so we boot once to wipe localStorage, then
 * launch the real test instance from a clean state.
 */
async function freshApp() {
  const wiper = await _electron.launch({ executablePath: PACKAGED_EXE, args: ['--no-sandbox'] });
  try {
    const wpage = await wiper.firstWindow({ timeout: 30000 });
    await wpage.evaluate(() => localStorage.clear());
  } finally {
    await closeLoom(wiper);
  }
  const app = await _electron.launch({ executablePath: PACKAGED_EXE, args: ['--no-sandbox'] });
  const page = await app.firstWindow({ timeout: 30000 });
  return { app, page };
}

test('packaged app boots and shows the welcome page', async () => {
  const { app, page } = await freshApp();
  try {
    await expect(page.locator('.welcome-action').first()).toBeVisible({ timeout: 30000 });
    await expect(page.locator('.welcome-action')).toHaveCount(4);
  } finally {
    await closeLoom(app);
  }
});

test('packaged app terminal panel loads an xterm (node-pty ABI match)', async () => {
  const { app, page } = await freshApp();
  try {
    await expect(page.locator('.welcome-action').first()).toBeVisible({ timeout: 30000 });
    // The terminal panel mounts at boot and creates a PTY through node-pty.
    // Read the main-process terminal snapshot via the preload bridge: with a
    // broken node-pty (ABI mismatch) terminal:create falls back to a plain
    // cmd.exe spawn (isPty:false), so a live isPty:true entry proves the
    // rebuilt native module loads correctly inside the asar bundle.
    await expect.poll(async () => {
      const state = await page.evaluate(() => (window as any).loom.debugRuntime.getState());
      const terminals = state?.ok ? (state.data?.terminals || []) : [];
      return terminals.some((t: any) => t.isPty === true && t.pid != null);
    }, { timeout: 20000 }).toBe(true);
  } finally {
    await closeLoom(app);
  }
});
