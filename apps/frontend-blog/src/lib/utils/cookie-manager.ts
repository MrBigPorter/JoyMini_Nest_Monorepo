/**
 * Cookie管理器
 * 用于在客户端和服务端之间同步状态
 */

import { LOCALES, DEFAULT_LOCALE } from '@/lib/i18n/config';

/**
 * 设置语言Cookie
 */
export function setLocaleCookie(locale: string): void {
  if (typeof document === 'undefined') return;

  // 设置1年有效期的cookie
  document.cookie = `locale=${locale}; path=/; max-age=31536000; SameSite=Lax`;
}

/**
 * 设置认证Token Cookie
 */
export function setTokenCookie(token: string): void {
  if (typeof document === 'undefined') return;

  // 设置1天有效期的cookie，HttpOnly和Secure在生产环境启用
  const isProduction = process.env.NODE_ENV === 'production';
  const secureFlag = isProduction ? '; Secure' : '';
  const httpOnlyFlag = isProduction ? '; HttpOnly' : '';

  document.cookie = `token=${token}; path=/; max-age=86400; SameSite=Lax${secureFlag}${httpOnlyFlag}`;
}

/**
 * 清除认证Token Cookie
 */
export function clearTokenCookie(): void {
  if (typeof document === 'undefined') return;

  document.cookie = 'token=; path=/; max-age=0; SameSite=Lax';

  // 同时清除localStorage中的token
  try {
    localStorage.removeItem('token');
  } catch (error) {
    console.warn('Failed to remove token from localStorage:', error);
  }
}

/**
 * 获取语言Cookie值（客户端）
 */
export function getLocaleCookie(): string | null {
  if (typeof document === 'undefined') return null;

  const match = document.cookie.match(new RegExp('(^| )locale=([^;]+)'));
  return match ? match[2] : null;
}

/**
 * 获取Token Cookie值（客户端）
 */
export function getTokenCookie(): string | null {
  if (typeof document === 'undefined') return null;

  const match = document.cookie.match(new RegExp('(^| )token=([^;]+)'));
  return match ? match[2] : null;
}

/**
 * 检查是否支持Cookie
 */
export function supportsCookies(): boolean {
  if (typeof document === 'undefined') return false;

  try {
    // 测试cookie功能
    document.cookie = 'test_cookie=1; SameSite=Lax';
    const hasCookie = document.cookie.includes('test_cookie');
    // 清理测试cookie
    document.cookie = 'test_cookie=; max-age=0';
    return hasCookie;
  } catch (error) {
    return false;
  }
}

/**
 * 获取所有Cookie
 */
export function getAllCookies(): Record<string, string> {
  if (typeof document === 'undefined') return {};

  const cookies: Record<string, string> = {};
  document.cookie.split(';').forEach((cookie) => {
    const [name, value] = cookie.trim().split('=');
    if (name && value) {
      cookies[name] = decodeURIComponent(value);
    }
  });

  return cookies;
}

/**
 * 删除指定Cookie
 */
export function deleteCookie(name: string): void {
  if (typeof document === 'undefined') return;

  document.cookie = `${name}=; path=/; max-age=0; SameSite=Lax`;
}

/**
 * 统一语言获取函数：优先Cookie，其次路由参数，最后默认语言
 * 用于所有服务端组件
 */
export function getLocaleFromCookies(
  cookieLocale?: string | null,
  routeLocale?: string,
): string {
  // 1. 优先使用传入的cookie值（服务端从cookies()获取）
  if (cookieLocale && LOCALES.includes(cookieLocale as any)) {
    return cookieLocale;
  }

  // 2. 其次使用路由参数
  if (routeLocale && LOCALES.includes(routeLocale as any)) {
    return routeLocale;
  }

  // 3. 最后使用默认语言
  return DEFAULT_LOCALE;
}

/**
 * 验证语言是否有效
 */
export function isValidLocale(locale: string): boolean {
  return LOCALES.includes(locale as any);
}

/**
 * Cookie管理器工具类
 */
export class CookieManager {
  /**
   * 设置语言偏好
   */
  static setLocale(locale: string): void {
    setLocaleCookie(locale);
  }

  /**
   * 设置认证Token
   */
  static setToken(token: string): void {
    setTokenCookie(token);
  }

  /**
   * 清除认证Token
   */
  static clearToken(): void {
    clearTokenCookie();
  }

  /**
   * 获取当前语言（客户端）
   */
  static getLocale(): string | null {
    return getLocaleCookie();
  }

  /**
   * 获取认证Token（客户端）
   */
  static getToken(): string | null {
    return getTokenCookie();
  }

  /**
   * 检查是否已认证
   */
  static isAuthenticated(): boolean {
    return !!getTokenCookie();
  }

  /**
   * 同步localStorage到Cookie（用于迁移）
   */
  static syncFromLocalStorage(): void {
    if (typeof window === 'undefined') return;

    try {
      // 同步语言
      const locale = localStorage.getItem('locale');
      if (locale && !getLocaleCookie()) {
        setLocaleCookie(locale);
      }

      // 同步token
      const token = localStorage.getItem('token');
      if (token && !getTokenCookie()) {
        setTokenCookie(token);
      }
    } catch (error) {
      console.warn('Failed to sync localStorage to cookies:', error);
    }
  }

  /**
   * 初始化Cookie管理器
   */
  static initialize(): void {
    // 注意：不再自动同步localStorage到cookie
    // 语言状态应优先使用URL路径，避免SSR/CSR不一致
    // 如果需要迁移旧数据，可以手动调用syncFromLocalStorage()
  }

  /**
   * 获取统一语言（服务端使用）
   */
  static getUnifiedLocale(
    cookieLocale?: string | null,
    routeLocale?: string,
  ): string {
    return getLocaleFromCookies(cookieLocale, routeLocale);
  }
}

// 导出默认实例
export default CookieManager;
