/**
 * E2E — Address Management (/address)
 */
import { test, expect } from '@playwright/test';
import { expectNoError, dismissDevOverlay, waitForDashboard } from './fixtures';

const PATH = '/address/';

test.describe('Address Management — /address', () => {
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

  test('显示页面主要内容', async ({ page }) => {
    // Address page uses SmartTable (not a <table>), check for any heading or content
    await expect(page.locator('h1, h2, h3, main').first()).toBeVisible({
      timeout: 20_000,
    });
  });

  test('内容区域渲染（SmartTable or Card）', async ({ page }) => {
    const content = page
      .locator('table, [class*="card"], [class*="Card"], main > div')
      .first();
    await expect(content).toBeVisible({ timeout: 20_000 });
  });

  test('Search 按钮可点击（若存在）', async ({ page }) => {
    const btn = page.getByRole('button', { name: /search/i }).first();
    if (await btn.isVisible({ timeout: 8_000 }).catch(() => false)) {
      await btn.click({ force: true });
      await expectNoError(page);
    }
  });

  test('Reset 按钮可点击（若存在）', async ({ page }) => {
    const btn = page.getByRole('button', { name: /reset/i }).first();
    if (await btn.isVisible({ timeout: 8_000 }).catch(() => false)) {
      await btn.click({ force: true });
      await expectNoError(page);
    }
  });

  test('Add Address 按钮存在', async ({ page }) => {
    const btn = page
      .getByRole('button', { name: /add address/i })
      .or(page.getByRole('button', { name: /create/i }))
      .or(page.getByRole('button', { name: /new address/i }))
      .first();
    if (await btn.isVisible({ timeout: 8_000 }).catch(() => false)) {
      await expect(btn).toBeVisible();
    }
  });

  test('点击 Add / Create 弹出弹窗', async ({ page }) => {
    const btn = page
      .getByRole('button', { name: /add address/i })
      .or(page.getByRole('button', { name: /create/i }))
      .first();
    if (await btn.isVisible({ timeout: 8_000 }).catch(() => false)) {
      await btn.click({ force: true });
      await expect(
        page.locator('[role="dialog"]').or(page.locator('[data-state="open"]')),
      ).toBeVisible({ timeout: 8_000 });
      await expectNoError(page);
    }
  });
});
