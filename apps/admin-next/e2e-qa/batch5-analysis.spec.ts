/**
 * Batch 5 — problem analysis page (real admin + real API).
 *
 * Prerequisite: qa/seed/batch5.ts + batch5-analysis.e2e-spec.ts have produced
 * the 2026-11-18 window (8 events / 7 metrics) and a FAILED 2026-11-17 run.
 *
 * beforeAll restarts the API to clear the leaked advisory lock (D-B5-01) so the
 * page's "运行分析" button can be exercised.
 */
import { execSync } from 'node:child_process';
import * as path from 'node:path';
import { test, expect, waitForRole, QA_ENV } from './fixtures';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const DATE = QA_ENV.QA_BATCH5_DATE ?? '2026-11-18';
const FAIL_DATE = '2026-11-17';

function restartApi(): void {
  execSync('bash qa/scripts/restart-api.sh', {
    cwd: REPO_ROOT,
    stdio: 'pipe',
    timeout: 180_000,
  });
}

test.beforeAll(() => restartApi());
test.afterAll(() => restartApi());

test.describe('Batch 5 — admin analysis page', () => {
  test.use({ role: 'ADMIN' });

  test('renders runs, metrics and events; runs the window', async ({
    page,
  }) => {
    await page.goto('/ai-ops/analysis');
    await expect(page.getByRole('heading', { name: '问题分析' })).toBeVisible({
      timeout: 180_000,
    });
    await waitForRole(page, 'ADMIN');

    // Sidebar entry exists for ADMIN.
    await expect(page.locator('aside a[href^="/ai-ops/analysis"]')).toHaveCount(
      1,
    );

    // Switch to the seeded UTC day.
    await page.getByLabel('分析日期').fill(DATE);

    const metricsSection = page
      .getByRole('heading', { name: '指标' })
      .locator('xpath=ancestor::section[1]');
    const problemRow = metricsSection
      .locator('tr', { hasText: '问题率' })
      .filter({ hasText: '全部' });
    await expect(problemRow).toBeVisible({ timeout: 120_000 });
    await expect(problemRow).toContainText('200.0%');
    await expect(problemRow).toContainText('8 / 4');

    const serviceRow = metricsSection.locator('tr', {
      hasText: '服务故障率',
    });
    await expect(serviceRow).toContainText('50.0%');
    await expect(serviceRow).toContainText('2 / 4');

    const zeroRow = metricsSection.locator('tr', { hasText: '零命中率' });
    await expect(zeroRow).toContainText('33.3%');
    await expect(zeroRow).toContainText('1 / 3');

    const repeatRow = metricsSection.locator('tr', {
      hasText: '重复追问率',
    });
    await expect(repeatRow).toContainText('50.0%');
    await expect(repeatRow).toContainText('1 / 2');

    await expect(
      metricsSection.locator('tr', { hasText: 'INTENT:order' }),
    ).toContainText('1 / 2');
    await expect(
      metricsSection.locator('tr', { hasText: 'INTENT:rag' }),
    ).toContainText('1 / 2');

    // Events table.
    await expect(
      page.getByRole('heading', { name: '问题事件（8）' }),
    ).toBeVisible({ timeout: 120_000 });
    const eventsSection = page
      .getByRole('heading', { name: '问题事件（8）' })
      .locator('xpath=ancestor::section[1]');
    for (const label of [
      '显式负反馈',
      '服务故障',
      '检索零命中',
      '重复追问',
      '用户放弃',
      '评测未解决',
      '安全命中',
    ]) {
      await expect(
        eventsSection.getByText(label, { exact: true }).first(),
      ).toBeVisible();
    }

    // Runs table: COMPLETED main window + FAILED run with the simulated error.
    const runsSection = page
      .getByRole('heading', { name: '分析任务' })
      .locator('xpath=ancestor::section[1]');
    const mainRun = runsSection.locator('tbody tr', { hasText: DATE });
    await expect(mainRun).toBeVisible({ timeout: 120_000 });
    await expect(mainRun).toContainText('已完成');
    await expect(mainRun).toContainText('8');

    const failedRun = runsSection.locator('tbody tr', {
      hasText: FAIL_DATE,
    });
    await expect(failedRun).toContainText('失败');
    await expect(failedRun).toContainText('qa simulated analysis failure');

    // Run the window from the page (API restarted → lock clear).
    await page.getByRole('button', { name: '运行分析' }).click();
    await expect(page.getByText(/分析完成：8 条事件/)).toBeVisible({
      timeout: 120_000,
    });
    await expect(
      page.getByRole('heading', { name: '问题事件（8）' }),
    ).toBeVisible({ timeout: 120_000 });
  });
});

test.describe('Batch 5 — viewer navigation', () => {
  test.use({ role: 'VIEWER' });

  test('VIEWER sidebar has no analysis link', async ({ page }) => {
    await page.goto('/ai-ops');
    await expect(page.getByRole('heading', { name: '今日运营' })).toBeVisible({
      timeout: 180_000,
    });
    await waitForRole(page, 'VIEWER');

    const sidebar = page.locator('aside');
    await expect(sidebar.locator('a[href^="/ai-ops/analysis"]')).toHaveCount(0);
    // The engineering group itself is hidden (Batch 1 regression).
    await expect(
      sidebar.getByText('AI Operations · 工程', { exact: true }),
    ).toHaveCount(0);
  });
});
