/**
 * E2E — 认证流程测试
 *
 * 覆盖:
 * 1. 未登录访问 / → 自动跳转 /login/
 * 2. 登录表单渲染
 * 3. 错误密码 → 显示错误提示
 * 4. 正确登录 → 跳转 Dashboard
 * 5. 登录后访问 /login/ → 自动跳转 /
 */
import { test, expect } from '@playwright/test';
import { loginViaUI } from './helpers';
import { dismissDevOverlay, waitForDashboard } from './fixtures';

test.describe('Auth — 认证流程', () => {
  test('未登录访问 / 时自动跳转到 /login/', async ({ page }) => {
    await page.context().clearCookies();
    await page.evaluate(() => localStorage.clear()).catch(() => {});
    await page.goto('/');
    await page.waitForURL(/\/login/, { timeout: 10_000 });
    expect(page.url()).toContain('/login');
  });

  test('登录页面渲染正确的表单元素', async ({ page }) => {
    await page.context().clearCookies();
    await page.evaluate(() => localStorage.clear()).catch(() => {});
    await page.goto('/login/');
    await page.waitForURL(/\/login/, { timeout: 10_000 });
    await expect(page.getByLabel('Username')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByLabel('Password')).toBeVisible();
    await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible();
  });

  test('输入错误密码时显示错误提示', async ({ page }) => {
    await page.context().clearCookies();
    await page.evaluate(() => localStorage.clear()).catch(() => {});
    await page.goto('/login/');
    await page.waitForURL(/\/login/, { timeout: 10_000 });
    await page.getByLabel('Username').fill('admin');
    await page.getByLabel('Password').fill('wrong-password-xyz');
    await dismissDevOverlay(page);
    await page.getByRole('button', { name: /sign in/i }).click({ force: true });
    const errorLocator = page.locator(
      '[class*="border-l-red"], [class*="text-red"], [role="alert"]',
    );
    await expect(errorLocator.first()).toBeVisible({ timeout: 10_000 });
  });

  test('正确登录后跳转到 Dashboard', async ({ page }) => {
    // Must clear stored credentials first — the chromium project starts with storageState
    // which causes /login/ to redirect immediately, preventing loginViaUI from filling the form.
    await page.context().clearCookies();
    await page.evaluate(() => localStorage.clear()).catch(() => {});
    await loginViaUI(page);
    // After login the page navigates to /; wait for DashboardLayout to render
    await waitForDashboard(page, 60_000);
    await expect(
      page
        .locator('h1')
        .filter({ hasText: /dashboard/i })
        .first(),
    ).toBeVisible({
      timeout: 10_000,
    });
  });

  test('已登录时访问 /login/ 自动跳转到 /', async ({ page }) => {
    // Login from scratch (clear first), then verify /login/ redirects back
    await page.context().clearCookies();
    await page.evaluate(() => localStorage.clear()).catch(() => {});
    await loginViaUI(page);
    await waitForDashboard(page, 60_000);
    // Now that we are authenticated, visiting /login/ should redirect back to /
    await page.goto('/login/');
    await page.waitForURL((url) => !url.pathname.includes('/login'), {
      timeout: 30_000,
    });
    expect(page.url()).not.toContain('login');
  });
});
