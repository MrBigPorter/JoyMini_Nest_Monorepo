'use client';

import { useQuery } from '@tanstack/react-query';
import { frontendBlogApi } from '@/lib/api/frontendBlogApi';
import { useLocalizedQueryKey } from '@/lib/api/queryKeys';
import {
  syncArticles,
  getCachedArticles,
  getCachedTotalPages,
  syncCategories,
  getCachedCategories,
  syncArticleContent,
  getCachedArticleContent,
  syncTags,
  getCachedTags,
} from '@/lib/db/sync';
import type {
  FrontendCategory,
  FrontendCategoryWithArticles,
  FrontendTag,
  FrontendTagWithArticles,
  FrontendPaginatedResponse,
  FrontendArticle,
} from '@/lib/types/frontend-blog';
import { useCurrentLocale } from './useCurrentLocale';

/**
 * 获取前端博客文章列表 Hook（简化版）
 * 使用 TanStack Query + IndexedDB Local-First 策略：
 *   1. 并行发起网络请求（不 await，让它在后台运行）
 *   2. 网络成功后同步数据到 IndexedDB
 *   3. 先尝试从 IndexedDB 返回缓存数据（即时渲染）
 *   4. 无缓存时 fallback 到网络响应
 */
export function useFrontendArticles(params?: {
  page?: number;
  pageSize?: number;
  categoryId?: string;
  tagId?: string;
  initialData?: FrontendPaginatedResponse<FrontendArticle>;
  queryKeyPrefix?: string;
}) {
  const locale = useCurrentLocale();
  const keyPrefix = params?.queryKeyPrefix || 'frontendArticles';

  const { page = 1, pageSize = 10 } = params || {};

  return useQuery({
    queryKey: useLocalizedQueryKey(keyPrefix, {
      page,
      pageSize,
      categoryId: params?.categoryId,
      tagId: params?.tagId,
    }),
    queryFn: async (): Promise<FrontendPaginatedResponse<FrontendArticle>> => {
      // 1. 并行发起网络请求（不阻塞渲染）
      const networkPromise = frontendBlogApi.getArticles({
        lang: locale,
        page,
        pageSize,
        categoryId: params?.categoryId,
        tagId: params?.tagId,
      });

      // 2. 网络成功时同步到 IndexedDB（后台 fire-and-forget）
      networkPromise
        .then((data) => {
          if (data?.items) {
            syncArticles(data.items, locale, page, params?.categoryId);
          }
        })
        .catch(() => {
          // 网络失败不阻塞 UI
        });

      // 3. 先尝试读取 IndexedDB 缓存
      const cached = await getCachedArticles(locale, page, params?.categoryId);

      // 4. 有缓存 → 立即返回（即时渲染），网络后台更新
      if (cached.length > 0) {
        return {
          items: cached,
          totalPages: await getCachedTotalPages(locale),
          total: cached.length,
          page,
          pageSize,
        } as FrontendPaginatedResponse<FrontendArticle>;
      }

      // 5. 无缓存 → 等待网络响应
      return networkPromise;
    },
    staleTime: 5 * 60 * 1000, // 5分钟缓存
    networkMode: 'offlineFirst', // 离线时允许从 IndexedDB 读取缓存
    initialData: params?.initialData,
    retry: 2,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
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
 * 使用 Local-First IndexedDB 策略缓存文章正文：
 *   1. 并行发起网络请求（不 await，让它在后台运行）
 *   2. 网络成功后同步文章正文到 IndexedDB
 *   3. 先尝试从 IndexedDB 返回缓存数据（即时渲染，支持离线阅读）
 *   4. 无缓存时 fallback 到网络响应
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
    queryFn: async () => {
      // 1. 并行发起网络请求（不阻塞渲染）
      const networkPromise = frontendBlogApi.getArticleBySlug(slug, locale);

      // 2. 网络成功时同步文章正文到 IndexedDB（后台 fire-and-forget）
      networkPromise
        .then((data) => {
          if (data?.content || data?.contentMd) {
            syncArticleContent(data, locale);
          }
        })
        .catch(() => {
          // 网络失败不阻塞 UI
        });

      // 3. 先尝试读取 IndexedDB 缓存
      const cached = await getCachedArticleContent(slug, locale);

      // 4. 有缓存 → 立即返回（即时渲染，支持离线阅读）
      if (cached) {
        return cached;
      }

      // 5. 无缓存 → 等待网络响应
      return networkPromise;
    },
    // 如果 content 被剥离，立即 refetch 获取完整文章数据
    // 否则按正常 1 小时缓存
    staleTime: isContentStripped ? 0 : 60 * 60 * 1000,
    networkMode: 'offlineFirst', // 离线时允许从 IndexedDB 读取缓存
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
 *
 * 使用 Local-First IndexedDB 策略：
 *   1. 并行发起网络请求（不 await，让它在后台运行）
 *   2. 网络成功后同步数据到 IndexedDB
 *   3. 先尝试从 IndexedDB 返回缓存数据（即时渲染）
 *   4. 无缓存时 fallback 到网络响应
 */
export function useFrontendCategories(initialData?: FrontendCategory[]) {
  const locale = useCurrentLocale();

  return useQuery({
    queryKey: ['frontendCategories', locale],
    queryFn: async () => {
      // 1. 并行发起网络请求（不阻塞渲染）
      const networkPromise = frontendBlogApi.getCategories(locale);

      // 2. 网络成功时同步到 IndexedDB（后台 fire-and-forget）
      networkPromise
        .then((data) => {
          if (data?.length) {
            syncCategories(data, locale);
          }
        })
        .catch(() => {
          // 网络失败不阻塞 UI
        });

      // 3. 先尝试读取 IndexedDB 缓存
      const cached = await getCachedCategories(locale);

      // 4. 有缓存 → 立即返回（即时渲染），网络后台更新
      if (cached.length > 0) {
        return cached;
      }

      // 5. 无缓存 → 等待网络响应
      return networkPromise;
    },
    staleTime: 60 * 60 * 1000, // 1小时缓存
    networkMode: 'offlineFirst', // 离线时允许从 IndexedDB 读取缓存
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
 *
 * 使用 Local-First IndexedDB 策略：
 *   1. 并行发起网络请求（不 await，让它在后台运行）
 *   2. 网络成功后同步数据到 IndexedDB
 *   3. 先尝试从 IndexedDB 返回缓存数据（即时渲染）
 *   4. 无缓存时 fallback 到网络响应
 */
export function useFrontendTags(options?: { initialData?: any[] }) {
  const locale = useCurrentLocale();

  return useQuery({
    queryKey: ['frontendTags', locale],
    queryFn: async () => {
      // 1. 并行发起网络请求（不阻塞渲染）
      const networkPromise = frontendBlogApi.getTags(locale);

      // 2. 网络成功时同步到 IndexedDB（后台 fire-and-forget）
      networkPromise
        .then((data) => {
          if (data?.length) {
            syncTags(data, locale);
          }
        })
        .catch(() => {
          // 网络失败不阻塞 UI
        });

      // 3. 先尝试读取 IndexedDB 缓存
      const cached = await getCachedTags(locale);

      // 4. 有缓存 → 立即返回（即时渲染），网络后台更新
      if (cached.length > 0) {
        return cached;
      }

      // 5. 无缓存 → 等待网络响应
      return networkPromise;
    },
    staleTime: 60 * 60 * 1000, // 1小时缓存
    networkMode: 'offlineFirst', // 离线时允许从 IndexedDB 读取缓存
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
