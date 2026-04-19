// middleware.ts
import createMiddleware from 'next-intl/middleware';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { LOCALES, DEFAULT_LOCALE } from './src/lib/i18n/config';
import { detectLocale, isSupportedLocale } from './src/lib/utils/locale';

// 增强中间件：使用统一的语言检测逻辑
export default function middleware(request: NextRequest) {
  console.log('[Middleware]', request.url);
  console.log('[Middleware] Cookies:', request.cookies.getAll());
  console.log(
    '[Middleware] NEXT_LOCALE:',
    request.cookies.get('NEXT_LOCALE')?.value,
  );
  console.log('[Middleware] locale:', request.cookies.get('locale')?.value);
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

  if (isCurrentLocaleValid) {
    // 关键修复：URL路径优先，不强制重定向
    // 用户访问 /en/ 时，即使检测到中文，也保持英文
    // 这避免了"中文->英文闪烁"问题
    return NextResponse.next();
  }

  // 6. 使用next-intl中间件处理其他逻辑
  const intlMiddleware = createMiddleware({
    locales: LOCALES,
    defaultLocale: DEFAULT_LOCALE,
    localeDetection: false, // 禁用自动检测，完全依赖统一检测逻辑
    localePrefix: 'always', // 保持always模式
  });

  return intlMiddleware(request);
}

export const config = {
  // 确保匹配所有需要国际化的路由
  matcher: ['/((?!api|_next|.*\\..*).*)'],
};
