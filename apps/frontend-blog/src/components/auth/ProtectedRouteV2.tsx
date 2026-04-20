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

  // 立即重定向逻辑（消除skeleton闪烁）
  useEffect(() => {
    const verifyAndRedirect = async () => {
      if (!requireAuth) return;

      // 如果已认证，直接返回
      if (effectiveAuth) {
        console.log('ProtectedRouteV2: Already authenticated');
        return;
      }

      // 如果正在加载，等待一小段时间再检查
      if (isLoading) {
        console.log('ProtectedRouteV2: Still loading, waiting...');
        // 设置超时，避免无限等待
        const timeoutId = setTimeout(() => {
          console.log('ProtectedRouteV2: Loading timeout, forcing check');
          verifyAndRedirect();
        }, 500);
        return () => clearTimeout(timeoutId);
      }

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

        // 立即重定向，不等待任何渲染
        router.push(redirectTo);
      } else {
        console.log(
          'ProtectedRouteV2: Auth check passed, user is authenticated',
        );
      }
    };

    // 立即执行验证，不等待任何延迟
    verifyAndRedirect();
  }, [effectiveAuth, isLoading, requireAuth, router, redirectTo, checkAuth]);

  // 如果不需要认证，直接渲染子组件
  if (!requireAuth) {
    console.log('ProtectedRouteV2: No auth required, rendering children');
    return <>{children}</>;
  }

  // 如果已认证，渲染子组件
  if (effectiveAuth) {
    console.log('ProtectedRouteV2: Authenticated, rendering children');
    return <>{children}</>;
  }

  // 未认证状态：不渲染任何内容，等待重定向
  console.log('ProtectedRouteV2: Not authenticated, rendering nothing');
  return null;
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
