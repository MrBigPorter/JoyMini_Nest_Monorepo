/**
 * next-intl 官方标准路由配置
 *
 * 注意: usePathname, useRouter, Link 不能直接从 next-intl 导入
 * 必须通过 createSharedPathnamesNavigation 工厂函数生成
 * 这样这些钩子才能正确感知当前语言配置
 *
 * 官方文档: https://next-intl-docs.vercel.app/docs/routing/navigation
 */

import { createNavigation } from 'next-intl/navigation';

// 支持的语言列表，必须与 i18n.config.ts 和 middleware.ts 一致
// 注意：这里不再硬编码，实际语言列表由 i18n.config.ts 动态获取
// 为了类型安全，我们仍然定义一个基础类型
export type Locale = 'zh' | 'en' | 'ja' | 'ko' | 'fr' | 'de';
export const locales: readonly Locale[] = [
  'zh',
  'en',
  'ja',
  'ko',
  'fr',
  'de',
] as const;

// RC版本临时使用 always 模式，as-needed 模式在RC版有BUG
// 等 next-intl 3.0 正式版发布后再切回 as-needed
export const localePrefix = 'always';

//  next-intl v3 RC 版本使用 createNavigation API
export const { Link, redirect, usePathname, useRouter } = createNavigation({
  locales,
  localePrefix,
  defaultLocale: 'zh',
});
