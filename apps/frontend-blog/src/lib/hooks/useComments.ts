'use client';

import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import { frontendBlogApi } from '@/lib/api/frontendBlogApi';
import { useCurrentLocale } from '@/lib/hooks/useCurrentLocale';
import { useToast } from '@/lib/hooks/useToast';
import {
  commentStatusManager,
  createStatusCheckCallback,
} from '@/lib/utils/commentStatus';
import type { Comment } from '@/lib/types/blog';

/**
 * 评论相关Hook
 */
export function useComments() {
  const locale = useCurrentLocale();
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
   * 发表评论（带乐观更新）
   *
   * 乐观更新流程：
   * 1. onMutate: 立即创建临时评论（temp-xxx）插入缓存，用户即时看到
   * 2. onSuccess: 用真实评论数据替换临时评论，注册 commentStatusManager 轮询审核状态
   * 3. onError: 回滚缓存，移除临时评论
   * 4. 轮询检测到 APPROVED → invalidateQueries 刷新列表
   *
   * 注意：使用 getQueriesData/setQueryData 配合模糊匹配查询key，
   * 因为无限查询的key包含 { pageSize } 后缀（如 [{ pageSize: 20 }]），
   * 必须模糊匹配才能找到所有相关的缓存条目并更新。
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
      onMutate: async (data) => {
        // 取消进行中的评论列表查询，避免覆盖乐观更新
        // cancelQueries 支持模糊匹配，会取消所有匹配的查询
        await queryClient.cancelQueries({
          queryKey: ['comments', 'infinite', articleId, locale],
        });

        // 使用模糊匹配查找所有相关的缓存条目（包括带 { pageSize } 后缀的）
        // 并保存用于错误时回滚
        const previousEntries = queryClient.getQueriesData({
          queryKey: ['comments', 'infinite', articleId, locale],
        });

        // 生成临时评论ID
        const tempId = `temp-${Date.now()}`;

        // 创建临时评论对象
        const tempComment: Comment = {
          id: tempId,
          articleId,
          author: 'Anonymous',
          email: null,
          website: null,
          content: data.content,
          parentId: data.parentId || null,
          approved: false,
          likes: 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          children: [],
        };

        // 更新所有匹配的缓存条目：将临时评论插入首页
        previousEntries.forEach(([key]) => {
          queryClient.setQueryData(key, (old: any) => {
            if (!old) {
              return {
                pages: [
                  {
                    items: [tempComment],
                    total: 1,
                    page: 1,
                    pageSize: 20,
                    totalPages: 1,
                  },
                ],
                pageParams: [1],
              };
            }

            return {
              ...old,
              pages: old.pages.map((page: any, index: number) => {
                if (index === 0) {
                  return {
                    ...page,
                    items: [tempComment, ...(page.items || [])],
                    total: (page.total || 0) + 1,
                  };
                }
                return page;
              }),
            };
          });
        });

        return { previousEntries, tempId };
      },
      onSuccess: (data, _variables, context) => {
        if (!context) return;

        // API返回的data有status字段，但Comment类型使用approved
        const responseData = data as any;
        const isApproved = responseData.status === 'APPROVED';

        // 用真实评论数据替换所有匹配缓存中的临时评论
        const entries = queryClient.getQueriesData({
          queryKey: ['comments', 'infinite', articleId, locale],
        });
        entries.forEach(([key]) => {
          queryClient.setQueryData(key, (old: any) => {
            if (!old) return old;

            return {
              ...old,
              pages: old.pages.map((page: any) => ({
                ...page,
                items: (page.items || []).map((item: Comment) => {
                  if (item.id === context.tempId) {
                    return {
                      ...item,
                      id: responseData.id,
                      content: responseData.content,
                      author: responseData.author || 'Anonymous',
                      approved: isApproved,
                      createdAt: responseData.createdAt,
                      updatedAt: responseData.updatedAt,
                    };
                  }
                  return item;
                }),
              })),
            };
          });
        });

        // 注册到 commentStatusManager 进行状态跟踪
        // SSE 为主要更新机制（blog.comment.moderated 事件）；
        // 轮询作为 SSE 断连时的降级保底，仅 3 次 × 60 秒 = 3 分钟兜底
        commentStatusManager.registerPendingComment(
          context.tempId,
          responseData.id,
          articleId,
          { maxPollAttempts: 3, pollInterval: 60000 },
        );

        // 启动降级轮询（SSE 到达后 updateCommentStatus 会自动 clearPollingTimer）
        commentStatusManager.startStatusPolling(
          context.tempId,
          createStatusCheckCallback(articleId, responseData.id),
        );

        success('评论发表成功');
      },
      onError: (err, _variables, context) => {
        // 回滚所有匹配的缓存条目到之前的状态
        if (context?.previousEntries) {
          context.previousEntries.forEach(([key, data]) => {
            queryClient.setQueryData(key, data);
          });
        }

        // 清理 commentStatusManager 中的临时记录
        if (context?.tempId) {
          commentStatusManager.removePendingComment(context.tempId);
        }

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
