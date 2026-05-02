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

// P2-1: 模块顶层初始化一次，避免每次请求重建实例
const intlMiddleware = createMiddleware({
  locales: LOCALES,
  defaultLocale: DEFAULT_LOCALE,
  localeDetection: false, // 禁用自动检测，完全依赖统一检测逻辑
  localePrefix: 'always', // 保持always模式
});

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

  // 4. 如果没有语言前缀，添加检测到的语言并重定向
  // P0-1 修复：语言重定向响应必须禁止 CDN 缓存
  //   - 原因：Cloudflare 会缓存未设 Cache-Control 的 302 响应
  //   - 后果：所有用户收到同一个缓存的 302 /zh，英文用户被强制跳中文
  // P1-4 修复：根路径直接重定向到 /{locale}/ (带 trailing slash)
  //   - 原因：不带 slash 时 next-intl 会再做一次 /zh → /zh/ 的重定向
  //   - 效果：3 次重定向跳数减少为 2 次
  if (!hasLocalePrefix) {
    url.pathname =
      pathname === '/'
        ? `/${detectedLocale}/`
        : `/${detectedLocale}${pathname}`;

    const response = NextResponse.redirect(url);
    response.headers.set('Cache-Control', 'no-store, no-cache');
    response.headers.set('Vary', 'Accept-Language, Cookie');
    return response;
  }

  // 5. URL路径优先：如果已有合法语言前缀，信任用户选择，避免闪烁
  const currentLocale = pathname.split('/')[1];
  const isCurrentLocaleValid = isSupportedLocale(currentLocale);

  if (!isCurrentLocaleValid) {
    // 无效语言，重定向到默认语言（同样禁止缓存）
    url.pathname = `/${DEFAULT_LOCALE}${pathname}`;
    const response = NextResponse.redirect(url);
    response.headers.set('Cache-Control', 'no-store, no-cache');
    return response;
  }

  // 6. 认证拦截 - 三层防护第一层
  // 这是最高优先级的检查，发生在任何代码运行之前
  const authToken = request.cookies.get('token')?.value;

  if (isProtectedRoute(pathname) && !authToken) {
    // 未登录访问受保护路由，直接重定向到登录页
    // 没有任何渲染，零闪烁体验
    const loginUrl = new URL(
      getLoginRedirectUrl(currentLocale, pathname),
      request.url,
    );
    return NextResponse.redirect(loginUrl);
  }

  // 7. 使用next-intl中间件处理其他逻辑

  return intlMiddleware(request);
}

export const config = {
  // 优化匹配器：确保覆盖所有客户端跳转，包括_next/data请求
  // 排除：api路由、静态文件、favicon等
  matcher: ['/((?!api|_next|favicon.ico|robots.txt|sitemap.xml).*)'],
};
