'use client';

import { useState, useEffect } from 'react';

/**
 * 离线状态Hook
 * 检测网络连接状态，提供离线/在线状态
 */
export function useOffline() {
  const [isOffline, setIsOffline] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleOnline = () => {
      setIsOffline(false);
      console.log('Network connection restored');
    };

    const handleOffline = () => {
      setIsOffline(true);
      console.warn('Network connection lost');
    };

    // 初始状态
    setIsOffline(!navigator.onLine);

    // 监听网络状态变化
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return isOffline;
}

/**
 * 离线缓存状态Hook
 * 检查Service Worker是否已注册并准备好离线缓存
 */
export function useOfflineCache() {
  const [isCacheReady, setIsCacheReady] = useState(false);
  const [cacheSize, setCacheSize] = useState<number | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
      return;
    }

    const checkCacheStatus = async () => {
      try {
        const registration = await navigator.serviceWorker.getRegistration();
        if (registration?.active) {
          setIsCacheReady(true);

          // 尝试获取缓存信息
          if ('caches' in window) {
            const cache = await caches.open('pages-cache');
            const keys = await cache.keys();
            setCacheSize(keys.length);
          }
        }
      } catch (error) {
        console.warn('检查离线缓存状态失败:', error);
      }
    };

    checkCacheStatus();

    // 监听Service Worker状态变化
    const handleControllerChange = () => {
      checkCacheStatus();
    };

    navigator.serviceWorker.addEventListener(
      'controllerchange',
      handleControllerChange,
    );

    return () => {
      navigator.serviceWorker.removeEventListener(
        'controllerchange',
        handleControllerChange,
      );
    };
  }, []);

  return { isCacheReady, cacheSize };
}
