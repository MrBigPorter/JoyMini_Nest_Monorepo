/**
 * 受保护路由统一配置
 * 三层防护体系共享配置
 */

// 受保护路由列表 - 需要登录才能访问
export const PROTECTED_ROUTES = [
  '/bookmarks',
  // 未来页面（已规划但未实现）
  '/profile',
  '/settings',
  '/dashboard',
  '/comments',
];

/**
 * 判断路径是否是受保护路由
 * 自动处理语言前缀
 */
export function isProtectedRoute(pathname: string): boolean {
  // 移除语言前缀后匹配路径
  // 正则解释：匹配 /zh 或 /zh-CN 或 /en 等语言前缀
  // 使用非贪婪匹配，确保只匹配语言前缀部分

  const pathWithoutLocale = pathname.replace(
    /^\/[a-z]{2}(-[A-Z]{2})?(?=\/|$)/,
    '',
  );

  // 调试日志
  console.log('🔍 isProtectedRoute检查:', {
    originalPathname: pathname,
    pathWithoutLocale,
    matches: PROTECTED_ROUTES.map((route) => ({
      route,
      matches:
        pathWithoutLocale.startsWith(route) || pathWithoutLocale === route,
    })),
  });

  return PROTECTED_ROUTES.some(
    (route) =>
      pathWithoutLocale.startsWith(route) || pathWithoutLocale === route,
  );
}

/**
 * 生成登录跳转地址
 */
export function getLoginRedirectUrl(
  locale: string,
  redirectPath: string,
): string {
  return `/${locale}/login?redirect=${encodeURIComponent(redirectPath)}`;
}
