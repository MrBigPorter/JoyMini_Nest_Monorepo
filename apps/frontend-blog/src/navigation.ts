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

// 动态语言列表 - 实际值由 i18n.config.ts 在运行时确定
// 这里提供一个默认值，实际使用时会从系统配置API获取
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
// 注意：这里的 locales 配置是静态的，但实际路由验证由 i18n.config.ts 处理
export const { Link, redirect, usePathname, useRouter } = createNavigation({
  locales,
  localePrefix,
  defaultLocale: 'zh',
});
