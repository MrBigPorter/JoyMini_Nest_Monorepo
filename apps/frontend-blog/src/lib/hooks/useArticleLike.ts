'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { frontendBlogApi } from '@/lib/api/frontendBlogApi';
import { useToast } from '@/lib/hooks/useToast';
import type {
  LikeResponse,
  LikeStatusResponse,
} from '@/lib/types/frontend-blog';

/**
 * 文章点赞相关 Hook
 *
 * 提供：
 * 1. useLikeStatus(slug) — 查询点赞状态
 * 2. useLikeArticle(slug) — 点赞（带乐观更新 likeCount）
 * 3. useUnlikeArticle(slug) — 取消点赞（带乐观更新 likeCount）
 */

const likeStatusKey = (slug: string) => ['likeStatus', slug] as const;

/**
 * 获取文章点赞状态 Hook
 */
export function useLikeStatus(slug: string) {
  return useQuery<LikeStatusResponse>({
    queryKey: likeStatusKey(slug),
    queryFn: () => frontendBlogApi.checkLikeStatus(slug),
    enabled: !!slug,
    staleTime: 5 * 60 * 1000, // 5分钟缓存
    retry: 2,
  });
}

/**
 * 点赞文章 Hook（带乐观更新）
 *
 * 乐观更新流程：
 * 1. onMutate: 立即更新 likeStatus 缓存为 liked: true
 * 2. onSuccess: 刷新 likeStatus 缓存
 * 3. onError: 回滚 likeStatus 缓存
 */
export function useLikeArticle(slug: string) {
  const queryClient = useQueryClient();
  const { success, error } = useToast();

  return useMutation({
    mutationFn: () => frontendBlogApi.likeArticle(slug),
    onMutate: async () => {
      // 取消进行中的查询，避免覆盖乐观更新
      await queryClient.cancelQueries({ queryKey: likeStatusKey(slug) });

      // 保存当前状态用于回滚
      const previousStatus = queryClient.getQueryData<LikeStatusResponse>(
        likeStatusKey(slug),
      );

      // 乐观更新：立即标记为已点赞
      queryClient.setQueryData<LikeStatusResponse>(likeStatusKey(slug), {
        liked: true,
      });

      return { previousStatus };
    },
    onSuccess: (data: LikeResponse) => {
      // 刷新点赞状态（确保与服务端同步）
      queryClient.invalidateQueries({ queryKey: likeStatusKey(slug) });
      success(`点赞成功！当前点赞数: ${data.likeCount}`);
    },
    onError: (_err, _variables, context) => {
      // 回滚到之前的状态
      if (context?.previousStatus) {
        queryClient.setQueryData(likeStatusKey(slug), context.previousStatus);
      }
      error('点赞失败，请稍后再试');
    },
  });
}

/**
 * 取消点赞文章 Hook（带乐观更新）
 *
 * 乐观更新流程：
 * 1. onMutate: 立即更新 likeStatus 缓存为 liked: false
 * 2. onSuccess: 刷新 likeStatus 缓存
 * 3. onError: 回滚 likeStatus 缓存
 */
export function useUnlikeArticle(slug: string) {
  const queryClient = useQueryClient();
  const { success, error } = useToast();

  return useMutation({
    mutationFn: () => frontendBlogApi.unlikeArticle(slug),
    onMutate: async () => {
      // 取消进行中的查询，避免覆盖乐观更新
      await queryClient.cancelQueries({ queryKey: likeStatusKey(slug) });

      // 保存当前状态用于回滚
      const previousStatus = queryClient.getQueryData<LikeStatusResponse>(
        likeStatusKey(slug),
      );

      // 乐观更新：立即标记为未点赞
      queryClient.setQueryData<LikeStatusResponse>(likeStatusKey(slug), {
        liked: false,
      });

      return { previousStatus };
    },
    onSuccess: (data: LikeResponse) => {
      // 刷新点赞状态
      queryClient.invalidateQueries({ queryKey: likeStatusKey(slug) });
      success(`已取消点赞。当前点赞数: ${data.likeCount}`);
    },
    onError: (_err, _variables, context) => {
      // 回滚到之前的状态
      if (context?.previousStatus) {
        queryClient.setQueryData(likeStatusKey(slug), context.previousStatus);
      }
      error('取消点赞失败，请稍后再试');
    },
  });
}
