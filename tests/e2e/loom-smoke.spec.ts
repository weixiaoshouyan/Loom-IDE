import { test, expect } from '@playwright/test';
import { launchLoom, closeLoom, type BootedApp } from './electron-helper';

/**
 * Smoke tests for Loom IDE.
 *
 * These boot the real Electron app (compiled dist/main/index.js) and verify
 * that the critical surfaces render without throwing and that the essential
 * interaction primitives work. They intentionally avoid asserting on exact
 * visual layout — that's the job of screenshot/visual tests if/when added.
 */
test.describe('Loom IDE boot', () => {
  let ctx: BootedApp;

  test.afterEach(async () => {
    if (ctx) {
      await closeLoom(ctx.app);
      ctx = undefined as any;
    }
  });

  test('launches and shows the welcome page', async () => {
    ctx = await launchLoom();

    // The welcome page is the default landing surface when no folder is open.
    await expect(ctx.firstWindow.locator('.welcome-action')).toBeVisible();

    // Primary action buttons render (New File, Open File, Open Folder).
    const actionButtons = ctx.firstWindow.locator('.welcome-action');
    await expect(actionButtons).toHaveCount(3);
  });

  test('AI status chip renders', async () => {
    ctx = await launchLoom();

    // The AI status chip appears whether or not a model is configured — it
    // shows "未配置模型" / "No Model Configured" in the unconfigured state.
    const chip = ctx.firstWindow.locator('.welcome-ai-chip').first();
    await expect(chip).toBeVisible();
  });

  test('settings button is reachable', async () => {
    ctx = await launchLoom();

    // The settings entry button lives in the welcome chip bar.
    const setupBtn = ctx.firstWindow.locator('.welcome-ai-setup');
    await expect(setupBtn).toBeVisible();
    await expect(setupBtn).toBeEnabled();
  });

  test('window is responsive to resize', async () => {
    ctx = await launchLoom();

    // Resize the BrowserWindow directly (Playwright's Electron Page has no
    // setSize(); we drive it through the main-process handle).
    const bounds = { x: 100, y: 100, width: 1024, height: 720 };
    await ctx.app.evaluate((electron, b) => {
      const win = electron.BrowserWindow.getAllWindows()[0];
      if (win) win.setBounds(b);
    }, bounds as any);

    // After resize the welcome actions should still be present.
    await expect(ctx.firstWindow.locator('.welcome-action')).toBeVisible();
  });
});
