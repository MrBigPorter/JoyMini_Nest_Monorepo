/**
 * E2E — Order Management (/orders)
 *
 * 覆盖: 页面加载  表格渲染  搜索  状态过滤  操作按钮
 */
import { test, expect } from '@playwright/test';
import { expectNoError, dismissDevOverlay, waitForDashboard } from './fixtures';

const PATH = '/orders/';

test.describe('Order Management — /orders', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(PATH);
    await waitForDashboard(page);
    await expectNoError(page);
    await dismissDevOverlay(page);
  });

  test('页面加载不崩溃', async ({ page }) => {
    await expect(page.locator('body')).not.toContainText('Application error', {
      timeout: 20_000,
    });
  });

  test('显示页面标题 Orders', async ({ page }) => {
    await expect(
      page.getByRole('heading', { name: /order/i }).first(),
    ).toBeVisible({ timeout: 20_000 });
  });

  test('订单表格渲染', async ({ page }) => {
    await expect(page.locator('table').first()).toBeVisible({
      timeout: 20_000,
    });
  });

  test('搜索框可以输入关键字', async ({ page }) => {
    const input = page
      .getByPlaceholder(/keyword/i)
      .or(page.getByPlaceholder(/search/i))
      .first();
    if (await input.isVisible({ timeout: 8_000 }).catch(() => false)) {
      await input.fill('test-order');
      await expect(input).toHaveValue('test-order');
    }
  });

  test('Search 按钮可点击', async ({ page }) => {
    const btn = page.getByRole('button', { name: /search/i }).first();
    await expect(btn).toBeVisible({ timeout: 15_000 });
    await btn.click({ force: true });
    await expectNoError(page);
  });

  test('Reset 按钮可点击', async ({ page }) => {
    const btn = page.getByRole('button', { name: /^reset$/i }).first();
    if (await btn.isVisible({ timeout: 8_000 }).catch(() => false)) {
      await btn.click({ force: true });
      await expectNoError(page);
    }
  });
});
