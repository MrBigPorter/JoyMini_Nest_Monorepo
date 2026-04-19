/**
 * Server平台适配器
 * 适用于服务端渲染环境
 */

import type { IPlatformAdapter } from '../types';

/**
 * 创建Server平台适配器
 */
export function createServerAdapter(): IPlatformAdapter {
  return {
    platform: 'server',
    version: '1.0.0',

    query: {
      buildQueryKey: (baseKey) => ['server', ...baseKey],
      getStaleTime: () => 0, // 服务端不缓存
      getGcTime: () => 0,
      supportsBackgroundRefetch: () => false,
      getRetryConfig: () => ({
        retry: 0, // 服务端不重试
        retryDelay: () => 0,
      }),
      getDefaultQueryOptions: () => ({}),
    },

    network: {
      executeAction: async <T>(action: () => Promise<T>) => {
        // 服务端直接执行
        return await action();
      },
      executeActionWithFallback: async <T>(
        action: () => Promise<T>,
        fallback: () => Promise<T>,
      ) => {
        try {
          return await action();
        } catch (error) {
          console.warn('Server Action失败:', error);
          return await fallback();
        }
      },
      supportsServerActions: () => true,
      getNetworkStatus: () => 'online',
      addNetworkStatusListener: () => () => {},
    },

    cache: {
      getStrategy: () => ({
        type: 'memory',
        ttl: 5 * 60 * 1000, // 5分钟
        maxSize: 1000,
      }),
      supportsPersistentCache: () => false,
      getCacheVersion: () => 'v1',
      clearCache: async () => {
        // 服务端缓存清理逻辑
      },
    },

    storage: {
      get: async () => null,
      set: async () => {},
      remove: async () => {},
      clear: async () => {},
    },

    navigation: {
      goTo: () => {},
      back: () => {},
      getCurrentRoute: () => ({ path: '/', query: {} }),
      prefetch: async () => {},
    },

    device: {
      getInfo: () => ({
        platform: 'server',
        isMobile: false,
        isTablet: false,
        isDesktop: true,
        os: 'server',
        browser: 'server',
        screenSize: { width: 0, height: 0 },
      }),
      supportsPush: () => false,
      supportsCamera: () => false,
      supportsGeolocation: () => false,
      getDeviceId: async () => 'server',
    },

    logger: {
      info: (message: string, data?: unknown) => {
        console.log(`[Server Platform] ${message}`, data || '');
      },
      warn: (message: string, data?: unknown) => {
        console.warn(`[Server Platform] ${message}`, data || '');
      },
      error: (message: string, data?: unknown) => {
        console.error(`[Server Platform] ${message}`, data || '');
      },
      debug: (message: string, data?: unknown) => {
        console.debug(`[Server Platform] ${message}`, data || '');
      },
    },
  };
}
