// middleware.ts
import createMiddleware from 'next-intl/middleware';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { LOCALES, DEFAULT_LOCALE } from './src/lib/i18n/config';
import { detectLocale, isSupportedLocale } from './src/lib/utils/locale';
import {
  isProtectedRoute,
  getLoginRedirectUrl,
} from './src/lib/auth/protected-routes';

// 增强中间件：使用统一的语言检测逻辑
export default function middleware(request: NextRequest) {
  // 1. 使用统一的语言检测函数
  const detectedLocale = detectLocale(request);

  // 2. 获取当前URL路径
  const url = request.nextUrl.clone();
  const pathname = url.pathname;

  // 3. 检查当前路径是否已经有语言前缀
  const hasLocalePrefix = LOCALES.some(
    (locale) => pathname.startsWith(`/${locale}/`) || pathname === `/${locale}`,
  );

  // 4. 如果没有语言前缀，添加检测到的语言
  if (!hasLocalePrefix) {
    url.pathname = `/${detectedLocale}${pathname === '/' ? '' : pathname}`;
    return NextResponse.redirect(url);
  }

  // 5. URL路径优先：如果已有合法语言前缀，信任用户选择，避免闪烁
  const currentLocale = pathname.split('/')[1];
  const isCurrentLocaleValid = isSupportedLocale(currentLocale);

  if (!isCurrentLocaleValid) {
    // 无效语言，重定向到默认语言
    url.pathname = `/${DEFAULT_LOCALE}${pathname}`;
    return NextResponse.redirect(url);
  }

  // 6.  认证拦截 - 三层防护第一层
  // 这是最高优先级的检查，发生在任何代码运行之前
  const authToken = request.cookies.get('token')?.value;

  // 调试日志：记录路径匹配情况
  console.log('🔍 Middleware认证检查:', {
    originalPathname: pathname,
    currentLocale,
    authTokenExists: !!authToken,
    isProtectedRoute: isProtectedRoute(pathname),
    pathWithoutLocale: pathname.replace(/^\/[a-z]{2}(-[A-Z]{2})?/, ''),
    cookies: request.cookies
      .getAll()
      .map((c) => ({ name: c.name, value: c.value ? '***' : 'empty' })),
  });

  if (isProtectedRoute(pathname) && !authToken) {
    // 未登录访问受保护路由，直接重定向到登录页
    // 没有任何渲染，零闪烁体验
    const loginUrl = new URL(
      getLoginRedirectUrl(currentLocale, pathname),
      request.url,
    );

    console.log('🚨 Middleware拦截未认证请求:', {
      from: pathname,
      to: loginUrl.toString(),
      reason: '未登录访问受保护路由',
    });

    return NextResponse.redirect(loginUrl);
  }

  console.log(' Middleware放行请求:', {
    pathname,
    reason: authToken ? '已认证' : '非受保护路由',
  });

  // 7. 使用next-intl中间件处理其他逻辑
  const intlMiddleware = createMiddleware({
    locales: LOCALES,
    defaultLocale: DEFAULT_LOCALE,
    localeDetection: false, // 禁用自动检测，完全依赖统一检测逻辑
    localePrefix: 'always', // 保持always模式
  });

  return intlMiddleware(request);
}

export const config = {
  // 优化匹配器：确保覆盖所有客户端跳转，包括_next/data请求
  // 排除：api路由、静态文件、favicon等
  matcher: ['/((?!api|_next|favicon.ico|robots.txt|sitemap.xml).*)'],
};
