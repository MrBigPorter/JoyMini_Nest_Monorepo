'use client';

import { useMemo } from 'react';
import { useComments } from './useComments';

/**
 * 评论Hook适配器
 * 将标准的React Query结果转换为组件期望的格式
 */
export function useCommentsInfiniteQuerySimple(
  articleId: string,
  options?: {
    pageSize?: number;
    enabled?: boolean;
  },
) {
  const { useCommentsInfiniteQuery } = useComments();

  const {
    data,
    isLoading,
    isFetchingNextPage,
    hasNextPage,
    error,
    fetchNextPage,
    refetch,
  } = useCommentsInfiniteQuery(articleId, options);

  // 将React Query的无限滚动数据转换为组件期望的格式
  const result = useMemo(() => {
    if (!data) {
      return {
        items: [],
        total: 0,
        page: 1,
        pageSize: options?.pageSize || 20,
        totalPages: 0,
      };
    }

    // 合并所有页面的数据
    const allItems = data.pages.flatMap((page: any) => page.items || []);
    const firstPage = data.pages[0] || {};

    return {
      items: allItems,
      total: firstPage.total || 0,
      page: firstPage.page || 1,
      pageSize: firstPage.pageSize || options?.pageSize || 20,
      totalPages: firstPage.totalPages || 0,
    };
  }, [data, options?.pageSize]);

  return {
    items: result.items,
    total: result.total,
    page: result.page,
    pageSize: result.pageSize,
    totalPages: result.totalPages,
    isLoading,
    isLoadingMore: isFetchingNextPage,
    hasMore: !!hasNextPage,
    error,
    loadMore: fetchNextPage,
    reload: refetch,
  };
}
