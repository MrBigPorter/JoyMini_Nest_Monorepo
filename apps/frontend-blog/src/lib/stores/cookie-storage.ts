/**
 * Cookie存储适配器
 * 实现Zustand的StateStorage接口，用于将状态持久化到Cookie
 * 与语言设置保持一致的存储策略
 */

import { getTokenCookie } from '@/lib/utils/cookie-manager';

/**
 * Zustand StateStorage接口实现
 * 将状态存储到Cookie中，支持JSON序列化
 */
export const cookieStorage: import('zustand/middleware').StateStorage = {
  /**
   * 从Cookie获取存储的状态
   */
  getItem: (name: string): string | null => {
    if (typeof document === 'undefined') {
      return null;
    }

    try {
      // 从Cookie中读取存储的数据
      const match = document.cookie.match(new RegExp(`(^| )${name}=([^;]+)`));
      if (!match) {
        return null;
      }

      const cookieValue = decodeURIComponent(match[2]);

      // 检查是否是JSON格式（Zustand存储格式）
      try {
        const parsed = JSON.parse(cookieValue);
        // 如果是对象，说明是Zustand的存储格式
        if (parsed && typeof parsed === 'object') {
          return cookieValue;
        }
      } catch {
        // 如果不是JSON，可能是旧格式的原始token
        // 尝试从getTokenCookie获取兼容性支持
        const tokenValue = getTokenCookie();
        if (tokenValue) {
          // 转换为Zustand存储格式
          const state = {
            state: {
              accessToken: tokenValue,
              refreshToken: null,
              user: null,
            },
            version: 0,
          };
          return JSON.stringify(state);
        }
        return null;
      }

      return cookieValue;
    } catch (error) {
      console.warn(`Failed to get item from cookie storage (${name}):`, error);
      return null;
    }
  },

  /**
   * 将状态存储到Cookie中
   */
  setItem: (name: string, value: string): void => {
    if (typeof document === 'undefined') {
      return;
    }

    try {
      // 解析Zustand存储的数据
      const parsed = JSON.parse(value);

      // 提取accessToken（如果有）
      const accessToken = parsed?.state?.accessToken;

      if (accessToken && typeof accessToken === 'string') {
        // 存储完整的Zustand状态到Cookie
        const encodedValue = encodeURIComponent(value);
        document.cookie = `${name}=${encodedValue}; path=/; max-age=86400; SameSite=Lax`;
      } else {
        // 如果没有accessToken，可能是登出操作
        // 清除Cookie
        document.cookie = `${name}=; path=/; max-age=0; SameSite=Lax`;
      }
    } catch (error) {
      console.warn(`Failed to set item to cookie storage (${name}):`, error);
    }
  },

  /**
   * 从Cookie中移除状态
   */
  removeItem: (name: string): void => {
    if (typeof document === 'undefined') {
      return;
    }

    try {
      // 清除Zustand状态Cookie
      document.cookie = `${name}=; path=/; max-age=0; SameSite=Lax`;
    } catch (error) {
      console.warn(
        `Failed to remove item from cookie storage (${name}):`,
        error,
      );
    }
  },
};

/**
 * 检查Cookie存储是否可用
 */
export const isCookieStorageAvailable = (): boolean => {
  if (typeof document === 'undefined') {
    return false;
  }

  try {
    // 测试Cookie功能
    const testKey = 'test_cookie_storage';
    const testValue = 'test_value';

    // 尝试设置和读取Cookie
    document.cookie = `${testKey}=${testValue}; path=/; max-age=60; SameSite=Lax`;
    const hasCookie = document.cookie.includes(testKey);

    // 清理测试Cookie
    document.cookie = `${testKey}=; path=/; max-age=0`;

    return hasCookie;
  } catch (error) {
    console.warn('Cookie storage test failed:', error);
    return false;
  }
};

/**
 * 获取当前存储的认证状态（简化版本）
 * 用于快速检查认证状态，不依赖Zustand
 */
export const getAuthStateFromCookie = (): {
  accessToken: string | null;
  isAuthenticated: boolean;
} => {
  const token = getTokenCookie();
  return {
    accessToken: token,
    isAuthenticated: !!token,
  };
};

export default cookieStorage;
