/**
 * E2E — 写操作三条路径（openspec admin-frontend-closure 6.1）
 *
 * 三个页面 ×（成功 / 服务端错误 / 断网）：
 *   - 用户管理：冻结/解冻（乐观更新，失败回滚）
 *   - 订单列表：状态变更（乐观更新，失败回滚）
 *   - 财务审核：提现审核（保守策略，失败列表不变、弹窗不关）
 *
 * 所有接口用 page.route 拦截，不写本地数据库。
 */
import { test, expect, type Page } from '@playwright/test';

const ok = (data: unknown) => ({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify({ code: 10000, message: 'success', data }),
});

const USER = {
  id: 'u-e2e',
  nickname: 'E2E User',
  phone: '+639170000000',
  status: 1,
  kycStatus: 4,
  avatar: null,
  realBalance: '100.00',
  coinBalance: '0',
  createdAt: Date.now(),
};

const ORDER = {
  orderId: 'o-e2e',
  orderNo: 'ORD-E2E',
  originalAmount: 100,
  finalAmount: 90,
  couponAmount: 10,
  coinAmount: 0,
  buyQuantity: 1,
  unitPrice: 90,
  orderStatus: 8, // SHIPPED → 详情里可 Mark Completed
  paidAt: Date.now(),
  createdAt: Date.now(),
  user: {
    id: 'u-e2e',
    nickname: 'E2E User',
    phone: '+639170000000',
    avatar: null,
  },
  treasure: {
    treasureId: 't-e2e',
    treasureName: 'E2E Item',
    treasureCoverImg: '',
  },
};

async function mockList(
  page: Page,
  urlPattern: string | RegExp,
  data: unknown[],
) {
  await page.route(urlPattern, async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    await route.fulfill(ok({ list: data, total: data.length }));
  });
}

async function openUsersPage(page: Page) {
  await mockList(page, /\/admin\/client-user\/list/, [USER]);
  await page.goto('/users/');
  await expect(page.locator('tbody tr').first()).toBeVisible({
    timeout: 30_000,
  });
}

async function freeze(page: Page) {
  const row = page.locator('tbody tr').first();
  await row.getByRole('button').nth(1).click();
  await page.getByPlaceholder(/reason/i).fill('e2e freeze reason');
  await page.getByRole('button', { name: /confirm freeze/i }).click();
}

test.describe('用户管理 — 冻结写操作', () => {
  test('成功：乐观更新为 FROZEN 并提示成功', async ({ page }) => {
    await openUsersPage(page);
    await page.route(/\/admin\/client-user\/[^/]+\/status/, (route) =>
      route.fulfill(ok({})),
    );

    await freeze(page);

    await expect(page.getByText(/user frozen successfully/i)).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText(/frozen/i).first()).toBeVisible();
  });

  test('服务端错误：回滚并提示失败', async ({ page }) => {
    await openUsersPage(page);
    await page.route(/\/admin\/client-user\/[^/]+\/status/, (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ code: 50000, message: 'boom', data: null }),
      }),
    );

    await freeze(page);

    await expect(page.getByText(/operation failed/i)).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText(/^FROZEN$/)).toHaveCount(0);
  });

  test('断网：回滚并提示失败', async ({ page }) => {
    await openUsersPage(page);
    await page.route(/\/admin\/client-user\/[^/]+\/status/, (route) =>
      route.abort('failed'),
    );

    await freeze(page);

    await expect(page.getByText(/operation failed/i)).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText(/^FROZEN$/)).toHaveCount(0);
  });
});

test.describe('订单列表 — 状态变更', () => {
  async function openOrderDetail(page: Page) {
    await mockList(page, /\/admin\/order\/list/, [ORDER]);
    await page.goto('/orders/?orderStatus=-1');
    const row = page.locator('tbody tr').first();
    await expect(row).toBeVisible({ timeout: 30_000 });
    await row.getByRole('button').first().click(); // Eye → 详情
    await expect(page.getByText(/ORD-E2E/).first()).toBeVisible();
  }

  test('成功：状态更新并提示', async ({ page }) => {
    await openOrderDetail(page);
    let patched = false;
    await page.route(/\/admin\/order\/[^/]+\/status/, (route) => {
      patched = true;
      return route.fulfill(ok({}));
    });

    await page.getByRole('button', { name: /mark completed/i }).click();

    await expect(page.getByText(/order status updated/i)).toBeVisible({
      timeout: 15_000,
    });
    expect(patched).toBe(true);
  });

  test('服务端错误：回滚并提示失败', async ({ page }) => {
    await openOrderDetail(page);
    await page.route(/\/admin\/order\/[^/]+\/status/, (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ code: 50000, message: 'boom', data: null }),
      }),
    );

    await page.getByRole('button', { name: /mark completed/i }).click();

    await expect(page.getByText(/failed to update status/i)).toBeVisible({
      timeout: 15_000,
    });
  });

  test('断网：回滚并提示失败', async ({ page }) => {
    await openOrderDetail(page);
    await page.route(/\/admin\/order\/[^/]+\/status/, (route) =>
      route.abort('failed'),
    );

    await page.getByRole('button', { name: /mark completed/i }).click();

    await expect(page.getByText(/failed to update status/i)).toBeVisible({
      timeout: 15_000,
    });
  });
});

test.describe('财务审核 — 提现审核（保守策略）', () => {
  async function openAuditModal(page: Page) {
    // 用本地 seed 的待审核提现（WD-E2E-001），列表走真实接口；
    // 只拦截审核提交，避免写库。
    await page.goto('/finance/?tab=withdrawals');
    const auditBtn = page.getByRole('button', { name: /^audit$/i }).first();
    await expect(auditBtn).toBeVisible({ timeout: 60_000 });
    await auditBtn.click();
    await expect(page.getByText(/WD-E2E-001/).first()).toBeVisible({
      timeout: 15_000,
    });
    await page.locator('textarea').first().fill('e2e reject reason');
  }

  test('成功：弹窗关闭且列表刷新', async ({ page }) => {
    await openAuditModal(page);
    let calls = 0;
    await page.route(/\/admin\/finance\/withdrawals\/audit/, (route) => {
      calls += 1;
      return route.fulfill(ok({ success: true }));
    });

    await page.getByRole('button', { name: /^reject$/i }).click();

    await expect.poll(() => calls).toBe(1);
    await expect(page.getByRole('button', { name: /^reject$/i })).toHaveCount(
      0,
      { timeout: 15_000 },
    );
  });

  test('服务端错误：明确提示且弹窗不关', async ({ page }) => {
    await openAuditModal(page);
    await page.route(/\/admin\/finance\/withdrawals\/audit/, (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ code: 50000, message: 'boom', data: null }),
      }),
    );

    await page.getByRole('button', { name: /^reject$/i }).click();

    await expect(page.getByText(/failed to submit audit/i)).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole('button', { name: /^reject$/i })).toBeVisible();
  });

  test('断网：明确提示且弹窗不关', async ({ page }) => {
    await openAuditModal(page);
    await page.route(/\/admin\/finance\/withdrawals\/audit/, (route) =>
      route.abort('failed'),
    );

    await page.getByRole('button', { name: /^reject$/i }).click();

    await expect(page.getByText(/failed to submit audit/i)).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole('button', { name: /^reject$/i })).toBeVisible();
  });
});
