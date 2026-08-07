import { defineConfig } from '@playwright/test';

/**
 * Playwright config for Loom IDE E2E smoke tests.
 *
 * Point Electron at the locally-built main entry (dist/main/index.js) so
 * tests exercise the same bundle that ships to users. Override via env vars
 * for CI or packaged-app runs:
 *   E2E_ELECTRON_DIST  — path to the Electron distribution (default: node_modules/electron/dist)
 *   E2E_MAIN_ENTRY     — compiled main entry (default: dist/main/index.js)
 */
export default defineConfig({
  testDir: '.',
  testMatch: /.*\.spec\.ts$/,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  use: {
    trace: 'retain-on-failure',
  },
});
