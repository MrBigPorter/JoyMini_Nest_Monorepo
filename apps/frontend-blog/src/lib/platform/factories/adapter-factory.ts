/**
 * 平台适配器工厂
 * 负责创建和管理平台适配器实例
 */

import type { IPlatformAdapter, PlatformType } from '../types';
import { detectPlatform } from '../detectors/runtime.detector';

/** 适配器实例缓存 */
const adapterCache = new Map<PlatformType, IPlatformAdapter>();

/**
 * 获取当前平台的适配器
 */
export function getPlatformAdapter(): IPlatformAdapter {
  const platform = detectPlatform();
  
  // 检查缓存
  if (adapterCache.has(platform)) {
    return adapterCache.get(platform)!;
  }
  
  // 创建适配器
  let adapter: IPlatformAdapter;
  
  switch (platform) {
    case 'web':
      adapter = createWebAdapter();
      break;
    case 'h5':
      adapter = createH5Adapter();
      break;
    case 'capacitor':
      adapter = createCapacitorAdapter();
      break;
    case 'server':
      adapter = createServerAdapter();
      break;
    default:
      throw new Error(`Unsupported platform: ${platform}`);
  }
  
  // 缓存适配器
  adapterCache.set(platform, adapter);
  
  return adapter;
}

/**
 * 创建Web平台适配器
 */
function createWebAdapter(): IPlatformAdapter {
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
        fallback: () => Promise<T>
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
      goTo: (url: string, options?: { replace?: boolean; scroll?: boolean; prefetch?: boolean }) => {
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
        const isMobile = /mobile|android|iphone|ipad|ipod|windows phone/i.test(userAgent);
        const isTablet = /tablet|ipad/i.test(userAgent) && !/mobile/i.test(userAgent);
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
      info: (message: string, data?: any) => {
        console.log(`[Web Platform] ${message}`, data || '');
      },
      warn: (message: string, data?: any) => {
        console.warn(`[Web Platform] ${message}`, data || '');
      },
      error: (message: string, data?: any) => {
        console.error(`[Web Platform] ${message}`, data || '');
      },
      debug: (message: string, data?: any) => {
        console.debug(`[Web Platform] ${message}`, data || '');
      },
    },
  };
}

/**
 * 创建H5平台适配器
 */
function createH5Adapter(): IPlatformAdapter {
  const webAdapter = createWebAdapter();
  
  return {
    ...webAdapter,
    platform: 'h5',
    version: '1.0.0',
    
    query: {
      ...webAdapter.query,
      buildQueryKey: (baseKey) => ['h5', ...baseKey],
      getStaleTime: () => 30 * 1000, // H5端缓存时间更短
      getGcTime: () => 3 * 60 * 1000, // 3分钟
    },
    
    device: {
      ...webAdapter.device,
      getInfo: () => {
        const info = webAdapter.device.getInfo();
        return {
          ...info,
          platform: 'h5' as const,
        };
      },
    },
    
    logger: {
      info: (message: string, data?: any) => {
        console.log(`[H5 Platform] ${message}`, data || '');
      },
      warn: (message: string, data?: any) => {
        console.warn(`[H5 Platform] ${message}`, data || '');
      },
      error: (message: string, data?: any) => {
        console.error(`[H5 Platform] ${message}`, data || '');
      },
      debug: (message: string, data?: any) => {
        console.debug(`[H5 Platform] ${message}`, data || '');
      },
    },
  };
}

/**
 * 创建Capacitor App平台适配器
 */
function createCapacitorAdapter(): IPlatformAdapter {
  const webAdapter = createWebAdapter();
  
  return {
    ...webAdapter,
    platform: 'capacitor',
    version: '1.0.0',
    
    query: {
      ...webAdapter.query,
      buildQueryKey: (baseKey) => ['capacitor', ...baseKey],
      getStaleTime: () => 2 * 60 * 1000, // 2分钟
      getGcTime: () => 10 * 60 * 1000, // 10分钟
      supportsBackgroundRefetch: () => false, // App端后台刷新有限制
    },
    
    network: {
      ...webAdapter.network,
      supportsServerActions: () => false, // App端不支持Server Actions
    },
    
    cache: {
      ...webAdapter.cache,
      supportsPersistentCache: () => true, // App端支持持久化缓存
    },
    
    device: {
      ...webAdapter.device,
      getInfo: () => {
        const info = webAdapter.device.getInfo();
        return {
          ...info,
          platform: 'capacitor' as const,
        };
      },
      supportsPush: () => true, // App端支持推送
      supportsCamera: () => true, // App端支持相机
      supportsGeolocation: () => true, // App端支持地理位置
    },
    
    logger: {
      info: (message: string, data?: any) => {
        console.log(`[Capacitor Platform] ${message}`, data || '');
      },
      warn: (message: string, data?: any) => {
        console.warn(`[Capacitor Platform] ${message}`, data || '');
      },
      error: (message: string, data?: any) => {
        console.error(`[Capacitor Platform] ${message}`, data || '');
      },
      debug: (message: string, data?: any) => {
        console.debug(`[Capacitor Platform] ${message}`, data || '');
      },
    },
  };
}

/**
 * 创建Server平台适配器
 */
function createServerAdapter(): IPlatformAdapter {
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
        fallback: () => Promise<T>
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
      info: (message: string, data?: any) => {
        console.log(`[Server Platform] ${message}`, data || '');
      },
      warn: (message: string, data?: any) => {
        console.warn(`[Server Platform] ${message}`, data || '');
      },
      error: (message: string, data?: any) => {
        console.error(`[Server Platform] ${message}`, data || '');
      },
      debug: (message: string, data?: any) => {
        console.debug(`[Server Platform] ${message}`, data || '');
      },
    },
  };
}

/**
 * 清除适配器缓存（用于测试）
 */
export function clearAdapterCache(): void {
  adapterCache.clear();
}

// ================= 导出 =================

// 注意：函数已经在顶部声明为export，这里不需要重复导出
