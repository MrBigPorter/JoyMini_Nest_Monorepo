'use client';

import { Link, useRouter } from '@/navigation';
import { ComponentProps } from 'react';
import { useAuth } from '@/lib/hooks/useAuth';
import { isProtectedRoute } from '@/lib/auth/protected-routes';

type LinkProps = ComponentProps<typeof Link>;

interface ProtectedLinkProps extends LinkProps {
  children: React.ReactNode;
  className?: string;
}

/**
 * 受保护链接组件
 * 四层防护体系第一层 - 组件级拦截
 *
 * 特性：
 * 1. 点击链接时立即检查认证状态
 * 2. 如果目标路由受保护且未登录，阻止默认跳转
 * 3. 使用 useProtectedRouter 进行安全跳转
 * 4. 完全兼容标准 Link 组件的所有属性
 * 5. 简化设计：无额外包装，保持最简洁结构
 *
 * 使用场景：
 * - 所有指向受保护页面的链接
 * - 收藏、个人中心、设置等需要登录的页面链接
 *
 * @example
 * // 普通链接 - 正常跳转
 * <ProtectedLink href="/about">关于我们</ProtectedLink>
 *
 * // 受保护链接 - 点击时检查登录状态
 * <ProtectedLink href="/bookmarks">我的收藏</ProtectedLink>
 */
export function ProtectedLink({
  href,
  children,
  className = '',
  ...props
}: ProtectedLinkProps) {
  const { isAuthenticated } = useAuth();
  const router = useRouter();

  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    // 只有在100%确定未登录时，才手动拦截并跳转到登录页
    // 如果已登录或状态未知，直接让Link组件处理（交给中间件最后把关）
    if (
      typeof href === 'string' &&
      isProtectedRoute(href) &&
      !isAuthenticated
    ) {
      e.preventDefault();
      // 记录来源页面，登录后可以跳转回来
      sessionStorage.setItem('redirectAfterLogin', href);
      router.push('/login');
      return;
    }

    // 其他情况：正常跳转，信任中间件进行最终认证检查
    // 不需要做任何特殊处理，Link组件会处理跳转
  };

  return (
    <Link
      href={href}
      onClick={handleClick}
      className={className}
      prefetch={false} // 禁用预加载，防止触发不必要的认证检查
      {...props}
    >
      {children}
    </Link>
  );
}
