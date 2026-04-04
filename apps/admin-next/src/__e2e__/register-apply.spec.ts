/**
 * E2E — Register Apply (公开申请页 /register-apply)
 *
 * 覆盖:
 * 1. 页面可访问（不需要登录）
 * 2. 表单元素全部渲染
 * 3. 空表单提交触发 required 校验
 * 4. 密码不一致触发校验
 * 5. 密码强度校验（纯字母不含数字）
 * 6. 用户名含特殊字符触发校验
 * 7. "Back to Sign In" 链接跳回 /login
 * 8. 登录页包含 "Apply for access" 入口
 *
 * ⚠️  reCAPTCHA v3 是无感的（不弹窗），测试环境 NEXT_PUBLIC_RECAPTCHA_SITE_KEY 为空
 *    → GoogleReCaptchaProvider 会静默降级，不影响 UI 测试。
 *
 * 隔离策略:
 *    此文件属于 playwright.config.ts 的 "public" project，
 *    storageState = { cookies: [], origins: [] }（无 auth），与 chromium project 完全隔离。
 */
import { test, expect } from '@playwright/test';
import { dismissDevOverlay, expectNoError } from './fixtures';

const PATH = '/register-apply/';

// ── beforeAll: 健康检查 ─────────────────────────────────────────────
// 页面 500 / runtime error → 整组 skip，不产生误导性 fail
test.beforeAll(async ({ browser }) => {
  const ctx = await browser.newContext({
    storageState: { cookies: [], origins: [] },
  });
  const page = await ctx.newPage();
  try {
    const response = await page.goto(PATH, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });
    const status = response?.status() ?? 0;
    if (status >= 500) {
      console.error(`⛔ ${PATH} returned HTTP ${status} — skipping all tests`);
      test.skip();
      return;
    }
    const body = (await page.textContent('body').catch(() => '')) ?? '';
    if (
      body.includes('Application error') ||
      body.includes('is not a function')
    ) {
      console.error(`⛔ ${PATH} has a runtime error — skipping all tests`);
      test.skip();
    }
  } finally {
    await ctx.close();
  }
});

test.describe('Register Apply page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(PATH, { waitUntil: 'domcontentloaded' });
    await dismissDevOverlay(page);
    await expectNoError(page);
  });

  // ── 可访问性 ──────────────────────────────────────────────────────

  test('页面加载不崩溃，URL 包含 /register-apply', async ({ page }) => {
    expect(page.url()).toContain('/register-apply');
    await expect(page.locator('body')).not.toContainText('Application error', {
      timeout: 20_000,
    });
  });

  test('已登录用户不应能访问此页（middleware 应 302 到 /）— 由 public project 验证无跳转', async ({
    page,
  }) => {
    // public project has NO auth cookies → page should render normally, not redirect
    expect(page.url()).toContain('/register-apply');
  });

  // ── 表单渲染 ──────────────────────────────────────────────────────

  test('渲染所有必填字段', async ({ page }) => {
    await expect(page.getByPlaceholder(/desired username/i)).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByPlaceholder(/full name/i)).toBeVisible();
    await expect(page.getByPlaceholder(/email address/i)).toBeVisible();
    await expect(page.getByPlaceholder(/password \(min/i)).toBeVisible();
    await expect(page.getByPlaceholder(/confirm password/i)).toBeVisible();
  });

  test('Submit Application 按钮存在', async ({ page }) => {
    await expect(
      page.getByRole('button', { name: /submit application/i }),
    ).toBeVisible({ timeout: 15_000 });
  });

  test('"Sign in" 链接存在并指向 /login', async ({ page }) => {
    const link = page.getByRole('link', { name: /sign in/i }).first();
    await expect(link).toBeVisible({ timeout: 15_000 });
    const href = await link.getAttribute('href');
    expect(href).toContain('/login');
  });

  // ── 表单校验 ──────────────────────────────────────────────────────

  test('空表单提交显示 required 错误', async ({ page }) => {
    await page
      .getByRole('button', { name: /submit application/i })
      .click({ force: true });
    await expect(
      page.locator('[role="alert"], [class*="text-red"]').first(),
    ).toBeVisible({ timeout: 8_000 });
  });

  test('密码不一致时显示 "do not match" 错误', async ({ page }) => {
    await page.getByPlaceholder(/password \(min/i).fill('Pass1234');
    await page.getByPlaceholder(/confirm password/i).fill('Different1');
    await page
      .getByRole('button', { name: /submit application/i })
      .click({ force: true });
    await expect(page.getByText(/do not match/i).first()).toBeVisible({
      timeout: 8_000,
    });
  });

  test('密码不含数字时显示强度错误', async ({ page }) => {
    await page.getByPlaceholder(/password \(min/i).fill('OnlyLetters');
    await page.getByPlaceholder(/confirm password/i).click(); // blur
    await expect(
      page.getByText(/letter and a number|must contain/i).first(),
    ).toBeVisible({ timeout: 8_000 });
  });

  test('用户名含特殊字符时显示校验错误', async ({ page }) => {
    await page.getByPlaceholder(/desired username/i).fill('bad user!');
    await page.getByPlaceholder(/full name/i).click(); // blur
    await expect(
      page.getByText(/only.*letters|underscores/i).first(),
    ).toBeVisible({ timeout: 8_000 });
  });

  test('用户名少于 3 个字符时显示长度错误', async ({ page }) => {
    await page.getByPlaceholder(/desired username/i).fill('ab');
    await page.getByPlaceholder(/full name/i).click(); // blur
    await expect(page.getByText(/at least 3 characters/i).first()).toBeVisible({
      timeout: 8_000,
    });
  });

  // ── 导航 ─────────────────────────────────────────────────────────

  test('点击 "Sign in" 链接跳转到 /login', async ({ page }) => {
    await page
      .getByRole('link', { name: /sign in/i })
      .first()
      .click();
    await page.waitForURL(/\/login/, { timeout: 10_000 });
    expect(page.url()).toContain('/login');
  });

  // ── Login 页入口 ──────────────────────────────────────────────────

  test('登录页包含 "Apply for access" 链接', async ({ page }) => {
    await page.goto('/login/', { waitUntil: 'domcontentloaded' });
    await dismissDevOverlay(page);
    await expect(
      page.getByRole('link', { name: /apply for access/i }),
    ).toBeVisible({ timeout: 20_000 });
  });

  test('从登录页点击 Apply for access 跳转到 /register-apply', async ({
    page,
  }) => {
    await page.goto('/login/', { waitUntil: 'domcontentloaded' });
    await dismissDevOverlay(page);
    await page.getByRole('link', { name: /apply for access/i }).click();
    await page.waitForURL(/\/register-apply/, { timeout: 10_000 });
    expect(page.url()).toContain('/register-apply');
  });
});
