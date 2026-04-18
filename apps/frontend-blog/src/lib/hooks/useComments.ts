'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { frontendBlogApi } from '@/lib/api/frontendBlogApi';
import {
  commentStatusManager,
  createStatusCheckCallback,
  showRejectionNotification,
} from '@/lib/utils/commentStatus';

/**
 * 获取文章评论列表 Hook
 */
export function useComments(
  articleId: string,
  params?: {
    page?: number;
    pageSize?: number;
  },
) {
  return useQuery({
    queryKey: ['comments', articleId, params],
    queryFn: () => frontendBlogApi.getComments(articleId, params),
    staleTime: 5 * 60 * 1000, // 5分钟缓存
    enabled: !!articleId,
  });
}

/**
 * 提交评论 Mutation Hook
 */
export function usePostComment(articleId: string, params?: any) {
  const queryClient = useQueryClient();

  // 支持两种缓存键：普通查询和无限滚动查询
  // 注意：无限滚动查询使用 { pageSize: 20 } 作为参数
  const exactQueryKey = ['comments', articleId, params];
  const infiniteQueryKey = [
    'comments',
    'infinite',
    articleId,
    { pageSize: 20 },
  ];

  return useMutation({
    mutationFn: (data: {
      author: string;
      email?: string;
      website?: string;
      content: string;
      parentId?: string;
    }) => frontendBlogApi.postComment(articleId, data),
    onMutate: async (newComment) => {
      // 取消正在进行的查询
      await queryClient.cancelQueries({ queryKey: ['comments', articleId] });
      await queryClient.cancelQueries({
        queryKey: ['comments', 'infinite', articleId],
      });

      // 获取之前的评论数据 - 使用精确缓存键
      const previousComments = queryClient.getQueryData(exactQueryKey);
      const previousInfiniteData = queryClient.getQueryData(infiniteQueryKey);

      // 构建新的评论对象（模拟服务器响应）
      // 修改：将乐观评论标记为approved: true，实现完全即时显示
      // 用户提交评论后立即显示为正常评论，与已通过审核的评论外观一致
      // 使用更精确的唯一ID，避免毫秒级重复
      const tempId = `temp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const optimisticComment: any = {
        id: tempId,
        articleId: articleId,
        author: newComment.author,
        email: newComment.email || null,
        website: newComment.website || null,
        content: newComment.content,
        parentId: newComment.parentId || null,
        approved: true, // 立即显示为已通过审核，实现完全即时显示
        likes: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        children: [],
      };

      // 添加临时标记，但使用Symbol避免影响类型检查
      Object.defineProperty(optimisticComment, '_isOptimistic', {
        value: true,
        enumerable: false, // 不可枚举，避免影响JSON序列化和类型检查
        writable: false,
      });

      // 更新缓存 - 使用精确缓存键
      queryClient.setQueryData(exactQueryKey, (old: any) => {
        // 如果缓存为空，创建初始数据结构
        if (!old) {
          // 创建初始缓存结构
          const initialData = {
            items: [],
            total: 0,
            page: 1,
            pageSize: 20,
            totalPages: 0,
          };

          // 即使缓存为空，也添加评论到缓存中
          // 如果是回复评论，直接添加到items中，等待后续状态更新
          return {
            ...initialData,
            items: [optimisticComment],
            total: 1,
          };
        }

        // 如果是回复，需要找到父评论并添加
        if (newComment.parentId) {
          // 深度复制评论树
          const updateCommentTree = (comments: any[]): any[] => {
            return comments.map((comment) => {
              // 如果找到父评论
              if (comment.id === newComment.parentId) {
                return {
                  ...comment,
                  children: [...(comment.children || []), optimisticComment],
                };
              }
              // 如果有子评论，递归查找
              if (comment.children && comment.children.length > 0) {
                return {
                  ...comment,
                  children: updateCommentTree(comment.children),
                };
              }
              return comment;
            });
          };

          const updatedItems = updateCommentTree(old.items);

          return {
            ...old,
            items: updatedItems,
          };
        } else {
          // 如果是新评论，添加到列表开头
          const newItems = [optimisticComment, ...old.items];

          return {
            ...old,
            items: newItems,
            total: old.total + 1,
          };
        }
      });

      // 更新无限滚动查询缓存
      queryClient.setQueryData(infiniteQueryKey, (old: any) => {
        if (!old) return old;

        // 无限滚动查询的数据结构不同
        // 只更新第一页，避免重复添加临时评论到多个页面
        const updateInfiniteData = (pages: any[]): any[] => {
          if (pages.length === 0) {
            // 如果没有页面，创建一个新页面
            return [
              {
                items: [optimisticComment],
                total: 1,
                page: 1,
                pageSize: 20,
                totalPages: 1,
              },
            ];
          }

          return pages.map((page, index) => {
            // 只处理第一页（index === 0）
            if (index === 0) {
              // 如果是回复，需要找到父评论并添加
              if (newComment.parentId) {
                // 深度复制评论树
                const updateCommentTree = (comments: any[]): any[] => {
                  return comments.map((comment) => {
                    // 如果找到父评论
                    if (comment.id === newComment.parentId) {
                      return {
                        ...comment,
                        children: [
                          ...(comment.children || []),
                          optimisticComment,
                        ],
                      };
                    }
                    // 如果有子评论，递归查找
                    if (comment.children && comment.children.length > 0) {
                      return {
                        ...comment,
                        children: updateCommentTree(comment.children),
                      };
                    }
                    return comment;
                  });
                };

                const updatedItems = updateCommentTree(page.items);

                return {
                  ...page,
                  items: updatedItems,
                };
              } else {
                // 如果是新评论，添加到第一页的开头
                const newItems = [optimisticComment, ...page.items];

                return {
                  ...page,
                  items: newItems,
                  total: page.total + 1,
                };
              }
            }
            // 其他页面保持不变
            return page;
          });
        };

        return {
          ...old,
          pages: updateInfiniteData(old.pages || []),
        };
      });

      // 返回临时评论ID和精确缓存键，供onSuccess使用
      return {
        previousComments,
        previousInfiniteData,
        optimisticId: optimisticComment.id,
        exactQueryKey,
        infiniteQueryKey,
      };
    },
    onError: (err, newComment, context) => {
      // 出错时回滚到之前的状态
      if (context?.previousComments) {
        queryClient.setQueryData(exactQueryKey, context.previousComments);
      }
      if (context?.previousInfiniteData) {
        queryClient.setQueryData(
          context.infiniteQueryKey,
          context.previousInfiniteData,
        );
      }
    },
    onSuccess: (data, variables, context) => {
      // 获取临时评论ID（从onMutate传递过来）
      const tempId = context?.optimisticId;
      if (!tempId) {
        return;
      }

      // 注册临时评论到状态管理器
      commentStatusManager.registerPendingComment(
        tempId,
        data.id, // 服务器返回的真实评论ID
        articleId,
        {
          maxPollAttempts: 10, // 10次尝试，每次30秒 = 5分钟
          pollInterval: 30000, // 30秒
        },
      );

      // 创建状态检查回调
      const statusCheckCallback = createStatusCheckCallback(articleId, data.id);

      // 启动状态轮询
      commentStatusManager.startStatusPolling(tempId, statusCheckCallback);

      // 监听状态变化
      const unsubscribe = commentStatusManager.subscribe(tempId, (status) => {
        if (status === 'approved') {
          // 获取缓存键
          const exactKey = context?.exactQueryKey;
          const infiniteKey = context?.infiniteQueryKey;

          // 定义一个通用的"清洗并转正"函数
          const mergeOptimisticData = (oldData: any) => {
            if (!oldData) return oldData;

            // 内部递归函数：移除 tempId，并确保不与 data.id 冲突
            const processItems = (items: any[]): any[] => {
              return items
                .filter((item) => item.id !== tempId && item.id !== data.id) // 同时过滤掉临时ID和已存在的真ID
                .map((item) => ({
                  ...item,
                  children: item.children ? processItems(item.children) : [],
                }));
            };

            // 如果是无限滚动结构 (pages)
            if (oldData.pages) {
              const newPages = oldData.pages.map((page: any) => ({
                ...page,
                items: processItems(page.items || []),
              }));
              // 将真实的评论插入到第一页最前面（因为它现在已经通过接口确认了）
              if (newPages.length > 0) {
                newPages[0].items = [data, ...newPages[0].items];
                // 更新总数
                newPages[0].total = (newPages[0].total || 0) + 1;
              }
              return { ...oldData, pages: newPages };
            }

            // 如果是普通列表结构 (items)
            const cleanedItems = processItems(oldData.items || []);
            return {
              ...oldData,
              items: [data, ...cleanedItems],
              total: (oldData.total || 0) + 1,
            };
          };

          // 执行更新 - 使用新的清洗逻辑
          if (exactKey) queryClient.setQueryData(exactKey, mergeOptimisticData);
          if (infiniteKey)
            queryClient.setQueryData(infiniteKey, mergeOptimisticData);

          // 关键：最后手动触发一次静默刷新，确保万无一失
          queryClient.invalidateQueries({ queryKey: ['comments', articleId] });

          // 评论审核通过后，启动自动回复轮询
          // 动态导入以避免循环依赖
          import('@/lib/utils/autoReplyStatus').then(
            ({ autoReplyStatusManager }) => {
              autoReplyStatusManager.registerAutoReplyTracker(
                data.id, // 使用真实评论ID
                articleId,
                {
                  startDelay: 30000, // 30秒后开始轮询（等待自动回复生成）
                  pollInterval: 15000, // 15秒轮询间隔
                  maxPollAttempts: 5, // 最多尝试5次（共75秒）
                },
              );

              // 监听自动回复状态
              autoReplyStatusManager.subscribe(
                data.id,
                (autoReplyStatus, reply) => {
                  if (autoReplyStatus === 'received' && reply) {
                    // 收到自动回复，刷新评论列表
                    queryClient.invalidateQueries({
                      queryKey: ['comments', articleId],
                    });

                    // 显示通知
                    import('@/lib/utils/autoReplyStatus').then(
                      ({ showAutoReplyNotification }) => {
                        showAutoReplyNotification(reply);
                      },
                    );
                  }
                },
              );
            },
          );

          // 取消订阅
          unsubscribe();
        } else if (status === 'rejected') {
          // 评论被拒绝，从缓存中移除
          const exactKey = context?.exactQueryKey;
          const infiniteKey = context?.infiniteQueryKey;

          const removeRejectedComment = (oldData: any) => {
            if (!oldData) return oldData;

            // 内部递归函数：移除 tempId
            const removeTempId = (items: any[]): any[] => {
              return items
                .filter((item) => item.id !== tempId)
                .map((item) => ({
                  ...item,
                  children: item.children ? removeTempId(item.children) : [],
                }));
            };

            // 如果是无限滚动结构 (pages)
            if (oldData.pages) {
              const newPages = oldData.pages.map((page: any) => ({
                ...page,
                items: removeTempId(page.items || []),
                total: Math.max(0, (page.total || 0) - 1),
              }));
              return { ...oldData, pages: newPages };
            }

            // 如果是普通列表结构 (items)
            const cleanedItems = removeTempId(oldData.items || []);
            return {
              ...oldData,
              items: cleanedItems,
              total: Math.max(0, (oldData.total || 0) - 1),
            };
          };

          // 执行更新
          if (exactKey)
            queryClient.setQueryData(exactKey, removeRejectedComment);
          if (infiniteKey)
            queryClient.setQueryData(infiniteKey, removeRejectedComment);

          // 显示拒绝通知
          showRejectionNotification();

          // 取消订阅
          unsubscribe();
        } else if (status === 'unknown') {
          // 状态未知（轮询超时），保持显示但标记为超时
          // 可以在这里添加超时处理逻辑，比如显示"审核超时"提示
        }
      });
    },
  });
}
