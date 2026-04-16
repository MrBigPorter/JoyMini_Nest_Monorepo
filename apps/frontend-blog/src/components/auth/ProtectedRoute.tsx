'use client';

import { useEffect } from 'react';
import { useRouter } from '@/navigation';
import { useAuth } from '@/lib/hooks/useAuth';
import { PageSkeleton } from '@/components/ui/PageSkeleton';
import { getCurrentLocale } from '@/lib/utils/locale';

interface ProtectedRouteProps {
  children: React.ReactNode;
  redirectTo?: string;
  requireAuth?: boolean;
  fallback?: React.ReactNode;
}

/**
 * 受保护路由组件
 * @param children - 需要保护的内容
 * @param redirectTo - 未认证时重定向的路径，默认为 '/login'
 * @param requireAuth - 是否要求认证，默认为 true
 * @param fallback - 加载时的回退 UI，默认为 PageSkeleton
 */
export function ProtectedRoute({
  children,
  redirectTo = '/login',
  requireAuth = true,
  fallback = <PageSkeleton />,
}: ProtectedRouteProps) {
  const { isAuthenticated, isLoading, checkAuth } = useAuth();
  const router = useRouter();

  useEffect(() => {
    const verifyAuth = async () => {
      if (!requireAuth) return;

      // 等待加载完成（包括水合）
      if (isLoading) {
        return;
      }

      if (!isAuthenticated) {
        // 尝试检查认证状态
        const isAuthValid = await checkAuth();

        if (!isAuthValid) {
          // 保存当前路径，登录后可以跳转回来
          const currentPath = window.location.pathname + window.location.search;
          if (currentPath !== '/login' && currentPath !== '/register') {
            sessionStorage.setItem('redirectAfterLogin', currentPath);
          }

          // 获取当前语言前缀
          const locale = getCurrentLocale();
          // 构建带语言前缀的重定向路径
          const redirectPath = `/${locale}${redirectTo}`;
          console.log('redirectPath', redirectPath);
          router.push(redirectPath);
        }
      }
    };

    verifyAuth();
  }, [isAuthenticated, isLoading, requireAuth, router, redirectTo, checkAuth]);

  // 显示加载状态（包括水合状态）
  if (isLoading) {
    return <>{fallback}</>;
  }

  // 如果不需要认证，直接渲染子组件
  if (!requireAuth) {
    return <>{children}</>;
  }

  // 如果未认证，不渲染任何内容（会在 useEffect 中重定向）
  if (!isAuthenticated) {
    return null;
  }

  // 已认证，渲染子组件
  return <>{children}</>;
}

/**
 * 登录守卫组件
 * 用于登录/注册页面，如果用户已登录则重定向到首页
 */
export function LoginGuard({
  children,
  redirectTo = '/',
}: {
  children: React.ReactNode;
  redirectTo?: string;
}) {
  const { isAuthenticated, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      // 检查是否有重定向路径
      const redirectPath = sessionStorage.getItem('redirectAfterLogin');
      if (redirectPath) {
        sessionStorage.removeItem('redirectAfterLogin');
        router.push(redirectPath);
      } else {
        router.push(redirectTo);
      }
    }
  }, [isAuthenticated, isLoading, router, redirectTo]);

  // 显示加载状态
  if (isLoading) {
    return <PageSkeleton />;
  }

  // 如果已登录，不渲染任何内容（会在 useEffect 中重定向）
  if (isAuthenticated) {
    return null;
  }

  // 未登录，渲染子组件
  return <>{children}</>;
}
