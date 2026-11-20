/**
 * Batch 1 — KPI drill-down, real admin + real API.
 *
 * Seed contract (qa/seed/batch1.ts):
 *   SERVICE_ERROR = 3, PENDING = 7, ADDED_TO_EVAL = 2, total feedback = 9
 */
import { test, expect, waitForRole } from './fixtures';

test.describe('Overview anomaly card drill-down', () => {
  test.use({ role: 'ADMIN' });

  test('"服务故障 3" opens the quality list with exactly 3 SERVICE_ERROR rows', async ({
    page,
    requests,
  }) => {
    await page.goto('/ai-ops/');
    await expect(
      page.getByRole('heading', { name: '今日运营' }),
    ).toBeVisible({ timeout: 180_000 });
    await waitForRole(page, 'ADMIN');

    const card = page.getByTestId('anomaly-service-error');
    await expect(card).toBeVisible();
    await expect(card).toContainText('服务故障');
    // Wait until the real summary count has loaded.
    await expect(card).toContainText('3', { timeout: 120_000 });

    await card.click();
    await expect(page).toHaveURL(
      /\/ai-ops\/quality\/\?failureKind=SERVICE_ERROR/,
    );

    await expect(page.getByText('共 3 条')).toBeVisible({ timeout: 120_000 });
    const rows = page.locator('tbody tr');
    await expect(rows).toHaveCount(3);
    for (let i = 0; i < 3; i += 1) {
      // Column 4 is 归因.
      await expect(rows.nth(i).locator('td').nth(3)).toHaveText('服务故障');
    }

    const listCall = requests.find(
      (req) =>
        req.url.pathname.endsWith('/v1/admin/ai-feedback') &&
        req.url.searchParams.get('failureKind') === 'SERVICE_ERROR',
    );
    expect(listCall).toBeDefined();
  });

  test('"待处理 7" opens the PENDING review queue', async ({ page }) => {
    await page.goto('/ai-ops/');
    await expect(
      page.getByRole('heading', { name: '今日运营' }),
    ).toBeVisible({ timeout: 180_000 });
    await waitForRole(page, 'ADMIN');

    const card = page.getByTestId('anomaly-pending-feedback');
    await expect(card).toContainText('7', { timeout: 120_000 });
    await card.click();
    await expect(page).toHaveURL(/\/ai-ops\/quality\/\?reviewStatus=PENDING/);
    await expect(page.getByText('共 7 条')).toBeVisible({ timeout: 120_000 });
  });
});

test.describe('Quality KPI cards carry exact URL params', () => {
  test.use({ role: 'ADMIN' });

  test('cards link to the right filters; reload keeps them; clear removes them', async ({
    page,
  }) => {
    await page.goto('/ai-ops/quality');
    await expect(
      page.getByRole('heading', { name: 'AI 质量' }),
    ).toBeVisible({ timeout: 180_000 });
    await waitForRole(page, 'ADMIN');

    const expected: Array<[string, string]> = [
      ['待处理', '/ai-ops/quality/?reviewStatus=PENDING'],
      ['模型答错', '/ai-ops/quality/?failureKind=MODEL_ERROR'],
      ['服务故障', '/ai-ops/quality/?failureKind=SERVICE_ERROR'],
      ['误转', '/ai-ops/quality/?failureKind=UNEXPECTED_TRANSFER'],
      ['已进回归', '/ai-ops/quality/?resolution=ADDED_TO_EVAL'],
    ];

    for (const [label, href] of expected) {
      const link = page.getByRole('link', {
        name: `${label}，查看对应反馈`,
      });
      await expect(link).toBeVisible({ timeout: 120_000 });
      await expect(link).toHaveAttribute('href', href);
    }

    // Click 服务故障 → list is filtered to the 3 SERVICE_ERROR rows.
    await page
      .getByRole('link', { name: '服务故障，查看对应反馈' })
      .click();
    await expect(page).toHaveURL(
      /\/ai-ops\/quality\/\?failureKind=SERVICE_ERROR/,
    );
    await expect(page.getByLabel('归因筛选')).toHaveValue('SERVICE_ERROR');
    await expect(page.getByText('共 3 条')).toBeVisible({ timeout: 120_000 });

    // Reload keeps the filter (URL is the single source of truth).
    await page.reload();
    await expect(page).toHaveURL(
      /\/ai-ops\/quality\/\?failureKind=SERVICE_ERROR/,
    );
    await expect(page.getByLabel('归因筛选')).toHaveValue('SERVICE_ERROR');
    await expect(page.getByText('共 3 条')).toBeVisible({ timeout: 120_000 });

    // Clear removes every filter param.
    await page.getByRole('button', { name: '清除筛选' }).click();
    await expect(page).toHaveURL(/\/ai-ops\/quality\/?(\?)?$/);
    await expect(page.getByLabel('归因筛选')).toHaveValue('');
    await expect(page.getByText('共 9 条')).toBeVisible({ timeout: 120_000 });
  });
});
