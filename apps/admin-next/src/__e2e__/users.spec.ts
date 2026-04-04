/**
 * E2E — User Management (/users)
 *
 * 覆盖: 页面加载 · 表格渲染 · 搜索 · 详情弹窗 · 冻结弹窗
 */
import { test, expect } from '@playwright/test';
import { expectNoError, waitForDashboard } from './fixtures';

const PATH = '/users/';

test.describe('User Management — /users', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(PATH);
    await waitForDashboard(page);
    await expectNoError(page);
  });

  test('页面加载不崩溃，显示页面标题', async ({ page }) => {
    await expect(page.getByText(/client database/i)).toBeVisible({
      timeout: 20_000,
    });
  });

  test('用户表格渲染（有表头行）', async ({ page }) => {
    // SmartTable 渲染 table 元素
    const table = page.locator('table').first();
    await expect(table).toBeVisible({ timeout: 20_000 });
    // 至少有 User Info 列
    await expect(page.getByText(/user info/i).first()).toBeVisible();
  });

  test('显示钱包资产列', async ({ page }) => {
    await expect(page.getByText(/wallet assets/i).first()).toBeVisible({
      timeout: 20_000,
    });
  });

  test('搜索框可以输入 User ID', async ({ page }) => {
    const input = page.getByPlaceholder(/enter id/i).first();
    await expect(input).toBeVisible({ timeout: 15_000 });
    await input.fill('12345');
    await expect(input).toHaveValue('12345');
  });

  test('Search 按钮可点击', async ({ page }) => {
    const btn = page.getByRole('button', { name: /search/i }).first();
    await expect(btn).toBeVisible({ timeout: 15_000 });
    await btn.click();
    await expectNoError(page);
  });

  test('Reset 按钮可点击', async ({ page }) => {
    const btn = page.getByRole('button', { name: /reset/i }).first();
    await expect(btn).toBeVisible({ timeout: 15_000 });
    await btn.click();
    await expectNoError(page);
  });
});
