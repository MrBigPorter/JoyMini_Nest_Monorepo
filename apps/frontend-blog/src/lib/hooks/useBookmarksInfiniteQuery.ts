'use client';

import { useInfiniteQuery } from '@tanstack/react-query';
import { frontendBlogApi } from '@/lib/api/frontendBlogApi';
import { useCurrentLocale } from '@/lib/hooks/useCurrentLocale';

/**
 * 收藏分页参数
 */
export interface BookmarksParams {
  page: number;
  pageSize: number;
  locale?: string;
}

/**
 * 收藏无限滚动查询钩子
 * 基于 React Query 的 useInfiniteQuery
 */

export function useBookmarksInfiniteQuery(options?: {
  pageSize?: number;
  locale?: string;
  enabled?: boolean;
  initialData?: any;
}) {
  const {
    pageSize = 20,
    locale: propLocale,
    enabled = true,
    initialData,
  } = options || {};
  const currentLocale = useCurrentLocale();
  const locale = propLocale || currentLocale; // 优先使用传入的locale，否则使用当前语言

  return useInfiniteQuery({
    queryKey: ['bookmarks', 'infinite', locale, { pageSize }],
    initialData: initialData,
    queryFn: async ({ pageParam = 1 }) => {
      const response = await frontendBlogApi.getBookmarks({
        page: pageParam,
        pageSize,
        locale,
      });

      return {
        items: response.items || [],
        total: response.total || 0,
        page: response.page || pageParam,
        pageSize: response.pageSize || pageSize,
        totalPages: response.totalPages || 0,
      };
    },
    getNextPageParam: (lastPage) => {
      const currentPage = lastPage.page;
      const totalPages = lastPage.totalPages;

      if (currentPage < totalPages) {
        return currentPage + 1;
      }
      return undefined;
    },
    initialPageParam: 1,
    enabled,
  });
}

/**
 * 简化的收藏无限滚动钩子（常用场景）
 */
export function useBookmarksInfiniteQuerySimple(options?: {
  pageSize?: number;
  locale?: string;
  enabled?: boolean;
  initialData?: any;
}) {
  const result = useBookmarksInfiniteQuery(options);

  // 扁平化所有页面的项目
  const allItems = result.data?.pages.flatMap((page) => page.items) || [];
  const total = result.data?.pages[0]?.total || 0;
  const page = result.data?.pages[result.data.pages.length - 1]?.page || 1;
  const totalPages = result.data?.pages[0]?.totalPages || 0;

  return {
    // 数据
    items: allItems,
    total,
    page,
    pageSize: options?.pageSize || 20,
    totalPages,

    // 状态
    isLoading: result.isLoading,
    isLoadingMore: result.isFetchingNextPage,
    hasMore: result.hasNextPage,
    error: result.error,

    // 操作
    loadMore: () => result.fetchNextPage(),
    reload: () => result.refetch(),
    reset: () => {
      // 重置需要清除缓存，这里简单重新获取
      result.refetch();
    },
  };
}

/**
 * 用户收藏无限滚动钩子
 */
export function useUserBookmarksInfiniteQuery() {
  return useBookmarksInfiniteQuerySimple({
    pageSize: 20,
  });
}
