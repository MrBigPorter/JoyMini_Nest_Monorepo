import { describe, it, expect } from 'vitest';
import { getVisibleRoutes, routes } from '@/routes';

describe('routes 配置', () => {
  it('每条路由都有 path、name、icon、group', () => {
    routes.forEach((r) => {
      expect(r.path, `${r.name} 缺少 path`).toBeTruthy();
      expect(r.name, `${r.path} 缺少 name`).toBeTruthy();
      expect(r.icon, `${r.path} 缺少 icon`).toBeDefined();
      expect(r.group, `${r.path} 缺少 group`).toBeTruthy();
    });
  });

  it('路由 path 不能重复', () => {
    const paths = routes.map((r) => r.path);
    const unique = new Set(paths);
    expect(unique.size).toBe(paths.length);
  });

  it('Dashboard 路由 path 为 /', () => {
    const dashboard = routes.find((r) => r.name === 'dashboard');
    expect(dashboard?.path).toBe('/');
  });

  it('marketing 路由不被隐藏 (优惠券已上线)', () => {
    const marketing = routes.find((r) => r.name === 'marketing');
    expect(marketing?.hidden).toBeFalsy();
  });

  it('orders 路由不被隐藏', () => {
    const orders = routes.find((r) => r.name === 'orders');
    expect(orders?.hidden).toBeFalsy();
  });

  it('analytics 路由已上线，不被隐藏', () => {
    const analytics = routes.find((r) => r.name === 'analytics');
    expect(analytics?.hidden).toBeFalsy();
  });

  it('VIEWER 和 EDITOR 看不到工程组，ADMIN 可以看到', () => {
    const viewerRoutes = getVisibleRoutes('viewer');
    const editorRoutes = getVisibleRoutes('EDITOR');
    const adminRoutes = getVisibleRoutes('ADMIN');

    expect(viewerRoutes.some((r) => r.group === 'AI Operations · 工程')).toBe(
      false,
    );
    expect(editorRoutes.some((r) => r.group === 'AI Operations · 工程')).toBe(
      false,
    );
    expect(adminRoutes.some((r) => r.group === 'AI Operations · 工程')).toBe(
      true,
    );
    // EDITOR 不是运营角色：整个 AI Operations 隐藏，避免业务页 403。
    expect(editorRoutes.some((r) => r.path.startsWith('/ai-ops'))).toBe(false);
  });

  it('角色未加载时隐藏工程组，避免先闪后消失', () => {
    const visible = getVisibleRoutes(undefined);

    expect(visible.some((r) => r.group === 'AI Operations · 工程')).toBe(false);
    expect(visible.some((r) => r.path === '/ai-ops')).toBe(false);
    expect(visible.some((r) => r.path === '/')).toBe(true);
  });

  it('工程路由都标记了 VIEWER / EDITOR 隐藏', () => {
    const engineering = routes.filter(
      (r) => r.group === 'AI Operations · 工程',
    );

    expect(engineering).toHaveLength(8);
    engineering.forEach((route) => {
      expect(route.hiddenForRoles).toContain('VIEWER');
      expect(route.hiddenForRoles).toContain('EDITOR');
    });
  });

  it('所有 group 值合法', () => {
    const validGroups = [
      'Overview',
      'Users',
      'Catalog',
      'Commerce',
      'Marketing',
      'Customer Service',
      'AI Operations · 今日',
      'AI Operations · 业务',
      'AI Operations · 工程',
      'Analytics',
      'System',
    ];
    routes.forEach((r) => {
      expect(validGroups, `${r.path} group 非法`).toContain(r.group);
    });
  });
});
