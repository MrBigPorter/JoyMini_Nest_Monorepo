'use client';

import { useQuery } from '@tanstack/react-query';
import { frontendBlogApi } from '@/lib/api/frontendBlogApi';
import { useAuth } from '@/lib/hooks/useAuth';

/**
 * 批量查询收藏状态 Hook
 * 用于首页等需要批量查询多个文章收藏状态的场景
 */
export function useBatchBookmarkStatus(articleIds: string[]) {
  const { isAuthenticated } = useAuth();

  return useQuery({
    queryKey: ['batch-bookmark-status', articleIds],
    queryFn: () => frontendBlogApi.batchCheckBookmarkStatus(articleIds),
    enabled: articleIds.length > 0 && isAuthenticated,
    staleTime: 5 * 60 * 1000, // 5分钟缓存
    gcTime: 10 * 60 * 1000, // 10分钟垃圾回收时间
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
}

/**
 * 批量查询收藏状态 Hook（简化版）
 * 返回文章ID到收藏状态的映射
 */
export function useBatchBookmarkStatusMap(articleIds: string[]) {
  const { data, ...rest } = useBatchBookmarkStatus(articleIds);
  return {
    ...rest,
    statusMap: data?.statusMap ?? new Map(),
  };
}

/**
 * 批量查询收藏状态 Hook（返回数组格式）
 * 保持与现有 useBookmarkStatus 类似的接口
 */
export function useBatchBookmarkStatusArray(articleIds: string[]) {
  const { data, ...rest } = useBatchBookmarkStatus(articleIds);
  return {
    ...rest,
    results: data?.results ?? [],
  };
}
