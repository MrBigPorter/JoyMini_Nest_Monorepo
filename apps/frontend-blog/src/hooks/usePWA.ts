'use client';

import { useState, useEffect, useCallback } from 'react';
import type { UsePWAReturn, BeforeInstallPromptEvent } from '@/types/pwa';
import { getInstallState, clearInstallState } from '@/lib/pwa-install-store';

/**
 * PWA功能Hook
 * 处理安装提示、离线状态、更新检查等PWA相关功能
 *
 * 注意: beforeinstallprompt 事件监听器已在 PwaComponents 中提前注册
 * (因为 InstallPrompt 通过 dynamic() 懒加载，会错过该事件)。
 * usePWA 初始化时从共享 store (pwa-install-store) 读取已捕获的事件。
 */
export function usePWA(): UsePWAReturn {
  const [isInstallable, setIsInstallable] = useState(false);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isOffline, setIsOffline] = useState(false);
  const [isUpdateAvailable, setIsUpdateAvailable] = useState(false);
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);

  // 检查是否已安装为PWA
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const checkInstalled = () => {
      const isStandalone = window.matchMedia(
        '(display-mode: standalone)',
      ).matches;
      const isInWebView =
        navigator.userAgent.includes('wv') ||
        navigator.userAgent.includes('Android');
      setIsInstalled(isStandalone || isInWebView);
    };

    checkInstalled();

    // 监听display-mode变化
    const mediaQuery = window.matchMedia('(display-mode: standalone)');
    const handleChange = () => setIsInstalled(mediaQuery.matches);
    mediaQuery.addEventListener('change', handleChange);

    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  // 从共享 store 读取 PwaComponents 提前捕获的 beforeinstallprompt 事件
  // InstallPrompt 通过 dynamic() 懒加载，挂载时浏览器可能已触发该事件
  // PwaComponents (静态导入) 已提前注册监听器并将事件存入 store
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const state = getInstallState();
    if (state.isInstallable && state.deferredPrompt) {
      setDeferredPrompt(state.deferredPrompt);
      setIsInstallable(true);
    }
  }, []);

  // 监听离线状态
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);

    setIsOffline(!navigator.onLine);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // 检查Service Worker更新
  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator))
      return;

    let activeRegistration: ServiceWorkerRegistration | null = null;

    const checkForUpdates = async () => {
      try {
        const reg = await navigator.serviceWorker.getRegistration();
        activeRegistration = reg ?? null;
        if (reg?.waiting) {
          setIsUpdateAvailable(true);
        }
      } catch (error) {
        console.warn('检查Service Worker更新失败:', error);
      }
    };

    // 监听Service Worker控制权变化
    const handleControllerChange = () => {
      checkForUpdates();
    };

    // 监听updatefound事件（当registration.update()发现新SW时触发）
    const handleUpdateFound = () => {
      if (activeRegistration?.waiting) {
        setIsUpdateAvailable(true);
      }
    };

    navigator.serviceWorker.addEventListener(
      'controllerchange',
      handleControllerChange,
    );

    checkForUpdates().then(() => {
      if (activeRegistration) {
        activeRegistration.addEventListener('updatefound', handleUpdateFound);
      }
    });

    return () => {
      navigator.serviceWorker.removeEventListener(
        'controllerchange',
        handleControllerChange,
      );
      if (activeRegistration) {
        activeRegistration.removeEventListener(
          'updatefound',
          handleUpdateFound,
        );
      }
    };
  }, []);

  // 显示安装提示
  const showInstallPrompt = useCallback(async () => {
    if (!deferredPrompt) return;

    try {
      await deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;

      if (outcome === 'accepted') {
        console.log('用户接受了PWA安装提示');
        setIsInstallable(false);
      } else {
        console.log('用户拒绝了PWA安装提示');
      }

      setDeferredPrompt(null);
    } catch (error) {
      console.error('显示安装提示失败:', error);
    }
  }, [deferredPrompt]);

  // 检查更新
  const checkForUpdates = useCallback(async () => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator))
      return;

    try {
      const registration = await navigator.serviceWorker.getRegistration();
      if (registration) {
        await registration.update();
        console.log('Service Worker更新检查完成');
      }
    } catch (error) {
      console.warn('检查更新失败:', error);
    }
  }, []);

  // 跳过等待，立即激活新版本
  const skipWaiting = useCallback(async () => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator))
      return;

    try {
      const registration = await navigator.serviceWorker.getRegistration();
      if (registration?.waiting) {
        registration.waiting.postMessage({ type: 'SKIP_WAITING' });
        setIsUpdateAvailable(false);
        console.log('已跳过等待，立即激活新版本');
      }
    } catch (error) {
      console.error('跳过等待失败:', error);
    }
  }, []);

  // 清除延迟的安装提示
  const clearDeferredPrompt = useCallback(() => {
    setDeferredPrompt(null);
    setIsInstallable(false);
    clearInstallState();
  }, []);

  return {
    isInstallable,
    isInstalled,
    isOffline,
    isUpdateAvailable,
    deferredPrompt,
    showInstallPrompt,
    checkForUpdates,
    skipWaiting,
    clearDeferredPrompt,
  };
}
