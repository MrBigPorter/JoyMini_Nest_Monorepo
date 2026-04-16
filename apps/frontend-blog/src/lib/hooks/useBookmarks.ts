import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { frontendBlogApi } from '@/lib/api/frontendBlogApi';
import { useAuth } from '@/lib/hooks/useAuth';
import type {
  BookmarkedArticle,
  BookmarkResponse,
  BookmarkStatusResponse,
  FrontendPaginatedResponse,
} from '@/lib/types/frontend-blog';

/**
 * 收藏相关的 React Hook
 * 提供收藏列表、收藏/取消收藏、检查收藏状态等功能
 */
export function useBookmarks() {
  const queryClient = useQueryClient();
  const { isAuthenticated } = useAuth();

  // ================= 收藏列表查询 =================

  /**
   * 获取用户收藏列表
   */
  const useBookmarksQuery = (params?: {
    page?: number;
    pageSize?: number;
    locale?: string;
  }) => {
    return useQuery({
      queryKey: ['bookmarks', params],
      queryFn: () => frontendBlogApi.getBookmarks(params),
      staleTime: 5 * 60 * 1000, // 5分钟缓存
      gcTime: 10 * 60 * 1000, // 10分钟垃圾回收时间
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
  const useBookmarkStatus = (
    articleId: string,
    enabled = false,
    autoCheck = false, // 默认禁用自动检查，避免首页大量请求
  ) => {
    return useQuery({
      queryKey: ['bookmark-status', articleId],
      queryFn: () => frontendBlogApi.checkBookmarkStatus(articleId),
      staleTime: 2 * 60 * 1000, // 2分钟缓存
      gcTime: 5 * 60 * 1000, // 5分钟垃圾回收时间
      enabled: !!articleId && (enabled || (autoCheck && isAuthenticated)),
      retry: false, // 对于未登录用户，不重试401错误
    });
  };

  // ================= 收藏操作 =================

  /**
   * 收藏文章
   */
  const addBookmarkMutation = useMutation({
    mutationFn: (articleId: string) => frontendBlogApi.addBookmark(articleId),
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
  const removeBookmarkMutation = useMutation({
    mutationFn: (articleId: string) =>
      frontendBlogApi.removeBookmark(articleId),
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
    useBookmarksQuery,
    useBookmarkStatus,

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
 * 简化的收藏状态 Hook
 * 适用于只需要检查单个文章收藏状态的场景
 * 修复：认证用户自动查询收藏状态
 */
export function useBookmarkStatus(articleId: string, enabled = false) {
  const { useBookmarkStatus: useBookmarkStatusInternal } = useBookmarks();
  return useBookmarkStatusInternal(articleId, enabled, false); // 默认禁用自动检查，避免首页大量请求
}

/**
 * 简化的收藏列表 Hook
 * 适用于只需要获取收藏列表的场景
 */
export function useBookmarksList(params?: {
  page?: number;
  pageSize?: number;
  locale?: string;
}) {
  const { useBookmarksQuery } = useBookmarks();
  return useBookmarksQuery(params);
}

export default useBookmarks;
