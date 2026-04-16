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
import { LOCALES, DEFAULT_LOCALE } from '@/lib/i18n/config';

// 支持的语言列表，使用共享配置
export type Locale = (typeof LOCALES)[number];
export const locales: readonly Locale[] = LOCALES;

// RC版本临时使用 always 模式，as-needed 模式在RC版有BUG
// 等 next-intl 3.0 正式版发布后再切回 as-needed
export const localePrefix = 'always';

//  next-intl v3 RC 版本使用 createNavigation API
// 注意：这里的 locales 配置是静态的，但实际路由验证由 i18n.config.ts 处理
export const { Link, redirect, usePathname, useRouter } = createNavigation({
  locales,
  localePrefix,
  defaultLocale: DEFAULT_LOCALE,
});
