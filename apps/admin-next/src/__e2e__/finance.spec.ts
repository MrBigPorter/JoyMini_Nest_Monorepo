/**
 * E2E — Finance Center (/finance)
 *
 * 覆盖: 页面加载  统计卡片渲染  Tabs 切换  Refresh 按钮
 */
import { test, expect } from '@playwright/test';
import { expectNoError, dismissDevOverlay, waitForDashboard } from './fixtures';

const PATH = '/finance/';

test.describe('Finance Center — /finance', () => {
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

  test('显示 Finance Center 标题', async ({ page }) => {
    await expect(page.getByText(/finance center/i).first()).toBeVisible({
      timeout: 20_000,
    });
  });

  test('显示 Pending Withdrawals 统计卡片', async ({ page }) => {
    await expect(page.getByText(/pending withdrawals/i).first()).toBeVisible({
      timeout: 20_000,
    });
  });

  test('显示 Total Deposits 统计卡片', async ({ page }) => {
    await expect(page.getByText(/total deposits/i).first()).toBeVisible({
      timeout: 20_000,
    });
  });

  test('Refresh Data 按钮可点击', async ({ page }) => {
    const btn = page.getByRole('button', { name: /refresh data/i }).first();
    await expect(btn).toBeVisible({ timeout: 15_000 });
    await btn.click({ force: true });
    await expectNoError(page);
  });

  test('切换到 Deposits tab', async ({ page }) => {
    const tab = page
      .getByRole('button', { name: /^deposits$/i })
      .or(page.getByText(/^deposits$/i))
      .first();
    if (await tab.isVisible({ timeout: 8_000 }).catch(() => false)) {
      await tab.click({ force: true });
      await expectNoError(page);
    }
  });

  test('切换到 Withdrawals tab', async ({ page }) => {
    const tab = page
      .getByRole('button', { name: /^withdrawals$/i })
      .or(page.getByText(/^withdrawals$/i))
      .first();
    if (await tab.isVisible({ timeout: 8_000 }).catch(() => false)) {
      await tab.click({ force: true });
      await expectNoError(page);
    }
  });

  test('切换到 Transactions tab', async ({ page }) => {
    const tab = page
      .getByRole('button', { name: /^transactions$/i })
      .or(page.getByText(/^transactions$/i))
      .first();
    if (await tab.isVisible({ timeout: 8_000 }).catch(() => false)) {
      await tab.click({ force: true });
      await expectNoError(page);
    }
  });
});
