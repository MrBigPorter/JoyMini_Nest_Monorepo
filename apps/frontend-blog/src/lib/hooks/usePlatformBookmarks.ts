/**
 * 平台感知的收藏相关 React Hook
 * 使用平台适配器提供跨平台一致的缓存和错误处理
 */

import { useQueryClient } from '@tanstack/react-query';
import { frontendBlogApi } from '@/lib/api/frontendBlogApi';
import { useAuth } from '@/lib/hooks/useAuth';
import {
  usePlatformQuery,
  usePlatformMutation,
} from '@/lib/platform/hooks/usePlatformQuery';
import type {
  BookmarkedArticle,
  BookmarkStatusResponse,
  FrontendPaginatedResponse,
} from '@/lib/types/frontend-blog';

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
 * 平台感知的收藏相关 Hook
 * 提供收藏列表、收藏/取消收藏、检查收藏状态等功能
 */
export function usePlatformBookmarks() {
  const queryClient = useQueryClient();
  const { isAuthenticated } = useAuth();

  // ================= 收藏列表查询 =================

  /**
   * 获取用户收藏列表
   */
  const usePlatformBookmarksQuery = (params?: {
    page?: number;
    pageSize?: number;
    locale?: string;
  }) => {
    return usePlatformQuery<FrontendPaginatedResponse<BookmarkedArticle>>({
      queryKey: ['bookmarks', params],
      apiCall: () => frontendBlogApi.getBookmarks(params),
      enabled: isAuthenticated, // 只有认证用户才查询收藏列表
    });
  };

  // ================= 收藏状态查询 =================

  /**
   * 检查文章收藏状态
   * @param articleId 文章ID
   * @param enabled 是否启用查询，默认为false，需要手动触发
   * @param autoCheck 是否自动检查（当用户认证时自动查询）
   */
  const usePlatformBookmarkStatus = (
    articleId: string,
    enabled = false,
    autoCheck = false, // 默认禁用自动检查，避免首页大量请求
  ) => {
    return usePlatformQuery<BookmarkStatusResponse>({
      queryKey: ['bookmark-status', articleId],
      apiCall: () => frontendBlogApi.checkBookmarkStatus(articleId),
      enabled: !!articleId && (enabled || (autoCheck && isAuthenticated)),
      // 注意：PlatformQueryOptions不支持retry属性
      // 重试策略由平台适配器统一管理
    });
  };

  // ================= 收藏操作 =================

  /**
   * 收藏文章
   */
  const addBookmarkMutation = usePlatformMutation({
    apiCall: (articleId: string) => frontendBlogApi.addBookmark(articleId),
    onSuccess: (data, articleId) => {
      // 更新收藏状态缓存
      queryClient.setQueryData<BookmarkStatusResponse>(
        ['bookmark-status', articleId],
        {
          isBookmarked: true,
          bookmarkedAt: data.createdAt,
        },
      );

      // 使收藏列表缓存失效，触发重新获取
      queryClient.invalidateQueries({ queryKey: ['bookmarks'] });

      // 乐观更新：如果当前有文章详情查询，也更新其收藏状态
      queryClient.invalidateQueries({ queryKey: ['article', articleId] });
    },
    onError: (error, articleId) => {
      console.error(`收藏文章失败 (articleId: ${articleId}):`, error);
    },
  });

  /**
   * 取消收藏
   */
  const removeBookmarkMutation = usePlatformMutation({
    apiCall: (articleId: string) => frontendBlogApi.removeBookmark(articleId),
    onSuccess: (data, articleId) => {
      // 更新收藏状态缓存
      queryClient.setQueryData<BookmarkStatusResponse>(
        ['bookmark-status', articleId],
        {
          isBookmarked: false,
          bookmarkedAt: undefined,
        },
      );

      // 使收藏列表缓存失效，触发重新获取
      queryClient.invalidateQueries({ queryKey: ['bookmarks'] });

      // 乐观更新：如果当前有文章详情查询，也更新其收藏状态
      queryClient.invalidateQueries({ queryKey: ['article', articleId] });
    },
    onError: (error, articleId) => {
      console.error(`取消收藏失败 (articleId: ${articleId}):`, error);
    },
  });

  // ================= 批量操作 =================

  /**
   * 切换收藏状态
   */
  const toggleBookmark = async (articleId: string, currentStatus?: boolean) => {
    const isBookmarked = currentStatus ?? false;
    if (isBookmarked) {
      await removeBookmarkMutation.mutateAsync(articleId);
      return false;
    } else {
      await addBookmarkMutation.mutateAsync(articleId);
      return true;
    }
  };

  // ================= 批量查询 =================

  /**
   * 批量查询收藏状态
   * 用于首页等需要批量查询多个文章收藏状态的场景
   */
  const usePlatformBatchBookmarkStatus = (articleIds: string[]) => {
    return usePlatformQuery<BatchBookmarkStatusResponse>({
      queryKey: ['batch-bookmark-status', articleIds],
      apiCall: () => frontendBlogApi.batchCheckBookmarkStatus(articleIds),
      enabled: articleIds.length > 0 && isAuthenticated,
      select: (data) => {
        // 将结果转换为 Map，便于快速查找
        const statusMap = new Map(
          data.results.map((result) => [result.articleId, result]),
        );
        return {
          ...data,
          statusMap,
          getStatus: (articleId: string) => statusMap.get(articleId),
          isBookmarked: (articleId: string) =>
            statusMap.get(articleId)?.isBookmarked ?? false,
        };
      },
    });
  };

  /**
   * 批量查询收藏状态 Hook（简化版）
   * 返回文章ID到收藏状态的映射
   */
  const usePlatformBatchBookmarkStatusMap = (articleIds: string[]) => {
    const { data, ...rest } = usePlatformBatchBookmarkStatus(articleIds);
    return {
      ...rest,
      statusMap: data?.statusMap ?? new Map(),
    };
  };

  /**
   * 批量查询收藏状态 Hook（返回数组格式）
   * 保持与现有 useBookmarkStatus 类似的接口
   */
  const usePlatformBatchBookmarkStatusArray = (articleIds: string[]) => {
    const { data, ...rest } = usePlatformBatchBookmarkStatus(articleIds);
    return {
      ...rest,
      results: data?.results ?? [],
    };
  };

  // ================= 工具函数 =================

  /**
   * 检查多个文章的收藏状态
   */
  const checkMultipleBookmarkStatus = (articleIds: string[]) => {
    return Promise.all(
      articleIds.map((articleId) =>
        frontendBlogApi.checkBookmarkStatus(articleId),
      ),
    );
  };

  /**
   * 预取收藏列表
   */
  const prefetchBookmarks = (params?: {
    page?: number;
    pageSize?: number;
    locale?: string;
  }) => {
    return queryClient.prefetchQuery({
      queryKey: ['bookmarks', params],
      queryFn: () => frontendBlogApi.getBookmarks(params),
    });
  };

  // ================= 返回接口 =================

  return {
    // 查询
    useBookmarksQuery: usePlatformBookmarksQuery,
    useBookmarkStatus: usePlatformBookmarkStatus,
    useBatchBookmarkStatus: usePlatformBatchBookmarkStatus,
    useBatchBookmarkStatusMap: usePlatformBatchBookmarkStatusMap,
    useBatchBookmarkStatusArray: usePlatformBatchBookmarkStatusArray,

    // 操作
    addBookmark: addBookmarkMutation.mutate,
    addBookmarkAsync: addBookmarkMutation.mutateAsync,
    removeBookmark: removeBookmarkMutation.mutate,
    removeBookmarkAsync: removeBookmarkMutation.mutateAsync,
    toggleBookmark,

    // 状态
    isAddingBookmark: addBookmarkMutation.isPending,
    isRemovingBookmark: removeBookmarkMutation.isPending,
    isBookmarkLoading:
      addBookmarkMutation.isPending || removeBookmarkMutation.isPending,

    // 错误
    addBookmarkError: addBookmarkMutation.error,
    removeBookmarkError: removeBookmarkMutation.error,

    // 工具函数
    checkMultipleBookmarkStatus,
    prefetchBookmarks,

    // 重置
    resetAddBookmark: addBookmarkMutation.reset,
    resetRemoveBookmark: removeBookmarkMutation.reset,
  };
}

/**
 * 简化的平台感知收藏状态 Hook
 * 适用于只需要检查单个文章收藏状态的场景
 * 修复：认证用户自动查询收藏状态
 */
export function usePlatformBookmarkStatus(articleId: string, enabled = false) {
  const { useBookmarkStatus: useBookmarkStatusInternal } =
    usePlatformBookmarks();
  return useBookmarkStatusInternal(articleId, enabled, false); // 默认禁用自动检查，避免首页大量请求
}

/**
 * 简化的平台感知收藏列表 Hook
 * 适用于只需要获取收藏列表的场景
 */
export function usePlatformBookmarksList(params?: {
  page?: number;
  pageSize?: number;
  locale?: string;
}) {
  const { useBookmarksQuery } = usePlatformBookmarks();
  return useBookmarksQuery(params);
}

/**
 * 简化的平台感知批量收藏状态查询 Hook
 * 适用于首页等需要批量查询多个文章收藏状态的场景
 */
export function usePlatformBatchBookmarkStatusMap(articleIds: string[]) {
  const { useBatchBookmarkStatusMap } = usePlatformBookmarks();
  return useBatchBookmarkStatusMap(articleIds);
}

/**
 * 简化的平台感知批量收藏状态查询 Hook（数组格式）
 */
export function usePlatformBatchBookmarkStatusArray(articleIds: string[]) {
  const { useBatchBookmarkStatusArray } = usePlatformBookmarks();
  return useBatchBookmarkStatusArray(articleIds);
}

/**
 * 兼容性包装器：保持向后兼容
 * 可以逐步迁移现有代码
 */
export const useBookmarks = usePlatformBookmarks;
export const useBookmarkStatus = usePlatformBookmarkStatus;
export const useBookmarksList = usePlatformBookmarksList;
export const useBatchBookmarkStatus = usePlatformBatchBookmarkStatusMap;
export const useBatchBookmarkStatusMap = usePlatformBatchBookmarkStatusMap;
export const useBatchBookmarkStatusArray = usePlatformBatchBookmarkStatusArray;

export default usePlatformBookmarks;
