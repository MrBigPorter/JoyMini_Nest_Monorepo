/**
 * E2E — 首页 / 登录页全局报错拦截示例
 *
 * 这个文件有两个目的：
 *   1. 演示 fixtures.ts 里 _errorInterceptor 的实际效果
 *   2. 作为"冒烟测试"，确保页面能正常加载、无 JS 崩溃、无控制台报错、无 4xx/5xx
 *
 * 如何证明拦截器生效：
 *   如果登录页有任何 pageerror / console.error / HTTP >= 400（非白名单），
 *   这里的测试会 FAIL 并在报告里显示具体的错误信息。
 *
 * 运行方式：
 *   yarn workspace @lucky/admin-next e2e --project=public
 */
import { test, expect } from './fixtures';

test.describe('首页冒烟测试 — 全局报错拦截验证', () => {
  /**
   * 未登录访问 / → 应该跳转到 /login/
   * 验证：重定向正常、登录页无报错
   */
  test('未登录访问 / 自动跳转登录页，且页面无任何报错', async ({ page }) => {
    // 清空认证状态，模拟未登录
    await page.context().clearCookies();
    await page.evaluate(() => localStorage.clear()).catch(() => {});

    // 访问根路径
    await page.goto('/');

    // 等待跳转到 /login/
    await page.waitForURL(/\/login/, { timeout: 15_000 });
    expect(page.url()).toContain('/login');

    // 确认登录页核心元素渲染正常
    await expect(page.getByLabel('Username')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByLabel('Password')).toBeVisible();
    await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible();

    //  如果上面执行完成且没有 FAIL，说明：
    //    - 页面没有 JS 崩溃（no pageerror）
    //    - 没有控制台红字（no console.error）
    //    - 没有非预期的 HTTP 4xx/5xx（_errorInterceptor 自动收集并在此时断言）
  });

  /**
   * 直接访问登录页
   * 验证：静态资源加载正常、表单可交互、无报错
   */
  test('直接访问 /login/ 页面加载成功且无报错', async ({ page }) => {
    await page.context().clearCookies();
    await page.evaluate(() => localStorage.clear()).catch(() => {});

    await page.goto('/login/');
    await page.waitForLoadState('networkidle', { timeout: 30_000 });

    // 表单元素可见
    await expect(page.getByLabel('Username')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByLabel('Password')).toBeVisible();

    // 页面标题存在（不检查具体文字，避免 i18n 问题）
    await expect(page.locator('h1, h2').first()).toBeVisible();

    //  _errorInterceptor 在 use() 后自动断言，无需手动调用
  });

  /**
   * 登录页交互：输入内容不触发报错
   * 验证：表单交互过程中没有意外的 JS 错误
   */
  test('登录表单交互过程中无 JS 报错', async ({ page }) => {
    await page.context().clearCookies();
    await page.evaluate(() => localStorage.clear()).catch(() => {});

    await page.goto('/login/');
    await page.waitForURL(/\/login/, { timeout: 10_000 });

    // 聚焦并输入用户名
    await page.getByLabel('Username').click();
    await page.getByLabel('Username').fill('test-user');

    // 聚焦并输入密码
    await page.getByLabel('Password').click();
    await page.getByLabel('Password').fill('test-password');

    // 确认输入值正确（不提交，避免 API 调用）
    await expect(page.getByLabel('Username')).toHaveValue('test-user');
    await expect(page.getByLabel('Password')).toHaveValue('test-password');

    //  整个交互过程中如有任何 pageerror 或 console.error，自动 FAIL
  });
});
