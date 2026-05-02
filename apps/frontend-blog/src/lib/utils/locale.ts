import { LOCALES, type Locale, DEFAULT_LOCALE } from '@/lib/i18n/config';
import type { NextRequest } from 'next/server';

// 支持的语言列表，与 middleware.ts、i18n.config.ts 保持一致
const SUPPORTED_LOCALES = LOCALES;

// Accept-Language 检测失败时的默认语言（英文）
const FALLBACK_LOCALE: Locale = 'en';

export type SupportedLocale = Locale;

/**
 * 统一语言检测函数（SSR/CSR通用）
 * 优先级：URL路径 > Accept-Language头部 > Cookie > 默认英文
 *  紧急修复：SSR环境强制从URL路径提取，完全忽略Cookie
 * @param request Next.js请求对象（SSR环境可选）
 * @returns 检测到的语言代码
 */

export function detectLocale(request?: NextRequest): SupportedLocale {
  //  紧急修复：SSR环境强制从URL路径提取，完全忽略Cookie
  if (request) {
    const url = new URL(request.url);
    const pathLocale = extractLocaleFromPath(url.pathname);

    if (pathLocale) {
      // SSR环境：URL路径是唯一事实来源，完全忽略Cookie
      return pathLocale;
    }

    // 从Accept-Language头部检测浏览器语言
    const acceptLanguage = request.headers.get('accept-language');
    const browserLocale = parseAcceptLanguage(acceptLanguage);

    if (browserLocale) {
      return browserLocale;
    }
  }

  //  修复：客户端环境永远只信任URL路径，彻底断开死循环
  // 客户端禁止读取Cookie、navigator或任何其他数据源
  // URL是唯一真实来源，Cookie只在首次访问时由middleware处理
  if (typeof window !== 'undefined') {
    const pathLocale = extractLocaleFromPath(window.location.pathname);
    return pathLocale || DEFAULT_LOCALE;
  }

  // 只有SSR环境才继续后续逻辑
  const cookieLocale = getLocaleFromCookie(request);

  if (cookieLocale && isSupportedLocale(cookieLocale)) {
    return cookieLocale;
  }

  // 默认语言：如果都不匹配，使用英文
  return FALLBACK_LOCALE;
}

/**
 * 解析 Accept-Language 头部，返回最佳匹配的支持语言
 * Accept-Language 格式示例: "zh-CN,zh;q=0.9,en;q=0.8"
 * @param header Accept-Language 头部值
 * @returns 匹配的支持语言代码，无匹配则返回 null
 */
function parseAcceptLanguage(header: string | null): Locale | null {
  if (!header) return null;

  // 按 q 值降序排序，解析语言标签
  const locales = header
    .split(',')
    .map((entry) => {
      const [tag, qPart] = entry.split(';');
      const q = qPart ? parseFloat(qPart.replace('q=', '')) : 1.0;
      // 提取语言主标签 (如 'zh-CN' → 'zh', 'en-US' → 'en')
      const primaryLang = tag.trim().split('-')[0].toLowerCase();
      return { lang: primaryLang, q };
    })
    .sort((a, b) => b.q - a.q); // q 值高的优先

  // 按优先级匹配支持的语言
  for (const { lang } of locales) {
    if (SUPPORTED_LOCALES.includes(lang as Locale)) {
      return lang as Locale;
    }
  }

  return null;
}

/**
 * 从当前URL路径中提取语言代码
 * @returns 当前语言代码，默认为 'zh'
 * @deprecated 客户端代码必须使用 useCurrentLocale() Hook，禁止直接调用此函数
 */
export function getCurrentLocale(): SupportedLocale {
  if (typeof window !== 'undefined') {
    console.warn(
      '⚠️ DEPRECATED: getCurrentLocale() should not be used in client components. Use useCurrentLocale() Hook instead.',
    );
  }
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
 * @param locale 显式指定语言，推荐从 useCurrentLocale() 获取
 * @returns 带语言前缀的路径（如 '/zh/login'）
 */
export function withLocale(path: string, locale?: SupportedLocale): string {
  const targetLocale = locale || detectLocale();
  const normalizedPath = path.startsWith('/') ? path : '/' + path;
  return `/${targetLocale}${normalizedPath}`;
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
