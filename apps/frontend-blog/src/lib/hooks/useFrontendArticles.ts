'use client';

import { useQuery } from '@tanstack/react-query';
import { frontendBlogApi } from '@/lib/api/frontendBlogApi';
import type {
  FrontendCategory,
  FrontendCategoryWithArticles,
  FrontendTagWithArticles,
} from '@/lib/types/frontend-blog';
import { useCurrentLocale } from './useCurrentLocale';

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
  const locale = useCurrentLocale();

  return useQuery({
    queryKey: ['frontendArticles', locale, params],
    queryFn: async () => {
      return await frontendBlogApi.getArticles(params);
    },
    staleTime: 5 * 60 * 1000, // 5分钟缓存
    retry: 2, // 失败时重试2次
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000), // 指数退避重试
  });
}

/**
 * 获取精选文章列表 Hook（用于首页 Hero 区域）
 */
export function useFrontendFeaturedArticles() {
  const locale = useCurrentLocale();

  return useQuery({
    queryKey: ['frontendFeaturedArticles', locale],
    queryFn: () => frontendBlogApi.getFeaturedArticles(locale),
    staleTime: 5 * 60 * 1000, // 5分钟缓存
    retry: 2,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
  });
}

/**
 * 根据 Slug 获取前端博客文章详情 Hook（简化版）
 *
 * 当 initialData 中 content/contentMd 被剥离时（为节省 Cloudflare Workers CPU），
 * 设置 staleTime: 0 让 React Query 立即发起后台 refetch 获取完整文章。
 */
export function useFrontendArticleBySlug(slug: string, initialData?: any) {
  const locale = useCurrentLocale();

  // 检测 content 是否被剥离（RSC 负载优化：Server Component 去掉了大字段）
  const isContentStripped = !!(
    initialData &&
    !initialData.content &&
    !initialData.contentMd
  );

  return useQuery({
    queryKey: ['frontendArticle', slug, locale],
    queryFn: () => frontendBlogApi.getArticleBySlug(slug, locale),
    // 如果 content 被剥离，立即 refetch 获取完整文章数据
    // 否则按正常 1 小时缓存
    staleTime: isContentStripped ? 0 : 60 * 60 * 1000,
    enabled: !!slug,
    initialData,
  });
}

/**
 * 获取前端博客热门文章 Hook（简化版）
 */
export function useFrontendPopularArticles(limit = 10) {
  const locale = useCurrentLocale();

  return useQuery({
    queryKey: ['frontendPopularArticles', limit, locale],
    queryFn: () => frontendBlogApi.getPopularArticles(limit),
    staleTime: 10 * 60 * 1000, // 10分钟缓存
  });
}

/**
 * 获取前端博客相关文章 Hook（简化版）
 */
export function useFrontendRelatedArticles(articleId: string, limit = 5) {
  const locale = useCurrentLocale();

  return useQuery({
    queryKey: ['frontendRelatedArticles', articleId, limit, locale],
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
  const locale = useCurrentLocale();

  return useQuery({
    queryKey: ['frontendSearchArticles', query, params, locale],
    queryFn: () => frontendBlogApi.searchArticles(query, params),
    staleTime: 1 * 60 * 1000,
    enabled: !!query && query.length > 0,
  });
}

/**
 * 获取前端博客分类列表 Hook（简化版）
 */
export function useFrontendCategories(initialData?: FrontendCategory[]) {
  const locale = useCurrentLocale();

  return useQuery({
    queryKey: ['frontendCategories', locale],
    queryFn: () => frontendBlogApi.getCategories(locale),
    staleTime: 60 * 60 * 1000, // 1小时缓存
    initialData,
  });
}

/**
 * 获取前端博客分类详情 Hook（简化版）
 *
 * 支持 initialData：当服务端组件已取数时，React Query 直接使用缓存数据，
 * 避免 SSR 和首次客户端渲染间的空白期。
 */
export function useFrontendCategoryBySlug(
  slug: string,
  params?: {
    page?: number;
    pageSize?: number;
  },
  initialData?: FrontendCategoryWithArticles | null,
) {
  const locale = useCurrentLocale();

  return useQuery({
    queryKey: ['frontendCategory', slug, locale, params],
    queryFn: () =>
      frontendBlogApi.getCategoryBySlug(slug, { ...params, lang: locale }),
    staleTime: 5 * 60 * 1000, // 5分钟缓存
    enabled: !!slug,
    initialData: initialData ?? undefined,
  });
}

/**
 * 获取前端博客标签列表 Hook（简化版）
 */
export function useFrontendTags(options?: { initialData?: any[] }) {
  const locale = useCurrentLocale();

  return useQuery({
    queryKey: ['frontendTags', locale],
    queryFn: () => frontendBlogApi.getTags(locale),
    staleTime: 60 * 60 * 1000, // 1小时缓存
    initialData: options?.initialData,
  });
}

/**
 * 获取前端博客标签详情 Hook（简化版）
 *
 * 支持 initialData：当服务端组件已取数时，React Query 直接使用缓存数据，
 * 避免 SSR 和首次客户端渲染间的空白期。
 */
export function useFrontendTagBySlug(
  slug: string,
  params?: {
    page?: number;
    pageSize?: number;
  },
  initialData?: FrontendTagWithArticles | null,
) {
  const locale = useCurrentLocale();

  return useQuery({
    queryKey: ['frontendTag', slug, locale, params],
    queryFn: () =>
      frontendBlogApi.getTagBySlug(slug, { ...params, lang: locale }),
    staleTime: 5 * 60 * 1000, // 5分钟缓存
    enabled: !!slug,
    initialData: initialData ?? undefined,
  });
}

/**
 * 获取前端博客统计 Hook（简化版）
 */
export function useFrontendBlogStats() {
  const locale = useCurrentLocale();

  return useQuery({
    queryKey: ['frontendBlogStats', locale],
    queryFn: () => frontendBlogApi.getBlogStats(),
    staleTime: 60 * 60 * 1000, // 1小时缓存
  });
}

/**
 * 获取前端博客文章归档 Hook（简化版）
 */
export function useFrontendArticleArchive() {
  const locale = useCurrentLocale();

  return useQuery({
    queryKey: ['frontendArticleArchive', locale],
    queryFn: () => frontendBlogApi.getArticleArchive(),
    staleTime: 30 * 60 * 1000, // 30分钟缓存
  });
}

/**
 * 获取前端博客热门标签 Hook（简化版）
 */
export function useFrontendPopularTags(limit = 20) {
  const locale = useCurrentLocale();

  return useQuery({
    queryKey: ['frontendPopularTags', limit, locale],
    queryFn: () => frontendBlogApi.getPopularTags(limit),
    staleTime: 30 * 60 * 1000, // 30分钟缓存
  });
}
