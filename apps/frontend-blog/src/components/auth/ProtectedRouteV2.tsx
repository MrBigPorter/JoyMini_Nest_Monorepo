'use client';

import { useEffect } from 'react';
import { useRouter } from '@/navigation';
import { useAuth } from '@/lib/hooks/useAuth';
import { PageSkeleton } from '@/components/ui/PageSkeleton';
import { usePlatform } from '@/lib/utils/platform';

interface ProtectedRouteProps {
  children: React.ReactNode;
  redirectTo?: string;
  requireAuth?: boolean;
  fallback?: React.ReactNode;
  ssrAuth?: boolean; // 服务端传递的认证状态
}

/**
 * 智能受保护路由组件 V2
 * 支持同步读取认证状态，消除页面闪动
 *
 * @param children - 需要保护的内容
 * @param redirectTo - 未认证时重定向的路径，默认为 '/login'
 * @param requireAuth - 是否要求认证，默认为 true
 * @param fallback - 加载时的回退 UI，默认为 PageSkeleton
 * @param ssrAuth - 服务端传递的认证状态（SSR模式使用）
 */
export function ProtectedRouteV2({
  children,
  redirectTo = '/login',
  requireAuth = true,
  fallback = <PageSkeleton />,
  ssrAuth,
}: ProtectedRouteProps) {
  const { isAuthenticated, isLoading, checkAuth } = useAuth();
  const router = useRouter();
  const platform = usePlatform();

  // 计算有效认证状态（消除水合延迟）
  const effectiveAuth = (() => {
    // 优先级1: SSR传递的状态（最可靠）
    if (ssrAuth !== undefined) {
      console.log('ProtectedRouteV2: Using SSR auth state:', ssrAuth);
      return ssrAuth;
    }

    // 优先级2: 客户端认证状态
    if (platform.isSSR) {
      // SSR模式：直接使用客户端状态（已同步）
      console.log(
        'ProtectedRouteV2: SSR mode, using client auth:',
        isAuthenticated,
      );
      return isAuthenticated;
    } else {
      // SPA/App模式：使用优化后的客户端状态
      console.log(
        'ProtectedRouteV2: SPA mode, using client auth:',
        isAuthenticated,
      );
      return isAuthenticated;
    }
  })();

  // 重定向逻辑（避免重复重定向）
  useEffect(() => {
    const verifyAndRedirect = async () => {
      if (!requireAuth) return;

      // 等待加载完成（包括水合）
      if (isLoading) {
        console.log('ProtectedRouteV2: Still loading, skipping verification');
        return;
      }

      if (!effectiveAuth) {
        console.log('ProtectedRouteV2: Not authenticated, checking auth...');
        // 尝试检查认证状态
        const isAuthValid = await checkAuth();

        if (!isAuthValid) {
          console.log(
            'ProtectedRouteV2: Auth check failed, redirecting to login',
          );
          // 保存当前路径，登录后可以跳转回来
          const currentPath = window.location.pathname + window.location.search;
          if (currentPath !== '/login' && currentPath !== '/register') {
            sessionStorage.setItem('redirectAfterLogin', currentPath);
          }

          // 直接使用重定向路径，让国际化路由中间件处理语言前缀
          // 注意：redirectTo 应该是不带语言前缀的路径，如 '/login'
          router.push(redirectTo);
        } else {
          console.log(
            'ProtectedRouteV2: Auth check passed, user is authenticated',
          );
        }
      } else {
        console.log('ProtectedRouteV2: Already authenticated');
      }
    };

    // 借鉴admin-next的经验：立即检查localStorage，不要等Zustand水合
    // 如果localStorage有token，给Zustand一点时间恢复状态
    if (typeof window !== 'undefined') {
      try {
        const authStorage = localStorage.getItem('auth-storage');
        if (authStorage) {
          // 尝试解析auth-storage内容
          const parsed = JSON.parse(authStorage);
          const hasToken = parsed?.accessToken;

          if (hasToken) {
            // 有token，给Zustand 100ms时间恢复状态
            const timer = setTimeout(() => {
              verifyAndRedirect();
            }, 100);
            return () => clearTimeout(timer);
          }
        }
      } catch (error) {
        console.warn('ProtectedRouteV2: Failed to parse auth-storage:', error);
      }
    }

    // 没有token或解析失败，立即执行验证
    verifyAndRedirect();
  }, [effectiveAuth, isLoading, requireAuth, router, redirectTo, checkAuth]);

  // 显示加载状态（包括水合状态）
  if (isLoading) {
    console.log('ProtectedRouteV2: Showing loading fallback');
    return <>{fallback}</>;
  }

  // 如果不需要认证，直接渲染子组件
  if (!requireAuth) {
    console.log('ProtectedRouteV2: No auth required, rendering children');
    return <>{children}</>;
  }

  // 如果未认证，不渲染任何内容（会在 useEffect 中重定向）
  if (!effectiveAuth) {
    console.log('ProtectedRouteV2: Not authenticated, rendering null');
    return null;
  }

  // 已认证，渲染子组件
  console.log('ProtectedRouteV2: Authenticated, rendering children');
  return <>{children}</>;
}

/**
 * 登录守卫组件 V2
 * 用于登录/注册页面，如果用户已登录则重定向到首页
 */
export function LoginGuardV2({
  children,
  redirectTo = '/',
  ssrAuth,
}: {
  children: React.ReactNode;
  redirectTo?: string;
  ssrAuth?: boolean;
}) {
  const { isAuthenticated, isLoading } = useAuth();
  const router = useRouter();
  const platform = usePlatform();

  // 计算有效认证状态
  const effectiveAuth = (() => {
    if (ssrAuth !== undefined) return ssrAuth;
    return isAuthenticated;
  })();

  useEffect(() => {
    if (!isLoading && effectiveAuth) {
      console.log('LoginGuardV2: User is authenticated, redirecting');
      // 检查是否有重定向路径
      const redirectPath = sessionStorage.getItem('redirectAfterLogin');
      if (redirectPath) {
        sessionStorage.removeItem('redirectAfterLogin');
        router.push(redirectPath);
      } else {
        router.push(redirectTo);
      }
    }
  }, [effectiveAuth, isLoading, router, redirectTo]);

  // 显示加载状态
  if (isLoading) {
    return <PageSkeleton />;
  }

  // 如果已登录，不渲染任何内容（会在 useEffect 中重定向）
  if (effectiveAuth) {
    return null;
  }

  // 未登录，渲染子组件
  return <>{children}</>;
}
