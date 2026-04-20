'use client';

import { useRouter, usePathname } from '@/navigation';
import type { NavigateOptions } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { useAuth } from './useAuth';

// 受保护路由列表 - 需要登录才能访问
const PROTECTED_ROUTES = ['/bookmarks'];

function isProtectedRoute(pathname: string): boolean {
  return PROTECTED_ROUTES.some((route) => pathname.startsWith(route));
}

/**
 * 受保护的路由跳转Hook
 * 三层防护体系第二层 - 客户端跳转前拦截
 *
 * 在客户端跳转前进行认证检查，防止未登录用户跳转到受保护页面
 * 作为Middleware的补充防线，解决客户端状态同步边缘情况
 */
export function useProtectedRouter() {
  const router = useRouter();
  const pathname = usePathname();
  const { isAuthenticated } = useAuth();

  /**
   * 安全的push跳转
   * 跳转前检查目标路由是否需要登录
   */
  const push = (href: string, options?: NavigateOptions) => {
    // 双重检查确保可靠性：1. store状态 2. cookie状态（fallback）
    const hasToken =
      isAuthenticated ||
      (typeof document !== 'undefined' && document.cookie.includes('token='));

    if (isProtectedRoute(href) && !hasToken) {
      const loginUrl = `/login?redirect=${encodeURIComponent(href)}`;
      return router.push(loginUrl, options);
    }
    return router.push(href, options);
  };

  /**
   * 安全的replace跳转
   * 跳转前检查目标路由是否需要登录
   */

  const replace = (href: string, options?: NavigateOptions) => {
    // 双重检查确保可靠性：1. store状态 2. cookie状态（fallback）
    const hasToken =
      isAuthenticated ||
      (typeof document !== 'undefined' && document.cookie.includes('token='));

    if (isProtectedRoute(href) && !hasToken) {
      const loginUrl = `/login?redirect=${encodeURIComponent(href)}`;
      return router.replace(loginUrl, options);
    }
    return router.replace(href, options);
  };

  return {
    ...router,
    push,
    replace,
  };
}

/**
 * 路由白名单判断
 * 可以在组件中复用此函数
 */
export { isProtectedRoute };
