/**
 * Batch 1 — role-aware navigation, real admin + real API.
 */
import { test, expect, waitForRole } from './fixtures';

test.describe('VIEWER navigation', () => {
  test.use({ role: 'VIEWER' });

  test('sidebar hides the whole "AI Operations · 工程" group', async ({
    page,
  }) => {
    await page.goto('/ai-ops/');
    await expect(
      page.getByRole('heading', { name: '今日运营' }),
    ).toBeVisible({ timeout: 180_000 });
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

    for (const href of [
      '/ai-ops/runtime',
      '/ai-ops/flows',
      '/ai-ops/usage',
      '/ai-ops/memory',
      '/ai-ops/security',
      '/ai-ops/context',
      '/ai-ops/traces',
    ]) {
      await expect(sidebar.locator(`a[href^="${href}"]`)).toHaveCount(0);
    }
  });
});

test.describe('ADMIN navigation', () => {
  test.use({ role: 'ADMIN' });

  test('sidebar shows the engineering group and its links', async ({
    page,
  }) => {
    await page.goto('/ai-ops/');
    await expect(
      page.getByRole('heading', { name: '今日运营' }),
    ).toBeVisible({ timeout: 180_000 });
    await waitForRole(page, 'ADMIN');

    const sidebar = page.locator('aside');
    await expect(
      sidebar.getByText('AI Operations · 工程', { exact: true }),
    ).toBeVisible();
    for (const href of [
      '/ai-ops/runtime',
      '/ai-ops/traces',
      '/ai-ops/security',
      '/ai-ops/context',
    ]) {
      await expect(sidebar.locator(`a[href^="${href}"]`)).toHaveCount(1);
    }
  });
});
