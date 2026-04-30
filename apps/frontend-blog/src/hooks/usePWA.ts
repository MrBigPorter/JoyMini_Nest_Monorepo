'use client';

import { useState, useEffect, useCallback } from 'react';
import type { UsePWAReturn, BeforeInstallPromptEvent } from '@/types/pwa';

/**
 * PWA功能Hook
 * 处理安装提示、离线状态、更新检查等PWA相关功能
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

  // 监听安装提示事件
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      // 检查用户是否已选择不再显示安装提示
      const hidden = localStorage.getItem('pwa_install_prompt_hidden');
      if (hidden === 'true') return;
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setIsInstallable(true);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    return () => {
      window.removeEventListener(
        'beforeinstallprompt',
        handleBeforeInstallPrompt,
      );
    };
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
