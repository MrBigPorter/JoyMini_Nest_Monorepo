/**
 * Batch 2 — Insights signal links.
 *
 * After 2347f3a5:
 *   - Transfer rate opens `?signal=transferred` (NO queue) so the list
 *     population matches the Insights KPI count (all implicit transferred,
 *     including SERVICE_ERROR / EXCLUDED).
 *   - Repeated / Abandoned still open the SIGNAL queue, whose total matches
 *     their KPI counts (2 / 2 in the batch2 seed).
 */
import { test, expect, waitForRole, tokenForRole } from './fixtures';

const API_BASE = process.env.QA_API_URL ?? 'http://127.0.0.1:4102/api';

async function apiGet(
  request: import('@playwright/test').APIRequestContext,
  endpoint: string,
): Promise<any> {
  const res = await request.get(`${API_BASE}${endpoint}`, {
    headers: { Authorization: `Bearer ${tokenForRole('ADMIN')}` },
  });
  expect(res.ok()).toBeTruthy();
  return (await res.json()).data;
}

async function signalListTotal(
  request: import('@playwright/test').APIRequestContext,
  signal: string,
  queue?: 'SIGNAL',
): Promise<number> {
  const params = new URLSearchParams({ signal, pageSize: '100' });
  if (queue) params.set('queue', queue);
  const res = await request.get(
    `${API_BASE}/v1/admin/ai-feedback?${params.toString()}`,
    {
      headers: { Authorization: `Bearer ${tokenForRole('ADMIN')}` },
    },
  );
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  return body.data.total as number;
}

test.describe('Insights signal links', () => {
  test.use({ role: 'ADMIN' });

  test('links match their KPI population and filter the quality list', async ({
    page,
    request,
  }) => {
    const cases: Array<{
      name: RegExp;
      href: string;
      signal: string;
      queue?: 'SIGNAL';
      useInsightsKpi?: boolean;
    }> = [
      {
        name: /^转人工率/,
        href: '/ai-ops/quality/?signal=transferred',
        signal: 'transferred',
        useInsightsKpi: true,
      },
      {
        name: /^重复追问/,
        href: '/ai-ops/quality/?queue=SIGNAL&signal=repeated_question',
        signal: 'repeated_question',
        queue: 'SIGNAL',
      },
      {
        name: /^用户放弃/,
        href: '/ai-ops/quality/?queue=SIGNAL&signal=abandoned',
        signal: 'abandoned',
        queue: 'SIGNAL',
      },
    ];

    // First pass: every link renders with the expected params.
    await page.goto('/ai-ops/insights/');
    await expect(page.getByRole('heading', { name: '运营洞察' })).toBeVisible({
      timeout: 180_000,
    });
    await waitForRole(page, 'ADMIN');
    for (const item of cases) {
      const link = page.getByRole('link', { name: item.name });
      await expect(link).toBeVisible({ timeout: 120_000 });
      await expect(link).toHaveAttribute('href', item.href);
    }

    // The Insights KPI count is the population the Transfer link must match.
    const overview = await apiGet(request, '/v1/admin/ai-insights/overview');

    // Second pass: click each link, assert filters and the list total.
    for (const item of cases) {
      const expectedTotal = item.useInsightsKpi
        ? overview.feedback.transferred
        : await signalListTotal(request, item.signal, item.queue);

      await page.goto('/ai-ops/insights/');
      await expect(page.getByRole('heading', { name: '运营洞察' })).toBeVisible(
        { timeout: 120_000 },
      );
      await page.getByRole('link', { name: item.name }).click();

      const urlPattern = item.queue
        ? `/ai-ops/quality/\\?queue=SIGNAL&signal=${item.signal}`
        : `/ai-ops/quality/\\?signal=${item.signal}`;
      await expect(page).toHaveURL(new RegExp(urlPattern));
      await expect(page.getByLabel('反馈队列筛选')).toHaveValue(
        item.queue ?? '',
      );
      await expect(page.getByLabel('来源信号筛选')).toHaveValue(item.signal);
      await expect(page.getByText(`共 ${expectedTotal} 条`)).toBeVisible({
        timeout: 120_000,
      });

      if (item.signal === 'repeated_question' && expectedTotal > 0) {
        await expect(page.locator('tbody tr')).toHaveCount(expectedTotal);
        await expect(
          page.locator('tbody tr').first().locator('td').nth(2),
        ).toHaveText('重复追问');
      }
    }
  });
});
