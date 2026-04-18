'use client';

import { useQuery } from '@tanstack/react-query';
import { frontendBlogApi } from '@/lib/api/frontendBlogApi';
import { useParams } from 'next/navigation';

/**
 * 获取前端博客文章列表 Hook（简化版）
 * 使用 TanStack Query 自动缓存
 */
export function useFrontendArticles(params?: {
  page?: number;
  pageSize?: number;
  categoryId?: string;
  tagId?: string;
}) {
  return useQuery({
    queryKey: ['frontendArticles', params],
    queryFn: async () => {
      return await frontendBlogApi.getArticles(params);
    },
    staleTime: 5 * 60 * 1000, // 5分钟缓存
    retry: 2, // 失败时重试2次
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000), // 指数退避重试
  });
}

/**
 * 根据 Slug 获取前端博客文章详情 Hook（简化版）
 */
export function useFrontendArticleBySlug(slug: string) {
  return useQuery({
    queryKey: ['frontendArticle', slug],
    queryFn: () => frontendBlogApi.getArticleBySlug(slug),
    staleTime: 60 * 60 * 1000, // 1小时缓存
    enabled: !!slug,
  });
}

/**
 * 获取前端博客热门文章 Hook（简化版）
 */
export function useFrontendPopularArticles(limit = 10) {
  return useQuery({
    queryKey: ['frontendPopularArticles', limit],
    queryFn: () => frontendBlogApi.getPopularArticles(limit),
    staleTime: 10 * 60 * 1000, // 10分钟缓存
  });
}

/**
 * 获取前端博客相关文章 Hook（简化版）
 */
export function useFrontendRelatedArticles(articleId: string, limit = 5) {
  return useQuery({
    queryKey: ['frontendRelatedArticles', articleId, limit],
    queryFn: () => frontendBlogApi.getRelatedArticles(articleId, limit),
    staleTime: 10 * 60 * 1000,
    enabled: !!articleId,
  });
}

/**
 * 搜索前端博客文章 Hook（简化版）
 */
export function useFrontendSearchArticles(
  query: string,
  params?: {
    page?: number;
    pageSize?: number;
  },
) {
  return useQuery({
    queryKey: ['frontendSearchArticles', query, params],
    queryFn: () => frontendBlogApi.searchArticles(query, params),
    staleTime: 1 * 60 * 1000,
    enabled: !!query && query.length > 0,
  });
}

/**
 * 获取前端博客分类列表 Hook（简化版）
 */
export function useFrontendCategories() {
  // 从路由参数获取当前语言
  const params = useParams();
  const locale = (params.locale as string) || 'zh';

  return useQuery({
    queryKey: ['frontendCategories', locale],
    queryFn: () => frontendBlogApi.getCategories(),
    staleTime: 60 * 60 * 1000, // 1小时缓存
  });
}

/**
 * 获取前端博客分类详情 Hook（简化版）
 */
export function useFrontendCategoryBySlug(
  slug: string,
  params?: {
    page?: number;
    pageSize?: number;
  },
) {
  // 从路由参数获取当前语言
  const routeParams = useParams();
  const locale = (routeParams.locale as string) || 'zh';

  return useQuery({
    queryKey: ['frontendCategory', slug, locale, params],
    queryFn: () => frontendBlogApi.getCategoryBySlug(slug, params),
    staleTime: 5 * 60 * 1000, // 5分钟缓存
    enabled: !!slug,
  });
}

/**
 * 获取前端博客标签列表 Hook（简化版）
 */
export function useFrontendTags() {
  // 从路由参数获取当前语言
  const params = useParams();
  const locale = (params.locale as string) || 'zh';

  return useQuery({
    queryKey: ['frontendTags', locale],
    queryFn: () => frontendBlogApi.getTags(),
    staleTime: 60 * 60 * 1000, // 1小时缓存
  });
}

/**
 * 获取前端博客标签详情 Hook（简化版）
 */
export function useFrontendTagBySlug(
  slug: string,
  params?: {
    page?: number;
    pageSize?: number;
  },
) {
  // 从路由参数获取当前语言
  const routeParams = useParams();
  const locale = (routeParams.locale as string) || 'zh';

  return useQuery({
    queryKey: ['frontendTag', slug, locale, params],
    queryFn: () => frontendBlogApi.getTagBySlug(slug, params),
    staleTime: 5 * 60 * 1000, // 5分钟缓存
    enabled: !!slug,
  });
}

/**
 * 获取前端博客统计 Hook（简化版）
 */
export function useFrontendBlogStats() {
  return useQuery({
    queryKey: ['frontendBlogStats'],
    queryFn: () => frontendBlogApi.getBlogStats(),
    staleTime: 60 * 60 * 1000, // 1小时缓存
  });
}

/**
 * 获取前端博客文章归档 Hook（简化版）
 */
export function useFrontendArticleArchive() {
  return useQuery({
    queryKey: ['frontendArticleArchive'],
    queryFn: () => frontendBlogApi.getArticleArchive(),
    staleTime: 30 * 60 * 1000, // 30分钟缓存
  });
}

/**
 * 获取前端博客热门标签 Hook（简化版）
 */
export function useFrontendPopularTags(limit = 20) {
  return useQuery({
    queryKey: ['frontendPopularTags', limit],
    queryFn: () => frontendBlogApi.getPopularTags(limit),
    staleTime: 30 * 60 * 1000, // 30分钟缓存
  });
}
