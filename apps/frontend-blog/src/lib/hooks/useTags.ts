'use client';

import { useQuery } from '@tanstack/react-query';
import { blogApi } from '@/lib/api/blogApi';

/**
 * 获取所有标签 Hook
 */
export function useTags() {
  return useQuery({
    queryKey: ['tags'],
    queryFn: () => blogApi.getTags(),
    staleTime: 60 * 60 * 1000, // 1小时缓存
  });
}

/**
 * 根据 Slug 获取标签详情 Hook
 */
export function useTagBySlug(slug: string) {
  return useQuery({
    queryKey: ['tag', slug],
    queryFn: () => blogApi.getTagBySlug(slug),
    staleTime: 60 * 60 * 1000,
    enabled: !!slug,
  });
}