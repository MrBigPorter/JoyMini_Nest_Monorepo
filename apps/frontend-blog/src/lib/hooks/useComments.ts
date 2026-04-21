'use client';

import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import { frontendBlogApi } from '@/lib/api/frontendBlogApi';
import { useCurrentLocale } from '@/lib/hooks/useCurrentLocale';
import { useAuth } from '@/lib/hooks/useAuth';
import { useToast } from '@/lib/hooks/useToast';

/**
 * 评论相关Hook
 */
export function useComments() {
  const locale = useCurrentLocale();
  const { isAuthenticated } = useAuth();
  const queryClient = useQueryClient();
  const { success, error } = useToast();

  /**
   * 获取文章评论列表（无限滚动）
   */

  const useCommentsInfiniteQuery = (
    articleId: string,
    options?: {
      pageSize?: number;
      enabled?: boolean;
    },
  ) => {
    const { pageSize = 20, enabled = true } = options || {};

    return useInfiniteQuery({
      queryKey: ['comments', 'infinite', articleId, locale, { pageSize }],
      queryFn: async ({ pageParam = 1 }) => {
        const response = await frontendBlogApi.getComments(articleId, {
          page: pageParam as number,
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
      initialPageParam: 1,
      getNextPageParam: (lastPage: any) => {
        if (lastPage.page < lastPage.totalPages) {
          return lastPage.page + 1;
        }
        return undefined;
      },
      enabled: enabled && !!articleId,
      staleTime: 5 * 60 * 1000, // 5分钟缓存
      retry: 2,
    });
  };

  /**
   * 获取文章评论列表（简化版）
   */
  const useCommentsInfiniteQuerySimple = (
    articleId: string,
    options?: {
      pageSize?: number;
      enabled?: boolean;
    },
  ) => {
    return useCommentsInfiniteQuery(articleId, options);
  };

  /**
   * 发表评论
   */
  const usePostComment = (articleId: string) => {
    return useMutation({
      mutationFn: async (data: { content: string; parentId?: string }) => {
        // 添加author字段，使用默认值
        const commentData = {
          ...data,
          author: 'Anonymous',
          email: undefined,
          website: undefined,
        };
        return await frontendBlogApi.postComment(articleId, commentData);
      },
      onSuccess: () => {
        // 使评论列表缓存失效
        queryClient.invalidateQueries({
          queryKey: ['comments', 'infinite', articleId, locale],
        });
        success('评论发表成功');
      },
      onError: (err) => {
        const errorMessage =
          err instanceof Error ? err.message : '评论发表失败';
        error(`评论发表失败: ${errorMessage}`);
      },
    });
  };

  return {
    useCommentsInfiniteQuery,
    useCommentsInfiniteQuerySimple,
    usePostComment,
  };
}

/**
 * 获取文章评论列表的简化Hook
 */
export function useCommentsInfiniteQuerySimple(
  articleId: string,
  options?: {
    pageSize?: number;
    enabled?: boolean;
  },
) {
  const { useCommentsInfiniteQuerySimple } = useComments();
  return useCommentsInfiniteQuerySimple(articleId, options);
}

/**
 * 发表评论的简化Hook
 */
export function usePostComment(articleId: string) {
  const { usePostComment } = useComments();
  return usePostComment(articleId);
}
