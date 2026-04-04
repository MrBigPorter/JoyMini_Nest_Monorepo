/**
 * E2E — Dashboard 页面测试  (uses shared auth state, no re-login)
 */
import { test, expect } from '@playwright/test';
import { waitForDashboard } from './fixtures';

test.describe('Dashboard — 首页', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForDashboard(page);
  });

  test('页面标题包含 Lucky Admin', async ({ page }) => {
    await expect(page).toHaveTitle(/Lucky Admin/i, { timeout: 15_000 });
  });

  test('显示 4 个统计卡片', async ({ page }) => {
    await expect(page.getByText('Total Deposits')).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText('Total Withdrawals')).toBeVisible();
    await expect(page.getByText('Pending Withdrawals')).toBeVisible();
    await expect(page.getByText('Total Users')).toBeVisible();
  });

  test('Recent Orders 区块存在', async ({ page }) => {
    await expect(page.getByText('Recent Orders')).toBeVisible({
      timeout: 15_000,
    });
  });

  test('侧边栏有 Orders 链接', async ({ page }) => {
    const link = page.getByRole('link', { name: /orders/i });
    await expect(link.first()).toBeVisible();
  });

  test('点击 Orders 侧边栏链接后 URL 变为 /orders', async ({ page }) => {
    const link = page.getByRole('link', { name: /^Orders/i }).first();
    await expect(link).toBeVisible({ timeout: 10_000 });
    await link.click();
    await page.waitForURL(/\/orders/, { timeout: 15_000 });
    expect(page.url()).toContain('/orders');
  });

  test('Refresh 按钮可点击', async ({ page }) => {
    // Dashboard has a plain <button> with "Refresh" text (not role=button accessible name)
    const refreshBtn = page
      .getByRole('button', { name: /refresh/i })
      .or(page.locator('button').filter({ hasText: /refresh/i }))
      .first();
    await expect(refreshBtn).toBeVisible({ timeout: 15_000 });
    await refreshBtn.click();
    await expect(page.locator('body')).not.toContainText('Application error');
  });
});
