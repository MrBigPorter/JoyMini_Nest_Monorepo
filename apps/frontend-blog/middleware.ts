// middleware.ts
import createMiddleware from 'next-intl/middleware';
import { LOCALES, DEFAULT_LOCALE } from './src/lib/i18n/config';

export default createMiddleware({
  // 直接使用共享配置中的语言列表
  locales: LOCALES,
  defaultLocale: DEFAULT_LOCALE,
  localeDetection: false,
  // RC版本临时使用 always 模式，as-needed 模式在RC版有BUG
  // 等 next-intl 3.0 正式版发布后再切回 as-needed
  localePrefix: 'always',
});

export const config = {
  // 确保匹配所有需要国际化的路由
  matcher: ['/((?!api|_next|.*\\..*).*)'],
};
