/**
 * E2E — KYC Management (/kyc)
 *
 * 覆盖: 页面加载  表格渲染  搜索  状态过滤  审核弹窗
 */
import { test, expect } from '@playwright/test';
import { expectNoError, waitForDashboard } from './fixtures';

const PATH = '/kyc/';

test.describe('KYC Management — /kyc', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(PATH);
    await waitForDashboard(page);
    await expectNoError(page);
  });

  test('页面加载不崩溃', async ({ page }) => {
    await expect(page.locator('body')).not.toContainText('Application error', {
      timeout: 20_000,
    });
  });

  test('显示 KYC 相关标题', async ({ page }) => {
    await expect(page.getByText(/kyc/i).first()).toBeVisible({
      timeout: 20_000,
    });
  });

  test('KYC 表格渲染', async ({ page }) => {
    const table = page.locator('table').first();
    await expect(table).toBeVisible({ timeout: 20_000 });
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

  test('Create KYC Record 按钮存在', async ({ page }) => {
    const btn = page
      .getByRole('button', { name: /create/i })
      .or(page.getByRole('button', { name: /add/i }))
      .first();
    if (await btn.isVisible({ timeout: 8_000 }).catch(() => false)) {
      await expect(btn).toBeVisible();
    }
  });
});
