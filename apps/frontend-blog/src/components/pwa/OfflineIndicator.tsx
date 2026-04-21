'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { WifiOff, Wifi, RefreshCw } from 'lucide-react';
import { Button } from '@repo/ui/button';
import { useOffline } from '@/hooks/useOffline';

interface OfflineIndicatorProps {
  /**
   * 显示位置
   * @default 'top'
   */
  position?: 'top' | 'bottom';
  /**
   * 是否显示重试按钮
   * @default true
   */
  showRetryButton?: boolean;
  /**
   * 自定义离线消息
   */
  offlineMessage?: string;
  /**
   * 自定义恢复消息
   */
  onlineMessage?: string;
  /**
   * 自动隐藏恢复消息的时间（毫秒）
   * @default 3000
   */
  autoHideDelay?: number;
}

/**
 * 离线状态指示器组件
 * 显示网络连接状态，提供离线/在线状态反馈
 */
export function OfflineIndicator({
  position = 'top',
  showRetryButton = true,
  offlineMessage,
  onlineMessage,
  autoHideDelay = 3000,
}: OfflineIndicatorProps) {
  const t = useTranslations('pwa.offline');
  const isOffline = useOffline();
  const [isVisible, setIsVisible] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);

  // 控制显示/隐藏逻辑
  useEffect(() => {
    if (isOffline) {
      // 离线时立即显示
      setIsVisible(true);
      setIsTransitioning(false);
    } else {
      // 在线时显示恢复消息，然后自动隐藏
      if (isVisible) {
        setIsTransitioning(true);
        const timer = setTimeout(() => {
          setIsVisible(false);
          setIsTransitioning(false);
        }, autoHideDelay);
        return () => clearTimeout(timer);
      }
    }
  }, [isOffline, isVisible, autoHideDelay]);

  const handleRetry = () => {
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  };

  const handleDismiss = () => {
    setIsVisible(false);
    setIsTransitioning(false);
  };

  if (!isVisible) return null;

  const isOnlineState = !isOffline && isTransitioning;
  const message = isOffline
    ? offlineMessage || t('messageOffline')
    : onlineMessage || t('messageOnline');

  const positionClasses =
    position === 'top'
      ? 'top-4 animate-slide-down'
      : 'bottom-4 animate-slide-up';

  return (
    <div
      className={`
        fixed left-4 right-4 md:left-auto md:right-4 md:max-w-md
        ${positionClasses}
        bg-gradient-to-r ${isOffline ? 'from-amber-500 to-orange-600' : 'from-emerald-500 to-teal-600'}
        text-white rounded-xl shadow-2xl p-4
        transform transition-all duration-300 ease-out
        z-50
      `}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div
            className={`w-10 h-10 rounded-full flex items-center justify-center ${isOffline ? 'bg-amber-600/30' : 'bg-emerald-600/30'}`}
          >
            {isOffline ? (
              <WifiOff className="w-5 h-5" />
            ) : (
              <Wifi className="w-5 h-5" />
            )}
          </div>

          <div className="flex-1">
            <h3 className="font-bold text-sm">
              {isOffline ? t('titleOffline') : t('titleOnline')}
            </h3>
            <p className="text-xs text-white/90">{message}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {showRetryButton && isOffline && (
            <Button
              onClick={handleRetry}
              variant="outline"
              size="sm"
              className="border-white/30 text-white hover:bg-white/10"
            >
              <RefreshCw className="w-3 h-3 mr-1" />
              {t('retry')}
            </Button>
          )}

          <button
            onClick={handleDismiss}
            className="text-white/70 hover:text-white transition-colors p-1"
            aria-label="关闭"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>
      </div>

      {/* 进度条（仅在线恢复时显示） */}
      {isOnlineState && autoHideDelay > 0 && (
        <div className="mt-3 h-1 bg-white/20 rounded-full overflow-hidden">
          <div
            className="h-full bg-white/50 rounded-full transition-all duration-300 ease-linear"
            style={{
              width: '100%',
              animation: `shrink ${autoHideDelay}ms linear forwards`,
            }}
          />
        </div>
      )}

      <style jsx>{`
        @keyframes shrink {
          from {
            width: 100%;
          }
          to {
            width: 0%;
          }
        }
        @keyframes slide-down {
          from {
            transform: translateY(-100%);
            opacity: 0;
          }
          to {
            transform: translateY(0);
            opacity: 1;
          }
        }
        @keyframes slide-up {
          from {
            transform: translateY(100%);
            opacity: 0;
          }
          to {
            transform: translateY(0);
            opacity: 1;
          }
        }
        .animate-slide-down {
          animation: slide-down 0.3s ease-out;
        }
        .animate-slide-up {
          animation: slide-up 0.3s ease-out;
        }
      `}</style>
    </div>
  );
}
