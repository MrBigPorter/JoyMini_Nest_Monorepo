// middleware.ts
import createMiddleware from 'next-intl/middleware';
import { locales, defaultLocale } from './i18n.config';

export default createMiddleware({
  // 使用 i18n.config.ts 中定义的静态语言列表
  locales,
  defaultLocale,
  localeDetection: true,
  // RC版本临时使用 always 模式，as-needed 模式在RC版有BUG
  // 等 next-intl 3.0 正式版发布后再切回 as-needed
  localePrefix: 'always',
});

export const config = {
  // 确保匹配所有需要国际化的路由
  matcher: ['/((?!api|_next|.*\\..*).*)'],
};
