/**
 * E2E — Category Management (/categories)
 *
 * 覆盖: 页面加载  分类列表渲染  Add Category 按钮  弹窗
 */
import { test, expect } from '@playwright/test';
import { expectNoError, dismissDevOverlay, waitForDashboard } from './fixtures';

const PATH = '/categories/';

test.describe('Category Management — /categories', () => {
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

  test('显示 Categories 相关标题或内容', async ({ page }) => {
    await expect(page.getByText(/categor/i).first()).toBeVisible({
      timeout: 20_000,
    });
  });

  test('Add Category 按钮存在', async ({ page }) => {
    const btn = page
      .getByRole('button', { name: /add category/i })
      .or(page.getByRole('button', { name: /create/i }))
      .or(page.getByRole('button', { name: /new category/i }))
      .first();
    await expect(btn).toBeVisible({ timeout: 15_000 });
  });

  test('点击 Add Category 弹出创建弹窗', async ({ page }) => {
    const btn = page
      .getByRole('button', { name: /add category/i })
      .or(page.getByRole('button', { name: /create/i }))
      .first();
    await expect(btn).toBeVisible({ timeout: 15_000 });
    await btn.click({ force: true });
    await expect(
      page.locator('[role="dialog"]').or(page.locator('[data-state="open"]')),
    ).toBeVisible({ timeout: 8_000 });
    await expectNoError(page);
  });
});
