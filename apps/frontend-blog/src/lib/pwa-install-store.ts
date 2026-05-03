'use client';

import type { BeforeInstallPromptEvent } from '@/types/pwa';

/**
 * PWA 安装状态共享存储
 *
 * 背景: beforeinstallprompt 事件是浏览器在页面加载早期触发的单次事件。
 * 由于 InstallPrompt 组件通过 dynamic(() => import(...), { ssr: false }) 懒加载，
 * 组件挂载时事件已经触发完毕，导致 usePWA hook 中的事件监听器错过该事件。
 *
 * 解决方案:
 * - PwaComponents (静态导入) 提前注册 beforeinstallprompt 监听器
 * - 将 deferredPrompt 存储在此模块级 store 中
 * - usePWA hook 初始化时从此 store 读取已捕获的事件
 */
let deferredPrompt: BeforeInstallPromptEvent | null = null;
let isInstallable = false;

/**
 * 获取当前存储的安装状态
 */
export function getInstallState(): {
  deferredPrompt: BeforeInstallPromptEvent | null;
  isInstallable: boolean;
} {
  return { deferredPrompt, isInstallable };
}

/**
 * 设置安装状态 (由 PwaComponents 在捕获 beforeinstallprompt 事件时调用)
 */
export function setInstallState(
  prompt: BeforeInstallPromptEvent | null,
  installable: boolean,
): void {
  deferredPrompt = prompt;
  isInstallable = installable;
}

/**
 * 清除安装状态
 */
export function clearInstallState(): void {
  deferredPrompt = null;
  isInstallable = false;
}
