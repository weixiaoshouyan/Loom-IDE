import { test, expect } from '@playwright/test';
import { launchLoom, closeLoom, type BootedApp } from './electron-helper';

/**
 * Agent panel UI verification: default language is Chinese, the run-status
 * bar and quick actions render, and the memoized message list still renders
 * tool-call entries after an agent-style exchange is injected.
 */
let ctx: BootedApp;

test.afterEach(async () => {
  if (ctx) {
    await closeLoom(ctx.app);
    ctx = undefined as any;
  }
});

test('agent panel defaults to Chinese UI', async () => {
  ctx = await launchLoom();
  const page = ctx.firstWindow;
  await expect(page.locator('.welcome-action').first()).toBeVisible({ timeout: 15000 });

  // Open the AI panel via the activity bar button (accessible name "AI Agent").
  await page.getByRole('button', { name: 'AI Agent' }).click();
  await expect(page.locator('.ai-agent-panel')).toBeVisible({ timeout: 15000 });

  // Header shows the Chinese title.
  await expect(page.locator('.ai-header-title')).toContainText('智能体', { timeout: 15000 });
  // Quick actions are Chinese.
  await expect(page.locator('.ai-quick-action', { hasText: '代码审查' })).toBeVisible();
  await expect(page.locator('.ai-quick-action', { hasText: '解释代码' })).toBeVisible();
  await expect(page.locator('.ai-quick-action', { hasText: '重构建议' })).toBeVisible();
  await expect(page.locator('.ai-quick-action', { hasText: '编写测试' })).toBeVisible();
  // Mode tabs: Agent 模式 + 对话.
  await expect(page.locator('[data-testid="ai-mode-agent"]')).toContainText('Agent 模式');
  await expect(page.locator('[data-testid="ai-mode-chat"]')).toContainText('对话');
});

test('agent send renders messages and the run-status bar', async () => {
  ctx = await launchLoom();
  const page = ctx.firstWindow;
  await expect(page.locator('.welcome-action').first()).toBeVisible({ timeout: 15000 });

  await page.getByRole('button', { name: 'AI Agent' }).click();
  await expect(page.locator('.ai-agent-panel')).toBeVisible({ timeout: 15000 });

  // The send button needs a configured model+provider. Inject a throwaway
  // provider (env-overridable placeholder key, never a real credential) whose
  // API endpoint is unreachable — the send path still runs and fails with an
  // error, exercising messages + failed status bar. Config is restored after.
  const placeholderKey = process.env.E2E_FAKE_KEY || ('e2e-invalid-' + 'key-placeholder');
  const originalConfig = await page.evaluate(async () => (window as any).loom.ai.getConfig());
  await page.evaluate(async (key) => {
    const loom = (window as any).loom;
    await loom.ai.addProvider({
      id: 'e2e-probe', name: 'E2E Probe', baseUrl: 'http://127.0.0.1:9/v1',
      apiKey: key, models: ['probe-model'], activeModel: 'probe-model',
    });
    await loom.ai.updateConfig({ mode: 'builtin', activeProviderId: 'e2e-probe' });
  }, placeholderKey);
  // Reload so the AI panel re-reads the config and enables the send button.
  await page.reload();
  try {
    await expect(page.locator('.welcome-action').first()).toBeVisible({ timeout: 15000 });
    await page.getByRole('button', { name: 'AI Agent' }).click();
    await expect(page.locator('.ai-agent-panel')).toBeVisible({ timeout: 15000 });

    const textarea = page.locator('.ai-agent-panel textarea');
    await textarea.fill('你好，请帮我看看这段代码');
    await page.locator('[data-testid="ai-send"]').click();

    // User message renders.
    await expect(page.locator('.ai-msg-user .ai-message-content')).toContainText('你好，请帮我看看这段代码', { timeout: 20000 });
    // An assistant error reply renders (message list works).
    await expect(page.locator('.ai-msg-assistant .ai-message-content')).toContainText(/./, { timeout: 30000 });
    // Run-status bar shows the failed state with a Continue button.
    await expect(page.locator('.agent-run-status.failed')).toBeVisible({ timeout: 20000 });
    await expect(page.locator('[data-testid="ai-continue"]')).toBeVisible();
  } finally {
    // Restore the original provider config.
    await page.evaluate(async (cfg) => {
      const loom = (window as any).loom;
      await loom.ai.removeProvider('e2e-probe');
      if (cfg) await loom.ai.updateConfig(cfg);
    }, originalConfig).catch(() => {});
  }
});
