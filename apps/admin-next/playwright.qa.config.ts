import { defineConfig, devices } from '@playwright/test';
import * as path from 'node:path';

/**
 * Batch 1 QA Playwright config — real backend, no API mocks.
 *
 * - Admin dev server: http://127.0.0.1:4101
 * - Real QA API:      http://127.0.0.1:4102/api
 * - Auth: a signed admin JWT is injected as the `auth_token` cookie (for the
 *   Next middleware) and into localStorage (for the axios client).
 *
 * Run:
 *   QA_ADMIN_URL=http://127.0.0.1:4101 \
 *   QA_API_URL=http://127.0.0.1:4102/api \
 *   yarn workspace @lucky/admin-next playwright test \
 *     --config=playwright.qa.config.ts
 *
 * Artifacts stay under qa/reports so product source is untouched.
 */
const ADMIN_URL = process.env.QA_ADMIN_URL ?? 'http://127.0.0.1:4101';
const API_URL = process.env.QA_API_URL ?? 'http://127.0.0.1:4102/api';
const repoRoot = path.resolve(__dirname, '../..');

export default defineConfig({
  testDir: './e2e-qa',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  timeout: 240_000,
  expect: { timeout: 30_000 },
  outputDir: path.join(repoRoot, 'qa/reports/playwright-results'),
  reporter: [
    ['list'],
    ['html', { outputFolder: path.join(repoRoot, 'qa/reports/playwright-report'), open: 'never' }],
  ],
  use: {
    baseURL: ADMIN_URL,
    ignoreHTTPSErrors: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 30_000,
    navigationTimeout: 180_000,
  },
  projects: [
    {
      name: 'qa-chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: process.env.QA_NO_WEB_SERVER
    ? undefined
    : {
        // Reuse the already-running QA admin server when present.
        command: `../../node_modules/.bin/next dev --port 4101 --hostname 127.0.0.1`,
        cwd: __dirname,
        url: `${ADMIN_URL}/login`,
        reuseExistingServer: true,
        timeout: 600_000,
        env: {
          NEXT_TELEMETRY_DISABLED: '1',
          NEXT_PUBLIC_API_BASE_URL: API_URL,
          INTERNAL_API_URL: API_URL,
          API_BASE_URL: API_URL,
        },
      },
});
