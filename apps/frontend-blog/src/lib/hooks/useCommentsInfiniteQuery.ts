'use client';

import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { frontendBlogApi } from '@/lib/api/frontendBlogApi';
import type { Comment } from '@/lib/types/blog';

/**
 * 评论分页参数
 */
export interface CommentsParams {
  page: number;
  pageSize: number;
}

/**
 * 评论无限滚动查询钩子
 * 基于 React Query 的 useInfiniteQuery，与 usePostComment 共享同一个 QueryClient
 */
export function useCommentsInfiniteQuery(
  articleId: string,
  options?: {
    pageSize?: number;
    enabled?: boolean;
  },
) {
  const { pageSize = 20, enabled = true } = options || {};

  return useInfiniteQuery({
    queryKey: ['comments', 'infinite', articleId, { pageSize }],
    queryFn: async ({ pageParam = 1 }) => {
      const response = await frontendBlogApi.getComments(articleId, {
        page: pageParam,
        pageSize,
      });

      return {
        items: response.items || [],
        total: response.total || 0,
        page: response.page || pageParam,
        pageSize: response.pageSize || pageSize,
        totalPages: response.totalPages || 0,
      };
    },
    getNextPageParam: (lastPage, allPages) => {
      const currentPage = lastPage.page;
      const totalPages = lastPage.totalPages;

      if (currentPage < totalPages) {
        return currentPage + 1;
      }
      return undefined; // 没有更多数据
    },
    getPreviousPageParam: (firstPage, allPages) => {
      const currentPage = firstPage.page;
      if (currentPage > 1) {
        return currentPage - 1;
      }
      return undefined;
    },
    initialPageParam: 1,
    enabled: enabled && !!articleId,
    staleTime: 5 * 60 * 1000, // 5分钟缓存
  });
}

/**
 * 简化的评论无限滚动钩子（常用场景）
 * 返回扁平化的评论列表和加载状态
 */
export function useCommentsInfiniteQuerySimple(
  articleId: string,
  options?: {
    pageSize?: number;
    enabled?: boolean;
  },
) {
  const {
    data,
    isLoading,
    isError,
    error,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    refetch,
  } = useCommentsInfiniteQuery(articleId, options);

  // 扁平化所有页面的评论
  const allComments = data?.pages.flatMap((page) => page.items) || [];
  const totalComments = data?.pages[0]?.total || 0;
  const currentPage = data?.pages[data.pages.length - 1]?.page || 1;
  const totalPages = data?.pages[0]?.totalPages || 0;

  return {
    // 扁平化数据
    items: allComments,
    total: totalComments,
    page: currentPage,
    pageSize: options?.pageSize || 20,
    totalPages,

    // 加载状态
    isLoading,
    isLoadingMore: isFetchingNextPage,
    hasMore: hasNextPage,
    error,

    // 操作方法
    loadMore: fetchNextPage,
    reload: refetch,
  };
}

/**
 * 获取评论无限滚动查询的缓存键
 * 用于与 usePostComment 共享缓存
 */
export function getCommentsInfiniteQueryKey(
  articleId: string,
  params?: { pageSize?: number },
) {
  return ['comments', 'infinite', articleId, params];
}
