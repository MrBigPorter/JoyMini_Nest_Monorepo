'use client';

import { useTranslations } from 'next-intl';

interface LoadingIndicatorProps {
  /**
   * 加载状态
   */
  isLoading?: boolean;

  /**
   * 加载更多状态
   */
  isLoadingMore?: boolean;

  /**
   * 是否还有更多数据
   */
  hasMore?: boolean;

  /**
   * 错误信息
   */
  error?: Error | null;

  /**
   * 手动加载更多的函数
   */
  onLoadMore?: () => void;

  /**
   * 自定义加载文本
   */
  loadingText?: string;

  /**
   * 自定义加载更多文本
   */
  loadingMoreText?: string;

  /**
   * 自定义没有更多数据文本
   */
  noMoreText?: string;

  /**
   * 自定义错误文本
   */
  errorText?: string;

  /**
   * 自定义重试文本
   */
  retryText?: string;

  /**
   * 是否显示加载更多按钮
   */
  showLoadMoreButton?: boolean;

  /**
   * 是否自动加载（无限滚动）
   */
  autoLoad?: boolean;

  /**
   * 自定义类名
   */
  className?: string;
}

/**
 * 通用加载指示器组件
 * 支持初始加载、加载更多、错误状态、没有更多数据等状态
 */
export function LoadingIndicator({
  isLoading = false,
  isLoadingMore = false,
  hasMore = true,
  error = null,
  onLoadMore,
  loadingText,
  loadingMoreText,
  noMoreText,
  errorText,
  retryText,
  showLoadMoreButton = true,
  autoLoad = false,
  className = '',
}: LoadingIndicatorProps) {
  const t = useTranslations('common');

  // 使用翻译或自定义文本
  const defaultLoadingText = loadingText || t('loading');
  const defaultLoadingMoreText = loadingMoreText || t('loadingMore');
  const defaultNoMoreText = noMoreText || t('noMoreData');
  const defaultErrorText = errorText || t('loadError');
  const defaultRetryText = retryText || t('retry');

  // 错误状态
  if (error) {
    return (
      <div
        className={`flex flex-col items-center justify-center py-8 ${className}`}
      >
        <div className="text-red-500 mb-2">
          <svg
            className="w-8 h-8 mx-auto"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
        </div>
        <p className="text-gray-600 dark:text-gray-400 mb-4">
          {defaultErrorText}
        </p>
        {onLoadMore && (
          <button
            onClick={onLoadMore}
            className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
          >
            {defaultRetryText}
          </button>
        )}
      </div>
    );
  }

  // 初始加载状态
  if (isLoading) {
    return (
      <div
        className={`flex flex-col items-center justify-center py-12 ${className}`}
      >
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mb-4"></div>
        <p className="text-gray-600 dark:text-gray-400">{defaultLoadingText}</p>
      </div>
    );
  }

  // 加载更多状态
  if (isLoadingMore) {
    return (
      <div
        className={`flex flex-col items-center justify-center py-4 ${className}`}
      >
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mb-2"></div>
        <p className="text-gray-600 dark:text-gray-400 text-sm">
          {defaultLoadingMoreText}
        </p>
      </div>
    );
  }

  // 没有更多数据
  if (!hasMore) {
    return (
      <div
        className={`flex flex-col items-center justify-center py-4 ${className}`}
      >
        <div className="text-gray-400 mb-2">
          <svg
            className="w-6 h-6 mx-auto"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M5 13l4 4L19 7"
            />
          </svg>
        </div>
        <p className="text-gray-500 dark:text-gray-400 text-sm">
          {defaultNoMoreText}
        </p>
      </div>
    );
  }

  // 显示加载更多按钮
  if (showLoadMoreButton && onLoadMore && !autoLoad) {
    return (
      <div className={`flex justify-center py-4 ${className}`}>
        <button
          onClick={onLoadMore}
          className="px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
        >
          {t('loadMore')}
        </button>
      </div>
    );
  }

  // 自动加载（无限滚动）的占位符
  if (autoLoad) {
    return (
      <div className={`py-4 ${className}`}>
        <div className="h-1"></div>
      </div>
    );
  }

  return null;
}

/**
 * 简化的加载指示器（用于无限滚动底部）
 */
export function InfiniteScrollLoader({
  isLoadingMore,
  hasMore,
  error,
  onRetryAction,
}: {
  isLoadingMore?: boolean;
  hasMore?: boolean;
  error?: Error | null;
  onRetryAction?: () => void;
}) {
  return (
    <LoadingIndicator
      isLoadingMore={isLoadingMore}
      hasMore={hasMore}
      error={error}
      onLoadMore={onRetryAction}
      showLoadMoreButton={!!error}
      autoLoad={!error}
      className="mt-4"
    />
  );
}

/**
 * 页面加载指示器
 */
export function PageLoader() {
  return (
    <div className="fixed inset-0 bg-white dark:bg-gray-900 flex items-center justify-center z-50">
      <div className="text-center">
        <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-blue-500 mx-auto mb-4"></div>
        <p className="text-gray-600 dark:text-gray-400">Loading...</p>
      </div>
    </div>
  );
}
