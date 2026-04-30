'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@repo/ui/button';
import { X } from 'lucide-react';
import { usePWA } from '@/hooks/usePWA';

interface InstallPromptProps {
  /**
   * 延迟显示时间（毫秒）
   * @default 3000
   */

  delay?: number;
  /**
   * 自动隐藏时间（毫秒，0表示不自动隐藏）
   * @default 10000
   */
  autoHideDelay?: number;
  /**
   * 自定义提示文本
   */
  customMessage?: string;
  /**
   * 是否显示关闭按钮
   * @default true
   */
  showCloseButton?: boolean;
}

/**
 * PWA安装提示组件
 * 当应用满足PWA安装条件时显示安装提示
 */
export function InstallPrompt({
  delay = 3000,
  autoHideDelay = 10000,
  customMessage,
  showCloseButton = true,
}: InstallPromptProps) {
  const t = useTranslations('pwa.install');
  const { isInstallable, isInstalled, showInstallPrompt, clearDeferredPrompt } =
    usePWA();
  const [isVisible, setIsVisible] = useState(false);
  const [isClosing, setIsClosing] = useState(false);

  useEffect(() => {
    if (!isInstallable || isInstalled) {
      setIsVisible(false);
      return;
    }

    // 延迟显示，避免立即干扰用户
    const timer = setTimeout(() => {
      setIsVisible(true);
    }, delay);

    return () => clearTimeout(timer);
  }, [isInstallable, isInstalled, delay]);

  useEffect(() => {
    if (!isVisible || autoHideDelay === 0) return;

    // 自动隐藏提示
    const timer = setTimeout(() => {
      handleClose();
    }, autoHideDelay);

    return () => clearTimeout(timer);
  }, [isVisible, autoHideDelay]);

  const handleInstall = async () => {
    try {
      await showInstallPrompt();
      handleClose();
    } catch (error) {
      console.error('安装失败:', error);
    }
  };

  const handleClose = () => {
    setIsClosing(true);
    clearDeferredPrompt();

    // 添加关闭动画
    setTimeout(() => {
      setIsVisible(false);
      setIsClosing(false);
    }, 300);
  };

  const handleDontShowAgain = () => {
    // 将用户选择存储到localStorage（usePWA hook中的beforeinstallprompt事件会检查此标记）
    localStorage.setItem('pwa_install_prompt_hidden', 'true');
    handleClose();
  };

  if (!isVisible) return null;

  const message = customMessage || t('message');

  return (
    <div
      className={`
        fixed bottom-4 right-4 left-4 md:left-auto md:max-w-md
        bg-gradient-to-r from-blue-500 to-purple-600
        text-white rounded-xl shadow-2xl p-4
        transform transition-all duration-300 ease-out
        ${isClosing ? 'translate-y-full opacity-0' : 'translate-y-0 opacity-100'}
        z-50
      `}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 bg-white/20 rounded-lg flex items-center justify-center">
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-11a1 1 0 10-2 0v2H7a1 1 0 100 2h2v2a1 1 0 102 0v-2h2a1 1 0 100-2h-2V7z"
                  clipRule="evenodd"
                />
              </svg>
            </div>
            <h3 className="font-bold text-lg">{t('title')}</h3>
          </div>

          <p className="text-sm text-white/90 mb-4">{message}</p>

          <div className="flex flex-col sm:flex-row gap-2">
            <Button
              onClick={handleInstall}
              className="bg-white text-blue-600 hover:bg-gray-100 font-semibold flex-1"
              size="sm"
            >
              {t('button')}
            </Button>

            <Button
              onClick={handleDontShowAgain}
              variant="outline"
              className="border-white/30 text-white hover:bg-white/10 flex-1"
              size="sm"
            >
              {t('dontShow')}
            </Button>
          </div>
        </div>

        {showCloseButton && (
          <button
            onClick={handleClose}
            className="text-white/70 hover:text-white transition-colors p-1"
            aria-label="关闭"
          >
            <X className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* 装饰元素 */}
      <div className="absolute top-0 right-0 w-24 h-24 bg-white/5 rounded-full -translate-y-1/2 translate-x-1/2" />
      <div className="absolute bottom-0 left-0 w-16 h-16 bg-white/5 rounded-full translate-y-1/2 -translate-x-1/2" />
    </div>
  );
}
