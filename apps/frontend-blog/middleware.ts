// middleware.ts
import createMiddleware from 'next-intl/middleware';

export default createMiddleware({
  locales: ['zh-CN', 'en'],
  defaultLocale: 'zh-CN',
  localeDetection: true,
  // 建议设为 'as-needed' 或 'always' 视你需求而定
  localePrefix: 'always',
});

export const config = {
  // 确保匹配所有需要国际化的路由
  matcher: ['/((?!api|_next|.*\\..*).*)'],
};
