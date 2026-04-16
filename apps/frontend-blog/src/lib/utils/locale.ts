/**
 * 语言相关工具函数
 * 用于统一处理语言前缀检测和路径构建
 */

import { locales, type Locale } from '../../../i18n.config';

// 支持的语言列表，与 middleware.ts、i18n.config.ts 保持一致
const SUPPORTED_LOCALES = locales;

export type SupportedLocale = Locale;

/**
 * 从当前URL路径中提取语言代码
 * @returns 当前语言代码，默认为 'zh'
 */
export function getCurrentLocale(): SupportedLocale {
  if (typeof window === 'undefined') return 'zh';

  const pathParts = window.location.pathname.split('/');
  const locale = pathParts[1];

  // 检查是否是支持的语言代码
  if (locale && SUPPORTED_LOCALES.includes(locale as SupportedLocale)) {
    return locale as SupportedLocale;
  }

  return 'zh';
}

/**
 * 为路径添加当前语言前缀
 * @param path 原始路径（如 '/login'）
 * @returns 带语言前缀的路径（如 '/zh/login'）
 */
export function withLocale(path: string): string {
  const locale = getCurrentLocale();
  const normalizedPath = path.startsWith('/') ? path : '/' + path;
  return `/${locale}${normalizedPath}`;
}

/**
 * 检查给定的语言代码是否受支持
 * @param locale 语言代码
 * @returns 是否受支持
 */
export function isSupportedLocale(locale: string): locale is SupportedLocale {
  return SUPPORTED_LOCALES.includes(locale as SupportedLocale);
}

/**
 * 从路径中提取语言代码
 * @param path 完整路径（如 '/zh/login'）
 * @returns 提取的语言代码，如果无法提取则返回 null
 */
export function extractLocaleFromPath(path: string): SupportedLocale | null {
  const pathParts = path.split('/');
  const locale = pathParts[1];

  if (locale && isSupportedLocale(locale)) {
    return locale;
  }

  return null;
}

/**
 * 移除路径中的语言前缀
 * @param path 带语言前缀的路径（如 '/zh/login'）
 * @returns 移除语言前缀后的路径（如 '/login'）
 */
export function removeLocaleFromPath(path: string): string {
  const pathParts = path.split('/');
  const locale = pathParts[1];

  if (locale && isSupportedLocale(locale)) {
    // 移除语言部分
    return '/' + pathParts.slice(2).join('/') || '/';
  }

  return path;
}
