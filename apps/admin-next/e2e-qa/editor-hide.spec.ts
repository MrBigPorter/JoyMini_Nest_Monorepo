/**
 * EDITOR full AI Operations hide (frozen 3d4d3387 / editor hide c7322b3c).
 *
 * EDITOR is a content role: navigation must not expose any AI Operations entry,
 * while direct routes still render (route hiding only affects navigation).
 * ADMIN/VIEWER behaviour must stay unchanged.
 */
import { test, expect, waitForRole } from './fixtures';

const deskHeading = '今日运营';

test.describe('EDITOR — all AI Operations hidden', () => {
  test.use({ role: 'EDITOR' });

  test('sidebar has no AI Operations group and quick entries are empty', async ({
    page,
  }) => {
    await page.goto('/ai-ops/');
    await expect(page.getByRole('heading', { name: deskHeading })).toBeVisible({
      timeout: 180_000,
    });
    await waitForRole(page, 'EDITOR');

    const sidebar = page.locator('aside');
    for (const group of [
      'AI Operations · 今日',
      'AI Operations · 业务',
      'AI Operations · 工程',
    ]) {
      await expect(sidebar.getByText(group, { exact: true })).toHaveCount(0);
    }
    await expect(sidebar.locator('a[href^="/ai-ops"]')).toHaveCount(0);

    // Direct access still renders the page; only navigation is hidden.
    await expect(
      page.getByRole('heading', { name: deskHeading }),
    ).toBeVisible();
    const quickEntry = page
      .getByRole('heading', { name: '快速入口' })
      .locator('..');
    await expect(quickEntry.locator('a')).toHaveCount(0, { timeout: 120_000 });
  });

  test('direct business pages still render without navigation entries', async ({
    page,
  }) => {
    for (const [path, heading] of [
      ['/ai-ops/quality', 'AI 质量'],
      ['/ai-ops/support', '转人工队列'],
      ['/ai-ops/insights', '运营洞察'],
    ]) {
      await page.goto(path);
      await expect(page.getByRole('heading', { name: heading })).toBeVisible({
        timeout: 180_000,
      });
      await waitForRole(page, 'EDITOR');
      await expect(
        page.locator('aside').getByText('AI Operations · 业务', {
          exact: true,
        }),
      ).toHaveCount(0);
    }
  });
});

test.describe('ADMIN — unchanged', () => {
  test.use({ role: 'ADMIN' });

  test('sidebar and quick entries keep all AI Operations', async ({ page }) => {
    await page.goto('/ai-ops/');
    await expect(page.getByRole('heading', { name: deskHeading })).toBeVisible({
      timeout: 180_000,
    });
    await waitForRole(page, 'ADMIN');

    const sidebar = page.locator('aside');
    for (const group of [
      'AI Operations · 今日',
      'AI Operations · 业务',
      'AI Operations · 工程',
    ]) {
      await expect(sidebar.getByText(group, { exact: true })).toBeVisible();
    }
    const quickEntry = page
      .getByRole('heading', { name: '快速入口' })
      .locator('..');
    await expect(quickEntry.locator('a')).toHaveCount(8, { timeout: 120_000 });
  });
});

test.describe('VIEWER — unchanged', () => {
  test.use({ role: 'VIEWER' });

  test('sees today/business but not engineering', async ({ page }) => {
    await page.goto('/ai-ops/');
    await expect(page.getByRole('heading', { name: deskHeading })).toBeVisible({
      timeout: 180_000,
    });
    await waitForRole(page, 'VIEWER');

    const sidebar = page.locator('aside');
    await expect(
      sidebar.getByText('AI Operations · 今日', { exact: true }),
    ).toBeVisible();
    await expect(
      sidebar.getByText('AI Operations · 业务', { exact: true }),
    ).toBeVisible();
    await expect(
      sidebar.getByText('AI Operations · 工程', { exact: true }),
    ).toHaveCount(0);

    const quickEntry = page
      .getByRole('heading', { name: '快速入口' })
      .locator('..');
    await expect(quickEntry.locator('a')).toHaveCount(3, { timeout: 120_000 });
  });
});
