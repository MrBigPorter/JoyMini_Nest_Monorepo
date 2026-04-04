/**
 * E2E 辅助工具
 *
 * 提供带完整 cookie + localStorage 的认证 Page fixture
 */
import { Page, BrowserContext } from '@playwright/test';

/** 测试用管理员账号，通过环境变量注入（本地 .env.test 或 CI secret） */
export const TEST_ADMIN = {
  username: process.env.E2E_ADMIN_USERNAME || 'admin',
  password: process.env.E2E_ADMIN_PASSWORD || 'admin888',
};

export const BASE_URL =
  process.env.PLAYWRIGHT_BASE_URL || 'https://admin-dev.joyminis.com';

/**
 * 通过 UI 登录并返回已认证的 page
 * 登录成功后保存 storageState，后续测试可直接跳过登录步骤
 */
export async function loginViaUI(page: Page): Promise<void> {
  await page.goto('/login/');
  // Dismiss Next.js dev overlay if present
  await page
    .evaluate(() => {
      const el = document.querySelector('nextjs-portal');
      if (el) el.remove();
    })
    .catch(() => {});
  await page.getByLabel('Username').fill(TEST_ADMIN.username);
  await page.getByLabel('Password').fill(TEST_ADMIN.password);
  await page.getByRole('button', { name: /sign in/i }).click({ force: true });
  // Wait for navigation away from /login.
  // Turbopack compiles dashboard lazily on first request — can take 60-600 s on cold start.
  // Use 'commit' so we only wait for the URL to change, not for the full page load.
  await page.waitForURL((url) => !url.pathname.includes('/login'), {
    timeout: 600_000,
    waitUntil: 'commit',
  });
}

/**
 * 直接往 localStorage 注入 token（跳过登录 UI，加速测试）
 * 适合已有有效 token 的场景（如 E2E_STATIC_TOKEN 环境变量）
 */
export async function injectToken(
  context: BrowserContext,
  token: string,
): Promise<void> {
  await context.addInitScript((t) => {
    localStorage.setItem('auth_token', t);
  }, token);
}
