import { test, expect } from '@playwright/test';
import { launchLoom, closeLoom, type BootedApp } from './electron-helper';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execSync } from 'child_process';

/**
 * Workspace workflow e2e tests.
 *
 * These boot the real Electron app and drive the full loop: open a folder
 * (via the IPC bridge — the E2E=1 env var auto-grants so the native
 * confirmation dialog is bypassed), edit a file in Monaco, save it, and
 * verify the bytes hit disk; then exercise the Git panel (untracked change
 * → click to open → diff view).
 */
let ctx: BootedApp;
const tmpDirs: string[] = [];

test.afterEach(async () => {
  if (ctx) {
    await closeLoom(ctx.app);
    ctx = undefined as any;
  }
  for (const dir of tmpDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function makeWorkspace(files: Record<string, string>, gitInit = false): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'loom-e2e-'));
  tmpDirs.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    // Resolve and verify the fixture stays inside the temp workspace.
    const p = path.resolve(dir, rel);
    if (p !== dir && !p.startsWith(dir + path.sep)) throw new Error(`fixture escapes workspace: ${rel}`);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content, 'utf-8');
  }
  if (gitInit) {
    execSync('git init -q', { cwd: dir });
    execSync('git config user.email e2e@loom.test && git config user.name e2e', { cwd: dir });
  }
  return dir;
}

async function openFolder(page: import('playwright').Page, folder: string) {
  // Wait for React to mount (welcome page visible ⇒ App's event listeners are
  // attached); dispatching 'loom:open-folder-path' earlier would be lost.
  await expect(page.locator('.welcome-action').first()).toBeVisible({ timeout: 15000 });
  // Drive the same path a real user click takes: App listens for
  // 'loom:open-folder-path' and calls dialog.openFolderByPath (E2E=1
  // auto-grants in the main process), then updates the workspace state.
  await page.evaluate((f) => {
    window.dispatchEvent(new CustomEvent('loom:open-folder-path', { detail: f }));
  }, folder);
}

test.describe('Loom IDE workspace workflow', () => {
  test('opens a folder, edits a file in Monaco, saves to disk', async () => {
    const ws = makeWorkspace({ 'src/hello.ts': 'export const greet = (name: string) => `hi ${name}`;\n' });
    ctx = await launchLoom();
    const page = ctx.firstWindow;

    await openFolder(page, ws);

    // Explorer shows the folder; expand it to reveal the nested file.
    await expect(page.locator('.tree-item', { hasText: 'src' })).toBeVisible({ timeout: 15000 });
    await page.locator('.tree-item', { hasText: 'src' }).click();
    await expect(page.locator('.tree-item', { hasText: 'hello.ts' })).toBeVisible({ timeout: 15000 });

    // Open it — the Monaco editor renders the content.
    await page.locator('.tree-item', { hasText: 'hello.ts' }).click();
    await expect(page.locator('.monaco-editor')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('.monaco-editor .view-lines')).toContainText('export const greet', { timeout: 15000 });

    // Type an edit at the end of the file, then Ctrl+S.
    await page.locator('.monaco-editor').click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('\nexport const bye = () => "bye";');
    await page.keyboard.press('Control+s');

    // The save must land on disk (format-and-save → fs:write-file).
    await expect.poll(
      () => fs.readFileSync(path.join(ws, 'src', 'hello.ts'), 'utf-8'),
      { timeout: 10000 },
    ).toContain('bye');
  });

  test('git panel lists the untracked change, opens it, and shows the diff view', async () => {
    const ws = makeWorkspace({ 'README.md': '# E2E project\n' }, true);
    ctx = await launchLoom();
    const page = ctx.firstWindow;

    await openFolder(page, ws);
    await expect(page.locator('.tree-item', { hasText: 'README.md' })).toBeVisible({ timeout: 15000 });

    // Switch to the source control view (Ctrl+Shift+G).
    await page.keyboard.press('Control+Shift+g');
    await expect(page.locator('.tree-item', { hasText: 'README.md' })).toBeVisible({ timeout: 15000 });

    // Click the change → the file opens in the editor.
    await page.locator('.tree-item', { hasText: 'README.md' }).click();
    await expect(page.locator('.monaco-editor .view-lines')).toContainText('E2E project', { timeout: 15000 });

    // Open the diff view (untracked file → empty original, new content).
    await page.getByTitle(/View Diff|查看差异/).click();
    await expect(page.locator('.diff-modal')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('.diff-modal')).toContainText('README.md');

    // Esc closes it.
    await page.keyboard.press('Escape');
    await expect(page.locator('.diff-modal')).toHaveCount(0);
  });
});
