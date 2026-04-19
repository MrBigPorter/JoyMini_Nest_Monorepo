/**
 * 平台感知的前端博客文章 Hooks
 * 使用平台适配器提供跨平台一致的缓存和错误处理
 */

import { useParams } from 'next/navigation';
import { frontendBlogApi } from '@/lib/api/frontendBlogApi';
import { usePlatformQuery } from '@/lib/platform/hooks/usePlatformQuery';
import type {
  FrontendArticle,
  FrontendPaginatedResponse,
  FrontendCategory,
  FrontendTag,
  FrontendArchiveItem,
  FrontendCategoryWithArticles,
  FrontendTagWithArticles,
} from '@/lib/types/frontend-blog';

/**
 * 平台感知的获取前端博客文章列表 Hook
 */
export function usePlatformFrontendArticles(params?: {
  page?: number;
  pageSize?: number;
  categoryId?: string;
  tagId?: string;
}) {
  return usePlatformQuery<FrontendPaginatedResponse<FrontendArticle>>({
    queryKey: ['frontendArticles', params],
    apiCall: async () => {
      return await frontendBlogApi.getArticles(params);
    },
  });
}

/**
 * 平台感知的根据 Slug 获取前端博客文章详情 Hook
 */
export function usePlatformFrontendArticleBySlug(slug: string) {
  const params = useParams();
  const locale = (params.locale as string) || 'zh';

  return usePlatformQuery<FrontendArticle>({
    queryKey: ['frontendArticle', slug, { locale }],
    apiCall: () => frontendBlogApi.getArticleBySlug(slug),
  });
}

/**
 * 平台感知的获取前端博客热门文章 Hook
 */
export function usePlatformFrontendPopularArticles(limit = 10) {
  return usePlatformQuery<FrontendArticle[]>({
    queryKey: ['frontendPopularArticles', limit],
    apiCall: () => frontendBlogApi.getPopularArticles(limit),
  });
}

/**
 * 平台感知的获取相关文章 Hook
 */
export function usePlatformFrontendRelatedArticles(
  articleId: string,
  limit = 5,
) {
  return usePlatformQuery<FrontendArticle[]>({
    queryKey: ['frontendRelatedArticles', articleId, limit],
    apiCall: () => frontendBlogApi.getRelatedArticles(articleId, limit),
  });
}

/**
 * 平台感知的搜索文章 Hook
 */
export function usePlatformFrontendSearchArticles(
  query: string,
  params?: {
    page?: number;
    pageSize?: number;
  },
) {
  return usePlatformQuery<FrontendPaginatedResponse<FrontendArticle>>({
    queryKey: ['frontendSearchArticles', query, params],
    apiCall: () => frontendBlogApi.searchArticles(query, params),
    enabled: !!query && query.length >= 2, // 至少2个字符才搜索
  });
}

/**
 * 平台感知的获取前端博客分类列表 Hook
 */
export function usePlatformFrontendCategories() {
  const params = useParams();
  const locale = (params.locale as string) || 'zh';

  return usePlatformQuery<FrontendCategory[]>({
    queryKey: ['frontendCategories', { locale }],
    apiCall: () => frontendBlogApi.getCategories(),
  });
}

/**
 * 平台感知的根据 Slug 获取分类详情 Hook
 */
export function usePlatformFrontendCategoryBySlug(
  slug: string,
  params?: {
    page?: number;
    pageSize?: number;
  },
) {
  const routeParams = useParams();
  const locale = (routeParams.locale as string) || 'zh';

  return usePlatformQuery<FrontendCategoryWithArticles>({
    queryKey: ['frontendCategory', slug, { locale }, params],
    apiCall: () => frontendBlogApi.getCategoryBySlug(slug, params),
  });
}

/**
 * 平台感知的获取前端博客标签列表 Hook
 */
export function usePlatformFrontendTags() {
  const params = useParams();
  const locale = (params.locale as string) || 'zh';

  return usePlatformQuery<FrontendTag[]>({
    queryKey: ['frontendTags', { locale }],
    apiCall: () => frontendBlogApi.getTags(),
  });
}

/**
 * 平台感知的根据 Slug 获取标签详情 Hook
 */
export function usePlatformFrontendTagBySlug(
  slug: string,
  params?: {
    page?: number;
    pageSize?: number;
  },
) {
  const routeParams = useParams();
  const locale = (routeParams.locale as string) || 'zh';

  return usePlatformQuery<FrontendTagWithArticles>({
    queryKey: ['frontendTag', slug, { locale }, params],
    apiCall: () => frontendBlogApi.getTagBySlug(slug, params),
  });
}

/**
 * 平台感知的获取文章归档 Hook
 */
export function usePlatformFrontendArticleArchive() {
  return usePlatformQuery<FrontendArchiveItem[]>({
    queryKey: ['frontendArticleArchive'],
    apiCall: () => frontendBlogApi.getArticleArchive(),
  });
}

/**
 * 平台感知的获取热门标签 Hook
 */
export function usePlatformFrontendPopularTags(limit = 20) {
  return usePlatformQuery<FrontendTag[]>({
    queryKey: ['frontendPopularTags', limit],
    apiCall: () => frontendBlogApi.getPopularTags(limit),
  });
}

/**
 * 兼容性包装器：保持向后兼容
 * 可以逐步迁移现有代码
 */
export const useFrontendArticles = usePlatformFrontendArticles;
export const useFrontendArticleBySlug = usePlatformFrontendArticleBySlug;
export const useFrontendPopularArticles = usePlatformFrontendPopularArticles;
export const useFrontendRelatedArticles = usePlatformFrontendRelatedArticles;
export const useFrontendSearchArticles = usePlatformFrontendSearchArticles;
export const useFrontendCategories = usePlatformFrontendCategories;
export const useFrontendCategoryBySlug = usePlatformFrontendCategoryBySlug;
export const useFrontendTags = usePlatformFrontendTags;
export const useFrontendTagBySlug = usePlatformFrontendTagBySlug;
export const useFrontendArticleArchive = usePlatformFrontendArticleArchive;
export const useFrontendPopularTags = usePlatformFrontendPopularTags;
