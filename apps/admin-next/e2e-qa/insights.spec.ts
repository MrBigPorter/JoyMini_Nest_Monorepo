/**
 * Batch 1 — Insights links carry signal params and the quality page filters.
 */
import { test, expect, waitForRole } from './fixtures';

test.describe('Insights signal links', () => {
  test.use({ role: 'ADMIN' });

  test('Transfer / Repeated / Abandoned links carry signal and filter the list', async ({
    page,
  }) => {
    const cases: Array<{
      name: RegExp;
      href: string;
      signal: string;
      totalText: string;
    }> = [
      {
        name: /^Transfer rate/,
        href: '/ai-ops/quality/?signal=transferred',
        signal: 'transferred',
        totalText: '共 3 条',
      },
      {
        name: /^Repeated questions/,
        href: '/ai-ops/quality/?signal=repeated_question',
        signal: 'repeated_question',
        totalText: '共 1 条',
      },
      {
        name: /^Abandoned/,
        href: '/ai-ops/quality/?signal=abandoned',
        signal: 'abandoned',
        totalText: '共 1 条',
      },
    ];

    // First pass: every link renders with the exact signal param.
    await page.goto('/ai-ops/insights/');
    await expect(
      page.getByRole('heading', { name: '运营洞察' }),
    ).toBeVisible({ timeout: 180_000 });
    await waitForRole(page, 'ADMIN');

    for (const item of cases) {
      const link = page.getByRole('link', { name: item.name });
      await expect(link).toBeVisible({ timeout: 120_000 });
      await expect(link).toHaveAttribute('href', item.href);
    }

    // Second pass: each click lands on the quality page filtered to that signal.
    for (const item of cases) {
      await page.goto('/ai-ops/insights/');
      await expect(
        page.getByRole('heading', { name: '运营洞察' }),
      ).toBeVisible({ timeout: 120_000 });
      await page.getByRole('link', { name: item.name }).click();

      await expect(page).toHaveURL(
        new RegExp(`/ai-ops/quality/\\?signal=${item.signal}`),
      );
      await expect(page.getByLabel('来源信号筛选')).toHaveValue(item.signal);
      await expect(page.getByText(item.totalText)).toBeVisible({
        timeout: 120_000,
      });

      if (item.signal === 'repeated_question') {
        // The repeated-question row is labelled with its signal.
        await expect(page.locator('tbody tr')).toHaveCount(1);
        await expect(
          page.locator('tbody tr').first().locator('td').nth(2),
        ).toHaveText('重复追问');
      }
    }
  });
});
