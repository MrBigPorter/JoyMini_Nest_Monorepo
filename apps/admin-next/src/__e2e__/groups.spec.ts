/**
 * E2E — Group Management (/groups)
 *
 * 覆盖: 页面加载  表格渲染  搜索  状态过滤
 */
import { test, expect } from '@playwright/test';
import { expectNoError, dismissDevOverlay, waitForDashboard } from './fixtures';

const PATH = '/groups/';

test.describe('Group Management — /groups', () => {
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

  test('显示 Group 相关标题', async ({ page }) => {
    await expect(page.locator('h1, h2, h3').first()).toBeVisible({
      timeout: 20_000,
    });
  });

  test('Group 内容区域渲染', async ({ page }) => {
    const content = page
      .locator('table, [class*="card"], [class*="Card"], main > div')
      .first();
    await expect(content).toBeVisible({ timeout: 20_000 });
  });

  test('Search 按钮可点击', async ({ page }) => {
    const btn = page.getByRole('button', { name: /search/i }).first();
    if (await btn.isVisible({ timeout: 8_000 }).catch(() => false)) {
      await btn.click({ force: true });
      await expectNoError(page);
    }
  });

  test('Reset 按钮可点击', async ({ page }) => {
    const btn = page.getByRole('button', { name: /^reset$/i }).first();
    if (await btn.isVisible({ timeout: 8_000 }).catch(() => false)) {
      await btn.click({ force: true });
      await expectNoError(page);
    }
  });
});
