// middleware.ts
import createMiddleware from 'next-intl/middleware';

export default createMiddleware({
  // 支持的语言列表，与 navigation.ts 保持一致
  // 实际语言启用状态由 i18n.config.ts 从系统配置API动态获取
  locales: ['zh', 'en', 'ja', 'ko', 'fr', 'de'],
  defaultLocale: 'zh',
  localeDetection: true,
  // RC版本临时使用 always 模式，as-needed 模式在RC版有BUG
  // 等 next-intl 3.0 正式版发布后再切回 as-needed
  localePrefix: 'always',
});

export const config = {
  // 确保匹配所有需要国际化的路由
  matcher: ['/((?!api|_next|.*\\..*).*)'],
};
