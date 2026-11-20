import { describe, it, expect } from 'vitest';
import { routes } from '@/routes';

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

  it('所有 group 值合法', () => {
    const validGroups = [
      'Overview',
      'Users',
      'Catalog',
      'Commerce',
      'Marketing',
      'Customer Service',
      'AI Operations',
      'Analytics',
      'System',
    ];
    routes.forEach((r) => {
      expect(validGroups, `${r.path} group 非法`).toContain(r.group);
    });
  });
});
