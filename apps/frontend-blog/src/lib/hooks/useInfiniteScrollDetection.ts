'use client';

import { useEffect, useRef } from 'react';

interface UseInfiniteScrollDetectionOptions {
  /**
   * 是否启用滚动检测
   */
  enabled?: boolean;

  /**
   * 触发加载的距离阈值（像素）
   * 当元素底部距离视窗底部的距离小于此值时触发加载
   */
  threshold?: number;

  /**
   * 加载更多的回调函数
   */
  onLoadMore: () => void;

  /**
   * 是否还有更多数据
   */
  hasMore?: boolean;

  /**
   * 是否正在加载更多
   */
  isLoadingMore?: boolean;
}

/**
 * 无限滚动检测钩子
 * 检测元素是否进入视窗底部，触发加载更多
 */
export function useInfiniteScrollDetection({
  enabled = true,
  threshold = 300,
  onLoadMore,
  hasMore = true,
  isLoadingMore = false,
}: UseInfiniteScrollDetectionOptions) {
  const observerRef = useRef<IntersectionObserver | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!enabled || !hasMore || isLoadingMore) {
      return;
    }

    // 清理旧的观察器
    if (observerRef.current) {
      observerRef.current.disconnect();
    }

    // 创建新的 IntersectionObserver
    observerRef.current = new IntersectionObserver(
      (entries) => {
        const [entry] = entries;
        if (entry.isIntersecting) {
          onLoadMore();
        }
      },
      {
        root: null, // 使用视窗作为根
        rootMargin: `0px 0px ${threshold}px 0px`, // 底部阈值
        threshold: 0.1, // 10%可见时触发
      },
    );

    // 观察哨兵元素
    if (sentinelRef.current) {
      observerRef.current.observe(sentinelRef.current);
    }

    // 清理函数
    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
      }
    };
  }, [enabled, threshold, onLoadMore, hasMore, isLoadingMore]);

  return { sentinelRef };
}

/**
 * 简化的无限滚动检测钩子（常用场景）
 */
export function useInfiniteScrollDetectionSimple(
  onLoadMore: () => void,
  options?: {
    enabled?: boolean;
    threshold?: number;
    hasMore?: boolean;
    isLoadingMore?: boolean;
  },
) {
  const {
    enabled = true,
    threshold = 300,
    hasMore = true,
    isLoadingMore = false,
  } = options || {};

  return useInfiniteScrollDetection({
    enabled,
    threshold,
    onLoadMore,
    hasMore,
    isLoadingMore,
  });
}
