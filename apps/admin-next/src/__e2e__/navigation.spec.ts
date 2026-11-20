/**
 * E2E — 侧边栏 & 导航测试  (uses shared auth state)
 */
import { test, expect, waitForDashboard } from './fixtures';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await waitForDashboard(page);
});

test.describe('Sidebar — 侧边栏导航', () => {
  test('侧边栏显示 Overview、Users、Catalog、Commerce 分组', async ({
    page,
  }) => {
    const sidebar = page.locator('aside').first();
    await expect(sidebar.getByText('Overview')).toBeVisible({
      timeout: 15_000,
    });
    await expect(sidebar.getByText('Users').first()).toBeVisible();
    await expect(sidebar.getByText('Catalog').first()).toBeVisible();
    await expect(sidebar.getByText('Commerce').first()).toBeVisible();
  });

  test('侧边栏显示 Marketing、Customer Service、Analytics、System 分组', async ({
    page,
  }) => {
    const sidebar = page.locator('aside').first();
    await expect(sidebar.getByText('Marketing')).toBeVisible({
      timeout: 15_000,
    });
    await expect(sidebar.getByText('Customer Service')).toBeVisible();
    await expect(sidebar.getByText('AI Operations')).toBeVisible();
    await expect(sidebar.getByText('Analytics')).toBeVisible();
    await expect(sidebar.getByText('System')).toBeVisible();
  });

  // 验证关键路由可以打开（不崩溃）
  const routes = [
    { name: 'Orders', path: '/orders/' },
    { name: 'Users', path: '/users/' },
    { name: 'Products', path: '/products/' },
    { name: 'Marketing', path: '/marketing/' },
    { name: 'Finance', path: '/finance/' },
    { name: 'Categories', path: '/categories/' },
    { name: 'Banners', path: '/banners/' },
    // Phase 5
    { name: 'Ads', path: '/ads/' },
    { name: 'Flash Sale', path: '/flash-sale/' },
    { name: 'Settings', path: '/settings/' },
    { name: 'Customer Service', path: '/customer-service/' },
    { name: 'Login Logs', path: '/login-logs/' },
    { name: 'Analytics', path: '/analytics/' },
    { name: 'Notifications', path: '/notifications/' },
    { name: 'Roles', path: '/roles/' },
    { name: 'Operation Logs', path: '/operation-logs/' },
    { name: 'AI Operations', path: '/ai-ops/' },
    { name: 'AI Runtime', path: '/ai-ops/runtime/' },
    { name: 'AI Flows', path: '/ai-ops/flows/' },
    { name: 'AI Usage', path: '/ai-ops/usage/' },
    { name: 'AI Memory', path: '/ai-ops/memory/' },
  ];

  for (const route of routes) {
    test(`导航到 ${route.name} 不崩溃`, async ({ page }) => {
      await page.goto(route.path);
      await waitForDashboard(page, 45_000).catch(() => {});
      await expect(page.locator('body')).not.toContainText(
        'Application error',
        {
          timeout: 10_000,
        },
      );
    });
  }
});
