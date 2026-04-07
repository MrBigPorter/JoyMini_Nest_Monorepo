'use client';

import { useQuery } from '@tanstack/react-query';
import { blogApi } from '@/lib/api/blogApi';

/**
 * 获取所有分类 Hook
 */
export function useCategories() {
  return useQuery({
    queryKey: ['categories'],
    queryFn: () => blogApi.getCategories(),
    staleTime: 60 * 60 * 1000, // 1小时缓存
  });
}

/**
 * 根据 Slug 获取分类详情 Hook
 */
export function useCategoryBySlug(slug: string) {
  return useQuery({
    queryKey: ['category', slug],
    queryFn: () => blogApi.getCategoryBySlug(slug),
    staleTime: 60 * 60 * 1000,
    enabled: !!slug,
  });
}