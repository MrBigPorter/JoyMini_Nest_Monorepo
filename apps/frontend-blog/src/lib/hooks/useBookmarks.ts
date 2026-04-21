'use client';

import { useQuery } from '@tanstack/react-query';
import { frontendBlogApi } from '@/lib/api/frontendBlogApi';
import { useAuth } from '@/lib/hooks/useAuth';
import { useCurrentLocale } from '@/lib/hooks/useCurrentLocale';

/**
 * 批量收藏状态查询结果类型
 */
interface BatchBookmarkStatusResult {
  articleId: string;
  isBookmarked: boolean;
  bookmarkedAt?: string;
}

/**
 * 批量收藏状态查询响应类型
 */
interface BatchBookmarkStatusResponse {
  results: BatchBookmarkStatusResult[];
  statusMap?: Map<string, BatchBookmarkStatusResult>;
  getStatus?: (articleId: string) => BatchBookmarkStatusResult | undefined;
  isBookmarked?: (articleId: string) => boolean;
}

/**
 * 简单的收藏相关 Hook
 * 提供收藏列表、收藏/取消收藏、检查收藏状态等功能
 */
export function useBookmarks() {
  const { isAuthenticated } = useAuth();

  // ================= 收藏列表查询 =================

  /**
   * 获取用户收藏列表
   */
  const useBookmarksQuery = (params?: { page?: number; pageSize?: number }) => {
    const locale = useCurrentLocale();

    return useQuery({
      queryKey: ['bookmarks', locale, params],
      queryFn: async () => {
        return await frontendBlogApi.getBookmarks({
          ...params,
          locale,
        });
      },
      staleTime: 5 * 60 * 1000, // 5分钟缓存
      enabled: isAuthenticated,
      retry: 2,
    });
  };

  /**
   * 检查单个文章的收藏状态
   */
  const useBookmarkStatus = (
    articleId: string,
    enabled = true,
    autoCheck = true,
  ) => {
    const locale = useCurrentLocale();

    return useQuery({
      queryKey: ['bookmark-status', articleId, locale],
      queryFn: async () => {
        const response = await frontendBlogApi.checkBookmarkStatus(articleId);
        return {
          isBookmarked: response.isBookmarked || false,
          bookmarkedAt: response.bookmarkedAt,
        };
      },
      staleTime: 5 * 60 * 1000, // 5分钟缓存
      enabled: isAuthenticated && enabled && autoCheck,
      retry: 2,
    });
  };

  /**
   * 批量查询收藏状态
   */
  const useBatchBookmarkStatus = (articleIds: string[]) => {
    const locale = useCurrentLocale();

    return useQuery({
      queryKey: ['batch-bookmark-status', articleIds, locale],
      queryFn: async () => {
        const response =
          await frontendBlogApi.batchCheckBookmarkStatus(articleIds);

        // 创建状态映射
        const statusMap = new Map<string, BatchBookmarkStatusResult>();
        response.results?.forEach((result: any) => {
          statusMap.set(result.articleId, {
            articleId: result.articleId,
            isBookmarked: result.isBookmarked,
            bookmarkedAt: result.bookmarkedAt,
          });
        });

        return {
          results: response.results || [],
          statusMap,
          getStatus: (articleId: string) => statusMap.get(articleId),
          isBookmarked: (articleId: string) =>
            statusMap.get(articleId)?.isBookmarked || false,
        } as BatchBookmarkStatusResponse;
      },
      staleTime: 5 * 60 * 1000, // 5分钟缓存
      enabled: isAuthenticated && articleIds.length > 0,
      retry: 2,
    });
  };

  /**
   * 批量查询收藏状态（返回Map格式）
   */
  const useBatchBookmarkStatusMap = (articleIds: string[]) => {
    const { data, ...rest } = useBatchBookmarkStatus(articleIds);

    return {
      ...rest,
      statusMap: data?.statusMap || new Map(),
      getStatus: data?.getStatus,
      isBookmarked: data?.isBookmarked,
    };
  };

  /**
   * 批量查询收藏状态（返回数组格式）
   */
  const useBatchBookmarkStatusArray = (articleIds: string[]) => {
    const { data, ...rest } = useBatchBookmarkStatus(articleIds);

    return {
      ...rest,
      results: data?.results || [],
    };
  };

  return {
    useBookmarksQuery,
    useBookmarkStatus,
    useBatchBookmarkStatus,
    useBatchBookmarkStatusMap,
    useBatchBookmarkStatusArray,
  };
}

/**
 * 获取收藏列表的简化Hook
 */
export function useBookmarksList(params?: {
  page?: number;
  pageSize?: number;
}) {
  const { useBookmarksQuery } = useBookmarks();
  return useBookmarksQuery(params);
}

/**
 * 批量查询收藏状态的简化Hook（返回Map格式）
 */
export function useBatchBookmarkStatusMap(articleIds: string[]) {
  const { useBatchBookmarkStatusMap } = useBookmarks();
  return useBatchBookmarkStatusMap(articleIds);
}

/**
 * 批量查询收藏状态的简化Hook（返回数组格式）
 */
export function useBatchBookmarkStatusArray(articleIds: string[]) {
  const { useBatchBookmarkStatusArray } = useBookmarks();
  return useBatchBookmarkStatusArray(articleIds);
}

// 导出别名以保持向后兼容性
export const usePlatformBookmarks = useBookmarks;
export const usePlatformBookmarksList = useBookmarksList;
export const usePlatformBatchBookmarkStatusMap = useBatchBookmarkStatusMap;
export const usePlatformBatchBookmarkStatusArray = useBatchBookmarkStatusArray;
