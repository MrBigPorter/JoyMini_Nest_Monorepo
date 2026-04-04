/**
 * E2E Fixtures — 全局夹具
 *
 * 核心设计：
 *   1. _errorInterceptor { auto: true } — 对所有使用本 test 的用例自动生效
 *      监听三种运行时错误，测试结束后统一断言，有错则 FAIL
 *   2. gotoPage  — 封装 goto + waitForLoadState
 *   3. helpers   — dismissDevOverlay / waitForDashboard / ...
 *
 * ⚠️  所有测试文件必须从 './fixtures' 导入 { test, expect }，
 *     而不是从 '@playwright/test'，否则 auto fixture 不会运行。
 */
import { test as base, expect, Page } from '@playwright/test';

export { expect };

// ─────────────────────────────────────────────────────────────────
// 白名单：过滤项目内已知的"正常"报错，避免误报
// ─────────────────────────────────────────────────────────────────

function shouldIgnoreHttpError(url: string, status: number): boolean {
  if (url.includes('favicon.ico')) return true;
  if (url.includes('/_next/webpack-hmr')) return true;
  if (url.includes('/__nextjs')) return true;
  // 401 在登录页 auth profile check 是预期行为
  if (status === 401 && url.includes('/auth/')) return true;
  // Next.js 静态资源 404（CI cold build 可能出现）
  if (status === 404 && url.includes('/_next/static/')) return true;
  return false;
}

function shouldIgnoreConsoleError(text: string): boolean {
  if (text.includes('Download the React DevTools')) return true;
  if (text.includes('[Fast Refresh]')) return true;
  if (text.includes('Warning: Each child in a list')) return true;
  if (text.includes('chrome-extension://')) return true;
  return false;
}

// ─────────────────────────────────────────────────────────────────
// Fixture 类型
// ─────────────────────────────────────────────────────────────────
type CustomFixtures = {
  /**
   * 全局错误拦截器 — { auto: true }，无需显式调用。
   * 收集以下三类错误，测试结束后统一断言：
   *   pageerror         JS 崩溃 / Unhandled Exception
   *   console.error     控制台红字
   *   response >= 400   接口 / 静态资源报错
   */
  _errorInterceptor: void;
  /** goto + waitForLoadState('domcontentloaded') */
  gotoPage: (path: string) => Promise<void>;
};

// ─────────────────────────────────────────────────────────────────
// 扩展 test
// ─────────────────────────────────────────────────────────────────
export const test = base.extend<CustomFixtures>({
  _errorInterceptor: [
    async ({ page }, use, testInfo) => {
      const errors: string[] = [];

      // 1️⃣ JS 崩溃
      page.on('pageerror', (err) => {
        errors.push(`[pageerror] ${err.message}`);
      });

      // 2️⃣ 控制台红字
      page.on('console', (msg) => {
        if (msg.type() === 'error') {
          const text = msg.text();
          if (!shouldIgnoreConsoleError(text)) {
            errors.push(`[console.error] ${text}`);
          }
        }
      });

      // 3️⃣ HTTP >= 400
      page.on('response', (response) => {
        const status = response.status();
        if (status >= 400) {
          const url = response.url();
          if (!shouldIgnoreHttpError(url, status)) {
            errors.push(`[HTTP ${status}] ${url}`);
          }
        }
      });

      await use();

      // 测试结束后断言：有错误则 FAIL 并把详情写入报告
      if (errors.length > 0) {
        testInfo.annotations.push({
          type: '运行时错误',
          description: errors.join('\n'),
        });
        expect(
          errors,
          `捕获到 ${errors.length} 个运行时错误:\n${errors.join('\n')}`,
        ).toHaveLength(0);
      }
    },
    { auto: true, scope: 'test' },
  ],

  gotoPage: async ({ page }, applyFixture) => {
    await applyFixture(async (path: string) => {
      await page.goto(path);
      await page.waitForLoadState('domcontentloaded');
    });
  },
});

// ─────────────────────────────────────────────────────────────────
// Page-level helpers（保持向后兼容）
// ─────────────────────────────────────────────────────────────────

export async function dismissDevOverlay(page: Page) {
  await page
    .evaluate(() => {
      document
        .querySelectorAll('nextjs-portal, [data-nextjs-dev-overlay]')
        .forEach((el) => el.remove());
    })
    .catch(() => {});
}

export async function waitForDashboard(page: Page, timeout = 60_000) {
  await page.locator('aside').waitFor({ state: 'visible', timeout });
}

export async function expectNoError(page: Page) {
  await expect(page.locator('body')).not.toContainText('Application error', {
    timeout: 10_000,
  });
  await expect(page.locator('body')).not.toContainText(
    'Internal Server Error',
    { timeout: 500 },
  );
}

export async function waitForContent(page: Page, timeout = 20_000) {
  await page
    .locator('table tr, [data-testid], h1, h2, h3')
    .first()
    .waitFor({ state: 'visible', timeout });
}

export async function gotoAndWait(page: Page, path: string) {
  await page.goto(path);
  await waitForDashboard(page);
  await expectNoError(page);
  return page;
}

export async function forceClick(
  page: Page,
  locator: ReturnType<Page['getByRole']>,
) {
  await dismissDevOverlay(page);
  await locator.click({ force: true });
}
