'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { blogApi } from '@/lib/api/blogApi';

/**
 * 获取文章评论列表 Hook
 */
export function useComments(articleId: string, params?: {
  page?: number;
  pageSize?: number;
}) {
  return useQuery({
    queryKey: ['comments', articleId, params],
    queryFn: () => blogApi.getComments(articleId, params),
    staleTime: 5 * 60 * 1000, // 5分钟缓存
    enabled: !!articleId,
  });
}

/**
 * 提交评论 Mutation Hook
 */
export function usePostComment(articleId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: {
      author: string;
      email?: string;
      content: string;
      parentId?: string;
    }) => blogApi.postComment(articleId, data),
    onSuccess: () => {
      // 评论提交成功后刷新评论列表缓存
      void queryClient.invalidateQueries({ queryKey: ['comments', articleId] });
    },
  });
}