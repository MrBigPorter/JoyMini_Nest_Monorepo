/**
 * Web平台适配器
 * 适用于桌面和移动Web浏览器环境
 */

import type { IPlatformAdapter } from '../types';

/**
 * 创建Web平台适配器
 */
export function createWebAdapter(): IPlatformAdapter {
  return {
    platform: 'web',
    version: '1.0.0',

    query: {
      buildQueryKey: (baseKey) => ['web', ...baseKey],
      getStaleTime: () => 60 * 1000, // 1分钟
      getGcTime: () => 5 * 60 * 1000, // 5分钟
      supportsBackgroundRefetch: () => true,
      getRetryConfig: () => ({
        retry: 3,
        retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
      }),
      getDefaultQueryOptions: () => ({
        platformOptions: {
          useCacheWhenOffline: true,
          degradeOnSlowNetwork: true,
          prefetch: true,
        },
      }),
    },

    network: {
      executeAction: async <T>(action: () => Promise<T>) => {
        // Web端直接执行Server Action
        return await action();
      },
      executeActionWithFallback: async <T>(
        action: () => Promise<T>,
        fallback: () => Promise<T>,
      ) => {
        try {
          return await action();
        } catch (error) {
          console.warn('Server Action失败，降级到fallback:', error);
          return await fallback();
        }
      },
      supportsServerActions: () => true,
      getNetworkStatus: () => {
        if (typeof navigator === 'undefined') return 'online';
        return navigator.onLine ? 'online' : 'offline';
      },
      addNetworkStatusListener: (callback) => {
        if (typeof window === 'undefined') return () => {};

        const handleOnline = () => callback('online');
        const handleOffline = () => callback('offline');

        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);

        return () => {
          window.removeEventListener('online', handleOnline);
          window.removeEventListener('offline', handleOffline);
        };
      },
    },

    cache: {
      getStrategy: () => ({
        type: 'hybrid',
        ttl: 24 * 60 * 60 * 1000, // 24小时
        maxSize: 100,
      }),
      supportsPersistentCache: () => {
        if (typeof window === 'undefined') return false;
        try {
          return 'localStorage' in window && window.localStorage !== null;
        } catch {
          return false;
        }
      },
      getCacheVersion: () => 'v1',
      clearCache: async () => {
        if (typeof window === 'undefined') return;
        try {
          localStorage.clear();
        } catch (error) {
          console.warn('清除缓存失败:', error);
        }
      },
    },

    storage: {
      get: async (key: string) => {
        if (typeof window === 'undefined') return null;
        try {
          return localStorage.getItem(key);
        } catch {
          return null;
        }
      },
      set: async (key: string, value: string) => {
        if (typeof window === 'undefined') return;
        try {
          localStorage.setItem(key, value);
        } catch (error) {
          console.warn('存储设置失败:', error);
        }
      },
      remove: async (key: string) => {
        if (typeof window === 'undefined') return;
        try {
          localStorage.removeItem(key);
        } catch (error) {
          console.warn('存储删除失败:', error);
        }
      },
      clear: async () => {
        if (typeof window === 'undefined') return;
        try {
          localStorage.clear();
        } catch (error) {
          console.warn('存储清空失败:', error);
        }
      },
    },

    navigation: {
      goTo: (
        url: string,
        options?: { replace?: boolean; scroll?: boolean; prefetch?: boolean },
      ) => {
        if (typeof window === 'undefined') return;

        if (options?.replace) {
          window.location.replace(url);
        } else {
          window.location.href = url;
        }
      },
      back: () => {
        if (typeof window === 'undefined') return;
        window.history.back();
      },
      getCurrentRoute: () => {
        if (typeof window === 'undefined') {
          return { path: '/', query: {} };
        }

        const url = new URL(window.location.href);
        return {
          path: url.pathname,
          query: Object.fromEntries(url.searchParams.entries()),
          hash: url.hash || undefined,
        };
      },
      prefetch: async (url: string) => {
        // Web平台可以使用link rel="prefetch"
        if (typeof document === 'undefined') return;

        const link = document.createElement('link');
        link.rel = 'prefetch';
        link.href = url;
        link.as = 'document';
        document.head.appendChild(link);
      },
    },

    device: {
      getInfo: () => {
        // 这里应该调用getDeviceInfo，但为了避免循环依赖，我们简化实现
        if (typeof window === 'undefined') {
          return {
            platform: 'web',
            isMobile: false,
            isTablet: false,
            isDesktop: true,
            os: 'unknown',
            browser: 'unknown',
            screenSize: { width: 0, height: 0 },
          };
        }

        const userAgent = window.navigator.userAgent.toLowerCase();
        const isMobile = /mobile|android|iphone|ipad|ipod|windows phone/i.test(
          userAgent,
        );
        const isTablet =
          /tablet|ipad/i.test(userAgent) && !/mobile/i.test(userAgent);
        const isDesktop = !isMobile && !isTablet;

        return {
          platform: 'web',
          isMobile,
          isTablet,
          isDesktop,
          os: 'unknown',
          browser: 'unknown',
          screenSize: {
            width: window.innerWidth,
            height: window.innerHeight,
          },
        };
      },
      supportsPush: () => {
        if (typeof window === 'undefined') return false;
        return 'Notification' in window && 'serviceWorker' in navigator;
      },
      supportsCamera: () => {
        if (typeof navigator === 'undefined') return false;
        return 'mediaDevices' in navigator;
      },
      supportsGeolocation: () => {
        if (typeof navigator === 'undefined') return false;
        return 'geolocation' in navigator;
      },
      getDeviceId: async () => {
        // 简化实现：使用localStorage存储设备ID
        if (typeof window === 'undefined') return 'server';

        const key = 'device_id';
        let deviceId = localStorage.getItem(key);

        if (!deviceId) {
          deviceId = `web_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
          localStorage.setItem(key, deviceId);
        }

        return deviceId;
      },
    },

    logger: {
      info: (message: string, data?: unknown) => {
        console.log(`[Web Platform] ${message}`, data || '');
      },
      warn: (message: string, data?: unknown) => {
        console.warn(`[Web Platform] ${message}`, data || '');
      },
      error: (message: string, data?: unknown) => {
        console.error(`[Web Platform] ${message}`, data || '');
      },
      debug: (message: string, data?: unknown) => {
        console.debug(`[Web Platform] ${message}`, data || '');
      },
    },
  };
}
