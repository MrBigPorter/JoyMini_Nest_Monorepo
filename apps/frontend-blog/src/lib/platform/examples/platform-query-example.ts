/**
 * 平台适配器使用示例
 * 展示如何使用平台感知的React Query Hooks
 */

import { usePlatformQuery, usePlatformMutation } from '../hooks/usePlatformQuery';
import { getPlatformAdapter } from '../factories/adapter-factory';

// 示例1: 使用平台感知的Query Hook获取文章列表
export function useArticlesQuery() {
  return usePlatformQuery({
    queryKey: ['articles'],
    apiCall: async () => {
      // 这是所有平台都支持的API调用
      const response = await fetch('/api/articles');
      if (!response.ok) {
        throw new Error('Failed to fetch articles');
      }
      return response.json();
    },
    serverAction: async () => {
      // 这是支持Server Actions的平台使用的函数
      // 在Next.js 15中，这可以是一个Server Action
      // 在其他平台中，会自动降级到API调用
      // 注意：这是一个示例，实际使用时需要替换为真实的Server Action
      // const { getArticles } = await import('@/app/actions/articles');
      // return await getArticles();
      
      // 示例：模拟Server Action
      return { articles: [], total: 0 };
    },
    platformOptions: {
      useCacheWhenOffline: true,
      degradeOnSlowNetwork: true,
    },
  });
}

// 示例2: 使用平台感知的Mutation Hook创建文章
export function useCreateArticleMutation() {
  return usePlatformMutation<{ id: number; title: string; content: string; createdAt: string }, { title: string; content: string }>({
    apiCall: async (articleData) => {
      const response = await fetch('/api/articles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(articleData),
      });
      if (!response.ok) {
        throw new Error('Failed to create article');
      }
      return response.json();
    },
    serverAction: async (articleData) => {
      // 注意：这是一个示例，实际使用时需要替换为真实的Server Action
      // const { createArticle } = await import('@/app/actions/articles');
      // return await createArticle(articleData);
      
      // 示例：模拟Server Action
      return { 
        id: Date.now(), 
        title: articleData.title, 
        content: articleData.content, 
        createdAt: new Date().toISOString() 
      };
    },
    onSuccess: (data, variables) => {
      // 成功回调
      console.log('Article created successfully:', data);
      
      // 获取平台适配器进行平台特定的操作
      const adapter = getPlatformAdapter();
      adapter.logger.info('Article created', { id: data.id });
      
      // 如果是Web平台，可以显示通知
      if (adapter.platform === 'web') {
        // 显示Web通知
        if (adapter.device.supportsPush()) {
          // 可以发送推送通知
        }
      }
    },
    platformOptions: {
      queueWhenOffline: true,
      showLoading: true,
    },
  });
}

// 示例3: 使用平台适配器获取设备信息
export function useDeviceInfo() {
  const adapter = getPlatformAdapter();
  const deviceInfo = adapter.device.getInfo();
  
  return {
    isMobile: deviceInfo.isMobile,
    isTablet: deviceInfo.isTablet,
    isDesktop: deviceInfo.isDesktop,
    platform: deviceInfo.platform,
    os: deviceInfo.os,
    browser: deviceInfo.browser,
    screenSize: deviceInfo.screenSize,
  };
}

// 示例4: 平台感知的Server Action执行器
export async function executePlatformServerAction<T>(
  action: () => Promise<T>,
  fallback?: () => Promise<T>
): Promise<T> {
  const adapter = getPlatformAdapter();
  
  // 检查是否支持Server Actions
  if (adapter.network.supportsServerActions()) {
    try {
      return await adapter.network.executeAction(action);
    } catch (error) {
      adapter.logger.warn('Server Action failed, falling back to API', error);
      if (fallback) {
        return await fallback();
      }
      throw error;
    }
  }
  
  // 不支持Server Actions，使用fallback或抛出错误
  if (fallback) {
    return await fallback();
  }
  
  throw new Error('Server Actions not supported on this platform');
}

// 示例5: 平台感知的缓存管理
export async function clearPlatformCache() {
  const adapter = getPlatformAdapter();
  
  // 清除平台缓存
  await adapter.cache.clearCache();
  
  // 如果是Web平台，还可以清除浏览器缓存
  if (adapter.platform === 'web') {
    if ('caches' in window) {
      const cacheNames = await caches.keys();
      await Promise.all(cacheNames.map(name => caches.delete(name)));
    }
  }
  
  adapter.logger.info('Platform cache cleared');
}

// 示例6: 平台感知的网络状态监听
export function useNetworkStatus() {
  const adapter = getPlatformAdapter();
  const [status, setStatus] = useState(adapter.network.getNetworkStatus());
  
  useEffect(() => {
    // 添加网络状态监听器
    const removeListener = adapter.network.addNetworkStatusListener((newStatus) => {
      setStatus(newStatus);
    });
    
    return () => {
      removeListener();
    };
  }, [adapter]);
  
  return {
    isOnline: status === 'online',
    isOffline: status === 'offline',
    isSlow: status === 'slow',
    status,
  };
}

// 示例7: 平台感知的Query Key构建
export function buildPlatformQueryKey(baseKey: string[]) {
  const adapter = getPlatformAdapter();
  const platformKey = adapter.query.buildQueryKey(baseKey);
  
  // 添加语言信息（如果需要）
  const locale = typeof window !== 'undefined' 
    ? localStorage.getItem('locale') || 'zh'
    : 'zh';
  
  return [...platformKey, locale];
}

// 示例8: 平台特定的配置获取
export function getPlatformConfig() {
  const adapter = getPlatformAdapter();
  
  return {
    // Query配置
    query: {
      staleTime: adapter.query.getStaleTime(),
      gcTime: adapter.query.getGcTime(),
      retryConfig: adapter.query.getRetryConfig(),
    },
    
    // 缓存配置
    cache: {
      strategy: adapter.cache.getStrategy(),
      supportsPersistent: adapter.cache.supportsPersistentCache(),
      version: adapter.cache.getCacheVersion(),
    },
    
    // 网络配置
    network: {
      supportsServerActions: adapter.network.supportsServerActions(),
    },
    
    // 设备能力
    device: {
      supportsPush: adapter.device.supportsPush(),
      supportsCamera: adapter.device.supportsCamera(),
      supportsGeolocation: adapter.device.supportsGeolocation(),
    },
  };
}

// 注意：在实际使用中，需要导入React
import { useState, useEffect } from 'react';