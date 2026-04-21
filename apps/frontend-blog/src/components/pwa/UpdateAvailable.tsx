'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@repo/ui/button';
import { RefreshCw, X, Download } from 'lucide-react';
import { usePWA } from '@/hooks/usePWA';

interface UpdateAvailableProps {
  /**
   * 检查更新间隔（毫秒）
   * @default 3600000 (1小时)
   */
  checkInterval?: number;
  /**
   * 自定义更新消息
   */
  updateMessage?: string;
  /**
   * 是否显示关闭按钮
   * @default true
   */
  showCloseButton?: boolean;
  /**
   * 自动显示延迟（毫秒）
   * @default 5000
   */
  autoShowDelay?: number;
}

/**
 * 更新可用提示组件
 * 当有新版本可用时提示用户更新
 */
export function UpdateAvailable({
  checkInterval = 3600000,
  updateMessage,
  showCloseButton = true,
  autoShowDelay = 5000,
}: UpdateAvailableProps) {
  const t = useTranslations('pwa.update');
  const { isUpdateAvailable, skipWaiting, checkForUpdates } = usePWA();
  const [isVisible, setIsVisible] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);

  // 定期检查更新
  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator))
      return;

    const checkUpdates = async () => {
      try {
        await checkForUpdates();
        setLastChecked(new Date());
      } catch (error) {
        console.warn('检查更新失败:', error);
      }
    };

    // 初始检查
    checkUpdates();

    // 设置定期检查
    const interval = setInterval(checkUpdates, checkInterval);

    return () => clearInterval(interval);
  }, [checkInterval, checkForUpdates]);

  // 控制显示逻辑
  useEffect(() => {
    if (!isUpdateAvailable) {
      setIsVisible(false);
      return;
    }

    // 延迟显示，避免立即干扰用户
    const timer = setTimeout(() => {
      setIsVisible(true);
    }, autoShowDelay);

    return () => clearTimeout(timer);
  }, [isUpdateAvailable, autoShowDelay]);

  const handleUpdate = async () => {
    try {
      setIsUpdating(true);
      await skipWaiting();

      // 给用户一点时间看到更新状态
      setTimeout(() => {
        if (typeof window !== 'undefined') {
          window.location.reload();
        }
      }, 1000);
    } catch (error) {
      console.error('更新失败:', error);
      setIsUpdating(false);
    }
  };

  const handleDismiss = () => {
    setIsVisible(false);
  };

  const handleCheckNow = async () => {
    try {
      await checkForUpdates();
    } catch (error) {
      console.warn('手动检查更新失败:', error);
    }
  };

  if (!isVisible) return null;

  const message = updateMessage || t('message');

  return (
    <div
      className={`
        fixed bottom-4 left-4 right-4 md:left-auto md:max-w-md
        bg-gradient-to-r from-indigo-500 to-purple-600
        text-white rounded-xl shadow-2xl p-4
        transform transition-all duration-300 ease-out
        z-50
      `}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 bg-white/20 rounded-lg flex items-center justify-center">
              {isUpdating ? (
                <RefreshCw className="w-5 h-5 animate-spin" />
              ) : (
                <Download className="w-5 h-5" />
              )}
            </div>
            <h3 className="font-bold text-lg">
              {isUpdating ? t('titleUpdating') : t('titleAvailable')}
            </h3>
          </div>

          <p className="text-sm text-white/90 mb-4">{message}</p>

          {lastChecked && (
            <p className="text-xs text-white/70 mb-3">
              最后检查: {lastChecked.toLocaleTimeString()}
            </p>
          )}

          <div className="flex flex-col sm:flex-row gap-2">
            <Button
              onClick={handleUpdate}
              disabled={isUpdating}
              className="bg-white text-indigo-600 hover:bg-gray-100 font-semibold flex-1"
              size="sm"
            >
              {isUpdating ? (
                <>
                  <RefreshCw className="w-3 h-3 mr-2 animate-spin" />
                  {t('checking')}
                </>
              ) : (
                t('button')
              )}
            </Button>

            <Button
              onClick={handleCheckNow}
              variant="outline"
              className="border-white/30 text-white hover:bg-white/10 flex-1"
              size="sm"
            >
              <RefreshCw className="w-3 h-3 mr-1" />
              {t('check')}
            </Button>
          </div>
        </div>

        {showCloseButton && !isUpdating && (
          <button
            onClick={handleDismiss}
            className="text-white/70 hover:text-white transition-colors p-1"
            aria-label="关闭"
          >
            <X className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* 更新进度指示器 */}
      {isUpdating && (
        <div className="mt-3">
          <div className="h-2 bg-white/20 rounded-full overflow-hidden">
            <div className="h-full bg-white/50 rounded-full animate-pulse" />
          </div>
          <p className="text-xs text-white/70 mt-2 text-center">
            {t('complete')}
          </p>
        </div>
      )}

      {/* 装饰元素 */}
      <div className="absolute top-0 left-0 w-20 h-20 bg-white/5 rounded-full -translate-y-1/2 -translate-x-1/2" />
      <div className="absolute bottom-0 right-0 w-16 h-16 bg-white/5 rounded-full translate-y-1/2 translate-x-1/2" />
    </div>
  );
}
