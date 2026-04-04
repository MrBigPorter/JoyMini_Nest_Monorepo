/**
 * E2E — Marketing / Coupons (/marketing)
 *
 * 覆盖: 页面加载  优惠券表格  搜索  Create 按钮
 */
import { test, expect } from '@playwright/test';
import { expectNoError, dismissDevOverlay, waitForDashboard } from './fixtures';

const PATH = '/marketing/';

test.describe('Marketing — Coupon List (/marketing)', () => {
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

  test('显示优惠券相关标题', async ({ page }) => {
    await expect(page.getByText(/coupon/i).first()).toBeVisible({
      timeout: 20_000,
    });
  });

  test('优惠券表格渲染', async ({ page }) => {
    await expect(page.locator('table').first()).toBeVisible({
      timeout: 20_000,
    });
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

  test('Create Coupon 按钮存在', async ({ page }) => {
    const btn = page
      .getByRole('button', { name: /create/i })
      .or(page.getByRole('button', { name: /add/i }))
      .first();
    await expect(btn).toBeVisible({ timeout: 15_000 });
  });

  test('点击 Create Coupon 弹出弹窗', async ({ page }) => {
    const btn = page
      .getByRole('button', { name: /create/i })
      .or(page.getByRole('button', { name: /add/i }))
      .first();
    await expect(btn).toBeVisible({ timeout: 15_000 });
    await btn.click({ force: true });
    await expect(
      page.locator('[role="dialog"]').or(page.locator('[data-state="open"]')),
    ).toBeVisible({ timeout: 8_000 });
    await expectNoError(page);
  });
});
