/**
 * Batch 2 — real admin + real API.
 *
 * Covers:
 *   1. Overview feedback/security counts scoped to the current UTC day.
 *   2. Quality queue filter (全部 / 待办 / 系统信号) + 系统信号 KPI.
 *   3. 回答正确 → row shows 无问题 (NO_ISSUE).
 *   4. One-at-a-time review: after A, B is next (no skip).
 *
 * The batch2 seed runs in beforeAll so the spec is idempotent:
 *   qa/seed/batch2.ts creates qa_b2_* rows (C/A/B + signals + yesterday rows).
 */
import { execSync } from 'node:child_process';
import * as path from 'node:path';
import { test, expect, waitForRole, tokenForRole, QA_ENV } from './fixtures';

const API_BASE = (
  process.env.QA_API_URL ??
  QA_ENV.QA_API_URL ??
  'http://127.0.0.1:4102/api'
).replace(/\/$/, '');
const REPO_ROOT = path.resolve(__dirname, '../../..');
const TODAY = new Date().toISOString().slice(0, 10);

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

async function kpiValue(
  page: import('@playwright/test').Page,
  label: string,
): Promise<number> {
  const link = page.getByRole('link', {
    name: `${label}，查看对应反馈`,
  });
  await expect(link).toBeVisible({ timeout: 120_000 });
  // Wait for the summary request to populate the numeric value (not 加载中…/—).
  await expect(link).toContainText(/[0-9]/, { timeout: 120_000 });
  const text = await link.innerText();
  const match = text.match(/(\d+)/);
  expect(match).not.toBeNull();
  return Number(match![1]);
}

function reviewPanel(page: import('@playwright/test').Page) {
  return page
    .getByText('这条怎么处理？', { exact: true })
    .locator('xpath=ancestor::section[1]');
}

async function assertPendingDrill(
  page: import('@playwright/test').Page,
  request: import('@playwright/test').APIRequestContext,
  role: 'VIEWER' | 'ADMIN',
): Promise<void> {
  const todaySummary = await apiGet(
    request,
    `/v1/admin/ai-feedback/summary?from=${TODAY}&to=${TODAY}`,
  );
  await page.goto('/ai-ops/');
  await expect(page.getByRole('heading', { name: '今日运营' })).toBeVisible({
    timeout: 180_000,
  });
  await waitForRole(page, role);

  const card = page.getByTestId('anomaly-pending-feedback');
  await expect(card).toContainText(String(todaySummary.pending), {
    timeout: 120_000,
  });
  await card.click();

  const urlPattern = new RegExp(
    `/ai-ops/quality/\\?queue=TODO&from=${TODAY}&to=${TODAY}`,
  );
  await expect(page).toHaveURL(urlPattern);
  await expect(page.getByLabel('反馈队列筛选')).toHaveValue('TODO');
  await expect(page.getByLabel('反馈开始日期')).toHaveValue(TODAY);
  await expect(page.getByLabel('反馈结束日期')).toHaveValue(TODAY);
  await expect(page.getByText(`共 ${todaySummary.pending} 条`)).toBeVisible({
    timeout: 120_000,
  });

  // Refresh keeps the queue and the UTC date window.
  await page.reload();
  await expect(page).toHaveURL(urlPattern);
  await expect(page.getByText(`共 ${todaySummary.pending} 条`)).toBeVisible({
    timeout: 120_000,
  });
}

test.beforeAll(() => {
  execSync('npx tsx qa/seed/batch2.ts', {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      DATABASE_URL: QA_ENV.DATABASE_URL,
    },
    stdio: 'pipe',
    timeout: 120_000,
  });
});

test.describe('Batch 2 — VIEWER pending drill-down', () => {
  test.use({ role: 'VIEWER' });

  test('home 「待处理」 opens queue=TODO for today and keeps it on refresh', async ({
    page,
    request,
  }) => {
    await assertPendingDrill(page, request, 'VIEWER');
  });
});

test.describe.serial('Batch 2 — triage and today windows', () => {
  test.use({ role: 'ADMIN' });

  test('home 「待处理」 opens queue=TODO for today (ADMIN)', async ({
    page,
    request,
  }) => {
    await assertPendingDrill(page, request, 'ADMIN');
  });

  test('overview feedback/security cards use today UTC, not all-time', async ({
    page,
    request,
  }) => {
    const todayFb = await apiGet(
      request,
      `/v1/admin/ai-feedback/summary?from=${TODAY}&to=${TODAY}`,
    );
    const allFb = await apiGet(request, '/v1/admin/ai-feedback/summary');
    const todaySec = await apiGet(
      request,
      `/v1/admin/ai-security/summary?from=${TODAY}&to=${TODAY}`,
    );
    const allSec = await apiGet(request, '/v1/admin/ai-security/summary');

    const todayService =
      todayFb.byFailureKind.find((x: any) => x.failureKind === 'SERVICE_ERROR')
        ?.count ?? 0;
    const allService =
      allFb.byFailureKind.find((x: any) => x.failureKind === 'SERVICE_ERROR')
        ?.count ?? 0;
    const todayNew =
      todaySec.byStatus.find((x: any) => x.status === 'NEW')?.count ?? 0;
    const allNew =
      allSec.byStatus.find((x: any) => x.status === 'NEW')?.count ?? 0;

    // The seed puts actionable/security rows on both sides of the UTC boundary.
    expect(todayFb.pending).toBeLessThan(allFb.pending);
    expect(todayService).toBeLessThan(allService);
    expect(todaySec.total).toBeLessThan(allSec.total);
    expect(todayNew).toBeLessThan(allNew);

    await page.goto('/ai-ops/');
    await expect(page.getByRole('heading', { name: '今日运营' })).toBeVisible({
      timeout: 180_000,
    });
    await waitForRole(page, 'ADMIN');

    await expect(page.getByTestId('anomaly-pending-feedback')).toContainText(
      String(todayFb.pending),
      { timeout: 120_000 },
    );
    await expect(page.getByTestId('anomaly-service-error')).toContainText(
      String(todayService),
      { timeout: 120_000 },
    );
    await expect(page.getByTestId('anomaly-security')).toContainText(
      `${todayNew} / ${todaySec.total}`,
      { timeout: 120_000 },
    );
  });

  test('quality queue filter 全部/待办/系统信号 + 系统信号 KPI', async ({
    page,
    request,
  }) => {
    const summary = await apiGet(request, '/v1/admin/ai-feedback/summary');

    await page.goto('/ai-ops/quality');
    await expect(page.getByRole('heading', { name: 'AI 质量' })).toBeVisible({
      timeout: 180_000,
    });
    await waitForRole(page, 'ADMIN');

    // The two queue KPIs must match the API summary.
    expect(await kpiValue(page, '待处理')).toBe(summary.pending);
    expect(await kpiValue(page, '系统信号')).toBe(summary.signals);
    await expect(
      page.getByRole('link', { name: '待处理，查看对应反馈' }),
    ).toHaveAttribute('href', '/ai-ops/quality/?queue=TODO');
    await expect(
      page.getByRole('link', { name: '系统信号，查看对应反馈' }),
    ).toHaveAttribute('href', '/ai-ops/quality/?queue=SIGNAL');

    // 待办 queue.
    await page.getByRole('link', { name: '待处理，查看对应反馈' }).click();
    await expect(page).toHaveURL(/\/ai-ops\/quality\/\?queue=TODO/);
    await expect(page.getByLabel('反馈队列筛选')).toHaveValue('TODO');
    await expect(page.getByText(`共 ${summary.pending} 条`)).toBeVisible({
      timeout: 120_000,
    });

    // 系统信号 queue.
    await page.goto('/ai-ops/quality');
    await page.getByRole('link', { name: '系统信号，查看对应反馈' }).click();
    await expect(page).toHaveURL(/\/ai-ops\/quality\/\?queue=SIGNAL/);
    await expect(page.getByLabel('反馈队列筛选')).toHaveValue('SIGNAL');
    await expect(page.getByText(`共 ${summary.signals} 条`)).toBeVisible({
      timeout: 120_000,
    });

    // 全部队列 removes the queue param and shows every feedback row.
    await page.getByLabel('反馈队列筛选').selectOption('');
    await expect(page).toHaveURL(/\/ai-ops\/quality\/?$/);
    await expect(page.getByText(`共 ${summary.total} 条`)).toBeVisible({
      timeout: 120_000,
    });

    // queue=SIGNAL + signal combination.
    const repeated = await apiGet(
      request,
      '/v1/admin/ai-feedback?queue=SIGNAL&signal=repeated_question&pageSize=100',
    );
    await page.goto('/ai-ops/quality?queue=SIGNAL&signal=repeated_question');
    await expect(page.getByLabel('反馈队列筛选')).toHaveValue('SIGNAL');
    await expect(page.getByLabel('来源信号筛选')).toHaveValue(
      'repeated_question',
    );
    await expect(page.getByText(`共 ${repeated.total} 条`)).toBeVisible({
      timeout: 120_000,
    });
  });

  test('quality date inputs + queue=TODO exclude yesterday rows', async ({
    page,
    request,
  }) => {
    const todaySummary = await apiGet(
      request,
      `/v1/admin/ai-feedback/summary?from=${TODAY}&to=${TODAY}`,
    );
    const allSummary = await apiGet(request, '/v1/admin/ai-feedback/summary');
    expect(todaySummary.pending).toBeLessThan(allSummary.pending);

    const todayList = await apiGet(
      request,
      `/v1/admin/ai-feedback?queue=TODO&from=${TODAY}&to=${TODAY}&pageSize=100`,
    );
    const allList = await apiGet(
      request,
      '/v1/admin/ai-feedback?queue=TODO&pageSize=100',
    );
    expect(todayList.list.some((x: any) => x.id === 'qa_b2_fb_yesterday')).toBe(
      false,
    );
    expect(allList.list.some((x: any) => x.id === 'qa_b2_fb_yesterday')).toBe(
      true,
    );

    await page.goto('/ai-ops/quality');
    await expect(page.getByRole('heading', { name: 'AI 质量' })).toBeVisible({
      timeout: 180_000,
    });
    await waitForRole(page, 'ADMIN');

    await page.getByLabel('反馈开始日期').fill(TODAY);
    await expect(page).toHaveURL(new RegExp(`from=${TODAY}`));
    await page.getByLabel('反馈结束日期').fill(TODAY);
    await expect(page).toHaveURL(new RegExp(`to=${TODAY}`));
    await page.getByLabel('反馈队列筛选').selectOption('TODO');
    await expect(page).toHaveURL(/queue=TODO/);

    await expect(page).toHaveURL(new RegExp(`from=${TODAY}`));
    await expect(page).toHaveURL(new RegExp(`to=${TODAY}`));
    await expect(page.getByLabel('反馈开始日期')).toHaveValue(TODAY);
    await expect(page.getByLabel('反馈结束日期')).toHaveValue(TODAY);

    // Summary is requested with the same range → KPI = today actionable.
    await expect
      .poll(async () => kpiValue(page, '待处理'), { timeout: 120_000 })
      .toBe(todaySummary.pending);
    await expect(page.getByText(`共 ${todaySummary.pending} 条`)).toBeVisible({
      timeout: 120_000,
    });

    // KPI links keep the date window.
    await expect(
      page.getByRole('link', { name: '待处理，查看对应反馈' }),
    ).toHaveAttribute(
      'href',
      `/ai-ops/quality/?queue=TODO&from=${TODAY}&to=${TODAY}`,
    );
  });

  test('resolution=NO_ISSUE filter is accepted and applied', async ({
    page,
    request,
  }) => {
    const noIssue = await apiGet(
      request,
      '/v1/admin/ai-feedback?resolution=NO_ISSUE&pageSize=100',
    );
    expect(noIssue.total).toBeGreaterThanOrEqual(1);

    await page.goto('/ai-ops/quality');
    await expect(page.getByRole('heading', { name: 'AI 质量' })).toBeVisible({
      timeout: 180_000,
    });
    await waitForRole(page, 'ADMIN');

    await page.getByLabel('处理状态筛选').selectOption('NO_ISSUE');
    await expect(page).toHaveURL(/resolution=NO_ISSUE/);
    await expect(page.getByLabel('处理状态筛选')).toHaveValue('NO_ISSUE');
    await expect(page.getByText(`共 ${noIssue.total} 条`)).toBeVisible({
      timeout: 120_000,
    });
    const rows = page.locator('tbody tr');
    await expect(rows).toHaveCount(noIssue.total);
    // Column 5 is 处理状态.
    await expect(rows.first().locator('td').nth(5)).toHaveText('无问题');
  });

  test('回答正确 marks the row 无问题 and advances to the next item', async ({
    page,
    request,
  }) => {
    await page.goto('/ai-ops/quality');
    await expect(page.getByRole('heading', { name: 'AI 质量' })).toBeVisible({
      timeout: 180_000,
    });
    await waitForRole(page, 'ADMIN');

    page.on('dialog', (dialog) => void dialog.accept('qa correct note'));
    await page.getByRole('button', { name: '开始质检' }).click();

    const panel = reviewPanel(page);
    await expect(
      panel.getByText('qa_b2_C_question', { exact: true }),
    ).toBeVisible({ timeout: 120_000 });
    await panel.getByRole('button', { name: '回答正确' }).click();

    // Table row C must show 无问题 (column 5 = 处理状态).
    const row = page.locator('tbody tr', { hasText: 'qa_b2_C_question' });
    await expect(row.locator('td').nth(5)).toHaveText('无问题', {
      timeout: 120_000,
    });

    // The review panel advances to A (the next PENDING item).
    await expect(
      panel.getByText('qa_b2_A_question', { exact: true }),
    ).toBeVisible({ timeout: 120_000 });

    const list = await apiGet(
      request,
      '/v1/admin/ai-feedback?page=1&pageSize=100',
    );
    const c = list.list.find((x: any) => x.id === 'qa_b2_fb_c');
    expect(c).toBeDefined();
    expect(c.verdict).toBe('correct');
    expect(c.failureKind).toBeNull();
    expect(c.resolution).toBe('NO_ISSUE');
    expect(c.reviewStatus).toBe('REVIEWED');
  });

  test('one-at-a-time review: after A, B is shown (no skip)', async ({
    page,
    request,
  }) => {
    await page.goto('/ai-ops/quality');
    await expect(page.getByRole('heading', { name: 'AI 质量' })).toBeVisible({
      timeout: 180_000,
    });
    await waitForRole(page, 'ADMIN');

    page.on('dialog', (dialog) => void dialog.accept('qa exclude note'));
    await page.getByRole('button', { name: '开始质检' }).click();

    const panel = reviewPanel(page);
    await expect(
      panel.getByText('qa_b2_A_question', { exact: true }),
    ).toBeVisible({ timeout: 120_000 });
    await panel.getByRole('button', { name: '排除' }).click();

    // B must be the next item; A must be gone from the panel (not skipped).
    await expect(
      panel.getByText('qa_b2_B_question', { exact: true }),
    ).toBeVisible({ timeout: 120_000 });
    await expect(
      panel.getByText('qa_b2_A_question', { exact: true }),
    ).toHaveCount(0);

    const list = await apiGet(
      request,
      '/v1/admin/ai-feedback?page=1&pageSize=100',
    );
    const a = list.list.find((x: any) => x.id === 'qa_b2_fb_a');
    const b = list.list.find((x: any) => x.id === 'qa_b2_fb_b');
    expect(a.reviewStatus).toBe('IGNORED');
    expect(a.resolution).toBe('EXCLUDED');
    expect(b.reviewStatus).toBe('PENDING');
    expect(b.resolution).toBe('OPEN');
  });
});
