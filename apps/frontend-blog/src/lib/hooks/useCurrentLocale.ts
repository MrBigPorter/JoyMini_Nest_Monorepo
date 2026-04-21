'use client';

import { useParams } from 'next/navigation';
import { DEFAULT_LOCALE, type Locale, LOCALES } from '@/lib/i18n/config';

/**
 * 🌐 国际化架构 - 单一数据源 Hook
 *
 * 这是整个应用中唯一允许读取当前语言的地方。
 * 遵循黄金优先级规则：URL参数 > Cookie > Accept-Language > 默认值
 *
 *  铁律：整个应用中，任何地方需要知道当前语言，只能调用这个Hook。
 * ❌ 禁止任何其他地方读取Cookie、localStorage或其他任何语言来源。
 *
 *
 * @returns 当前语言代码
 */

export const useCurrentLocale = (): Locale => {
  const params = useParams();

  //  永远优先从URL路由参数读取
  const localeFromParams = params.locale as string | undefined;

  if (localeFromParams) {
    return localeFromParams as Locale;
  }

  //  只有URL没有locale参数时才使用默认值
  // 注意：这里不读取Cookie，因为Cookie只应该用于首次访问时的默认值
  // 一旦用户进入网站，所有页面都应该有locale在URL中
  return DEFAULT_LOCALE;
};

/**
 * 检查当前是否在客户端环境
 * 用于需要区分SSR/CSR的场景
 */
export const useIsClient = () => {
  return typeof window !== 'undefined';
};

/**
 * 获取当前语言的安全版本
 * 如果当前语言不在支持列表中，返回默认语言
 */
export const useSafeLocale = (): Locale => {
  const locale = useCurrentLocale();

  if (LOCALES.includes(locale)) {
    return locale;
  }

  return DEFAULT_LOCALE;
};
