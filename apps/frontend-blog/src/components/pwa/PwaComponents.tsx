'use client';

import { useEffect } from 'react';
import dynamic from 'next/dynamic';
import { setInstallState } from '@/lib/pwa-install-store';

// PWA 组件仅在客户端加载，SSR 时跳过以减少 CPU 时间
// 使用 then() 提取 named export，因为组件使用 export function 而非 export default
// 此包装器是 'use client' 组件，因为 Next.js 15 不允许在 Server Component 中使用 ssr:false
const InstallPrompt = dynamic(
  () =>
    import('@/components/pwa/InstallPrompt').then((mod) => mod.InstallPrompt),
  { ssr: false },
);

const OfflineIndicator = dynamic(
  () =>
    import('@/components/pwa/OfflineIndicator').then(
      (mod) => mod.OfflineIndicator,
    ),
  { ssr: false },
);

const UpdateAvailable = dynamic(
  () =>
    import('@/components/pwa/UpdateAvailable').then(
      (mod) => mod.UpdateAvailable,
    ),
  { ssr: false },
);

export interface PwaComponentsProps {
  installPromptDelay?: number;
  installPromptAutoHideDelay?: number;
  offlineIndicatorPosition?: 'top' | 'bottom';
  offlineIndicatorShowRetryButton?: boolean;
  offlineIndicatorAutoHideDelay?: number;
  updateAvailableCheckInterval?: number;
  updateAvailableShowCloseButton?: boolean;
  updateAvailableAutoShowDelay?: number;
}

export default function PwaComponents({
  installPromptDelay = 5000,
  installPromptAutoHideDelay = 15000,
  offlineIndicatorPosition = 'top',
  offlineIndicatorShowRetryButton = true,
  offlineIndicatorAutoHideDelay = 3000,
  updateAvailableCheckInterval = 3600000,
  updateAvailableShowCloseButton = true,
  updateAvailableAutoShowDelay = 5000,
}: PwaComponentsProps) {
  // 提前注册 beforeinstallprompt 事件监听器
  // InstallPrompt 组件通过 dynamic() 懒加载，挂载时浏览器可能已触发该事件
  // 此处 PwaComponents 是静态导入，能更早注册监听器，确保不错过事件
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      // 检查用户是否已选择不再显示安装提示
      const hidden = localStorage.getItem('pwa_install_prompt_hidden');
      if (hidden === 'true') return;
      setInstallState(e as any, true);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    return () => {
      window.removeEventListener(
        'beforeinstallprompt',
        handleBeforeInstallPrompt,
      );
    };
  }, []);

  return (
    <>
      <InstallPrompt
        delay={installPromptDelay}
        autoHideDelay={installPromptAutoHideDelay}
      />
      <OfflineIndicator
        position={offlineIndicatorPosition}
        showRetryButton={offlineIndicatorShowRetryButton}
        autoHideDelay={offlineIndicatorAutoHideDelay}
      />
      <UpdateAvailable
        checkInterval={updateAvailableCheckInterval}
        showCloseButton={updateAvailableShowCloseButton}
        autoShowDelay={updateAvailableAutoShowDelay}
      />
    </>
  );
}
