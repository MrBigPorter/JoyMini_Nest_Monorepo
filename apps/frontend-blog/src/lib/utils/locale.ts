/**
 * 语言相关工具函数
 * 用于统一处理语言前缀检测和路径构建
 */

import { LOCALES, type Locale, DEFAULT_LOCALE } from '@/lib/i18n/config';
import type { NextRequest } from 'next/server';

// 支持的语言列表，与 middleware.ts、i18n.config.ts 保持一致
const SUPPORTED_LOCALES = LOCALES;

export type SupportedLocale = Locale;

/**
 * 统一语言检测函数（SSR/CSR通用）
 * 优先级：URL路径 > Cookie > 浏览器语言 > 默认语言
 * 关键修复：URL路径优先级最高，确保SSR/CSR一致性
 * @param request Next.js请求对象（SSR环境可选）
 * @returns 检测到的语言代码
 */
export function detectLocale(request?: NextRequest): SupportedLocale {
  // 🔴 调试日志
  console.log('[detectLocale]', {
    request: !!request,
    url: request?.url,
    window: typeof window !== 'undefined' ? window.location.pathname : 'SSR'
  });

  // 1. 优先从URL路径获取（SSR和CSR都支持）
  let pathLocale: SupportedLocale | null = null;

  if (request) {
    // SSR环境：从请求URL获取
    const url = new URL(request.url);
    pathLocale = extractLocaleFromPath(url.pathname);
    console.log('[detectLocale] SSR路径语言:', pathLocale);
  } else if (typeof window !== 'undefined') {
    // CSR环境：从window.location获取
    pathLocale = extractLocaleFromPath(window.location.pathname);
    console.log('[detectLocale] CSR路径语言:', pathLocale);
  }

  // ✅ 终极修复：用户意图优先于URL路径
  // 当用户明确切换语言时，Cookie是用户意图的唯一可信来源
  // 路由跳转是异步的，路径更新可能滞后于Cookie
  const cookieLocale = getLocaleFromCookie(request);
  if (cookieLocale && isSupportedLocale(cookieLocale)) {
    return cookieLocale;
  }

  // 2. 从URL路径获取
  if (pathLocale) return pathLocale;

  // 3. 从浏览器语言获取
  if (typeof navigator !== 'undefined') {
    const browserLang = navigator.language.split('-')[0];
    if (isSupportedLocale(browserLang)) return browserLang;
  }

  // 4. 默认语言
  return DEFAULT_LOCALE;
}

/**
 * 从当前URL路径中提取语言代码
 * @returns 当前语言代码，默认为 'zh'
 * @deprecated 使用 detectLocale() 替代
 */
export function getCurrentLocale(): SupportedLocale {
  return detectLocale();
}

/**
 * 从cookie获取语言设置
 * @param request Next.js请求对象（SSR环境）
 */
function getLocaleFromCookie(request?: NextRequest): string | null {
  // 正确：支持next-intl标准Cookie名称 NEXT_LOCALE
  // next-intl默认使用NEXT_LOCALE作为Cookie名称，旧的locale保持向后兼容

  // SSR环境：从请求对象获取
  if (request) {
    // 优先读取标准NEXT_LOCALE
    let cookieLocale = request.cookies.get('NEXT_LOCALE')?.value;
    if (cookieLocale) return cookieLocale;

    // 向后兼容旧的locale Cookie
    cookieLocale = request.cookies.get('locale')?.value;
    if (cookieLocale) return cookieLocale;
  }

  // CSR环境：从document.cookie获取
  if (typeof document !== 'undefined') {
    // 优先读取标准NEXT_LOCALE
    let match = document.cookie.match(new RegExp('(^| )NEXT_LOCALE=([^;]+)'));
    if (match) return match[2];

    // 向后兼容旧的locale Cookie
    match = document.cookie.match(new RegExp('(^| )locale=([^;]+)'));
    if (match) return match[2];
  }

  return null;
}

/**
 * 为路径添加当前语言前缀
 * @param path 原始路径（如 '/login'）
 * @returns 带语言前缀的路径（如 '/zh/login'）
 */
export function withLocale(path: string): string {
  const locale = detectLocale();
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
