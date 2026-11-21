/**
 * 119 Phase 2–5 page QA (frozen 50e7aaaf).
 *
 * Real admin + real API. qa/seed/phase2-5-ui.ts seeds one cluster, one NEW
 * alert and an eval dataset. Verifies the /ai-ops/analysis page actions:
 * claim, status/fix-type, create regression (two prompts), ack alert, and that
 * VIEWER/EDITOR have no navigation entry.
 */
import { execFileSync } from 'node:child_process';
import * as path from 'node:path';
import { test, expect, waitForRole, QA_ENV } from './fixtures';

const repoRoot = path.resolve(__dirname, '../../..');
const seedFile = path.join(repoRoot, 'qa/seed/phase2-5-ui.ts');
const CLUSTER_ID = 'qa_p25_ui_cluster';
const REPRESENTATIVE = 'QA P25 界面问题 退款未到账?';
const DATASET_ID = 'qa_p25_ui_ds';
const EXPECTED = 'qa_p25_ui_expected_answer';
const ALERT_MESSAGE = 'qa_p25_ui_alert_message';

function seed(args: string[] = []): string {
  return execFileSync('npx', ['tsx', seedFile, ...args], {
    cwd: repoRoot,
    env: {
      ...process.env,
      DATABASE_URL:
        QA_ENV.DATABASE_URL ??
        'postgresql://lucky:lucky_qa_pw@127.0.0.1:5433/joy_mini_qa?schema=public',
    },
    encoding: 'utf8',
  }).trim();
}

test.describe('ADMIN — analysis page actions', () => {
  test.use({ role: 'ADMIN' });

  test.beforeAll(() => {
    seed();
  });

  test.afterAll(() => {
    seed(['--clean']);
  });

  test('cluster/alert tables and fix-loop actions', async ({ page }) => {
    await page.goto('/ai-ops/analysis');
    await expect(page.getByRole('heading', { name: '问题分析' })).toBeVisible({
      timeout: 180_000,
    });
    await waitForRole(page, 'ADMIN');

    // ADMIN keeps the engineering navigation entry.
    await expect(
      page.locator('aside a[href^="/ai-ops/analysis"]'),
    ).toHaveCount(1);

    const clusterRow = page
      .getByRole('row')
      .filter({ hasText: REPRESENTATIVE })
      .first();
    await expect(clusterRow).toBeVisible({ timeout: 60_000 });
    await expect(clusterRow).toContainText('100');

    // Claim -> owner is the signed-in admin.
    const claimPatch = page.waitForResponse(
      (response) =>
        response.request().method() === 'PATCH' &&
        response.url().includes(`/clusters/${CLUSTER_ID}`),
    );
    await clusterRow.getByRole('button', { name: '认领' }).click();
    expect((await claimPatch).status()).toBe(200);
    await expect(clusterRow.getByText('qa_admin_admin')).toBeVisible({
      timeout: 30_000,
    });

    // Status -> FIXING.
    const statusSelect = page.getByLabel(`问题簇状态 ${CLUSTER_ID}`);
    const statusPatch = page.waitForResponse(
      (response) =>
        response.request().method() === 'PATCH' &&
        response.url().includes(`/clusters/${CLUSTER_ID}`),
    );
    await statusSelect.selectOption('FIXING');
    expect((await statusPatch).status()).toBe(200);
    await expect(statusSelect).toHaveValue('FIXING');

    // Fix type -> PROMPT.
    const fixSelect = page.getByLabel(`修复类型 ${CLUSTER_ID}`);
    const fixPatch = page.waitForResponse(
      (response) =>
        response.request().method() === 'PATCH' &&
        response.url().includes(`/clusters/${CLUSTER_ID}`),
    );
    await fixSelect.selectOption('PROMPT');
    expect((await fixPatch).status()).toBe(200);
    await expect(fixSelect).toHaveValue('PROMPT');

    // Create regression: two prompts (dataset id, expected answer).
    const promptMessages: string[] = [];
    const answers = [DATASET_ID, EXPECTED];
    const onDialog = async (dialog: import('@playwright/test').Dialog) => {
      promptMessages.push(dialog.message());
      await dialog.accept(answers.shift() ?? '');
    };
    page.on('dialog', onDialog);
    const regressionPost = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().includes(`/clusters/${CLUSTER_ID}/regression`),
    );
    await clusterRow.getByRole('button', { name: '建回归' }).click();
    expect((await regressionPost).status()).toBe(201);
    page.off('dialog', onDialog);
    await expect(
      page.getByText('已生成回归用例，问题簇进入修复中'),
    ).toBeVisible({ timeout: 30_000 });
    expect(promptMessages).toHaveLength(2);
    expect(promptMessages[0]).toContain('目标评测集');
    expect(promptMessages[1]).toContain('期望答案');
    await expect(statusSelect).toHaveValue('FIXING');

    // Alert table: ACK removes it from the NEW list.
    const alertRow = page
      .getByRole('row')
      .filter({ hasText: ALERT_MESSAGE })
      .first();
    await expect(alertRow).toBeVisible({ timeout: 30_000 });
    const ackPatch = page.waitForResponse(
      (response) =>
        response.request().method() === 'PATCH' &&
        response.url().includes('/alerts/') &&
        response.url().endsWith('/ack'),
    );
    await alertRow.getByRole('button', { name: '确认' }).click();
    expect((await ackPatch).status()).toBe(200);
    await expect(alertRow).toHaveCount(0, { timeout: 30_000 });
  });
});

test.describe('VIEWER — no analysis entry', () => {
  test.use({ role: 'VIEWER' });

  test('sidebar has no analysis link', async ({ page }) => {
    await page.goto('/ai-ops/');
    await expect(page.getByRole('heading', { name: '今日运营' })).toBeVisible({
      timeout: 180_000,
    });
    await waitForRole(page, 'VIEWER');
    await expect(
      page.locator('aside a[href^="/ai-ops/analysis"]'),
    ).toHaveCount(0);
  });
});

test.describe('EDITOR — no analysis entry', () => {
  test.use({ role: 'EDITOR' });

  test('sidebar has no analysis link', async ({ page }) => {
    await page.goto('/ai-ops/');
    await expect(page.getByRole('heading', { name: '今日运营' })).toBeVisible({
      timeout: 180_000,
    });
    await waitForRole(page, 'EDITOR');
    await expect(
      page.locator('aside a[href^="/ai-ops/analysis"]'),
    ).toHaveCount(0);
  });
});
