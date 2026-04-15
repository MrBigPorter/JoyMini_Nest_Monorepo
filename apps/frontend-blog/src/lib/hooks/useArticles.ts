'use client';

import { useQuery } from '@tanstack/react-query';
import { blogApi } from '@/lib/api/blogApi';

// Mock 测试数据 - 开发环境使用（备用）
const mockArticles = [
  {
    id: '1',
    slug: 'welcome-to-lucky-nest',
    title: '欢迎来到 Lucky Nest 博客平台',
    excerpt:
      '这是 Lucky Nest 官方博客平台的第一篇文章。我们将在这里分享技术文章、产品更新和开发经验。',
    views: 1234,
    commentsCount: 42,
    publishedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    category: { id: '1', name: '公告', slug: 'announcement' },
  },
  {
    id: '2',
    slug: 'nextjs-15-performance-guide',
    title: 'Next.js 15 性能优化最佳实践',
    excerpt:
      '深入探讨 Next.js 15 带来的新特性和性能优化技巧，包括 App Router、部分预渲染和服务端组件。',
    views: 892,
    commentsCount: 28,
    publishedAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    category: { id: '2', name: '技术', slug: 'tech' },
  },
  {
    id: '3',
    slug: 'tailwind-v4-migration',
    title: 'Tailwind CSS v4 迁移指南',
    excerpt:
      '从零开始迁移到 Tailwind CSS v4，了解新版本的改进、新特性和注意事项。',
    views: 657,
    commentsCount: 15,
    publishedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
    category: { id: '2', name: '技术', slug: 'tech' },
  },
  {
    id: '4',
    slug: 'monorepo-turborepo-best-practices',
    title: 'Monorepo 与 Turborepo 最佳实践',
    excerpt:
      '在大型项目中使用 Monorepo 架构的经验分享，包括代码复用、构建优化和团队协作。',
    views: 432,
    commentsCount: 11,
    publishedAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
    category: { id: '2', name: '技术', slug: 'tech' },
  },
  {
    id: '5',
    slug: 'capacitor-vs-expo',
    title: 'Capacitor vs Expo: 跨平台移动开发对比',
    excerpt:
      '深入对比 Capacitor 和 Expo 两种跨平台移动开发方案的优缺点，帮助你选择适合的技术栈。',
    views: 378,
    commentsCount: 9,
    publishedAt: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString(),
    category: { id: '3', name: '移动端', slug: 'mobile' },
  },
  {
    id: '6',
    slug: 'typescript-5-4-new-features',
    title: 'TypeScript 5.4 新特性解析',
    excerpt:
      '了解 TypeScript 5.4 版本带来的新特性，包括 NoInfer 工具类型、改进的类型推断和性能提升。',
    views: 291,
    commentsCount: 7,
    publishedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
    category: { id: '2', name: '技术', slug: 'tech' },
  },
];

/**
 * 获取文章列表 Hook
 * 使用 TanStack Query 自动缓存
 */
export function useArticles(params?: {
  page?: number;
  pageSize?: number;
  categoryId?: string;
  tagId?: string;
}) {
  return useQuery({
    queryKey: ['articles', params],
    queryFn: async () => {
      // 只使用真实API，不再使用Mock数据
      return await blogApi.getArticles(params);
    },
    staleTime: 5 * 60 * 1000, // 5分钟缓存
    retry: 2, // 失败时重试2次
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000), // 指数退避重试
  });
}

/**
 * 根据 Slug 获取文章详情 Hook
 */
export function useArticleBySlug(slug: string) {
  return useQuery({
    queryKey: ['article', slug],
    queryFn: () => blogApi.getArticleBySlug(slug),
    staleTime: 60 * 60 * 1000, // 1小时缓存
    enabled: !!slug,
  });
}

/**
 * 获取热门文章 Hook
 */
export function usePopularArticles(limit = 10) {
  return useQuery({
    queryKey: ['popularArticles', limit],
    queryFn: () => blogApi.getPopularArticles(limit),
    staleTime: 10 * 60 * 1000, // 10分钟缓存
  });
}

/**
 * 获取相关文章 Hook
 */
export function useRelatedArticles(articleId: string, limit = 5) {
  return useQuery({
    queryKey: ['relatedArticles', articleId, limit],
    queryFn: () => blogApi.getRelatedArticles(articleId, limit),
    staleTime: 10 * 60 * 1000,
    enabled: !!articleId,
  });
}

/**
 * 搜索文章 Hook
 */
export function useSearchArticles(
  query: string,
  params?: {
    page?: number;
    pageSize?: number;
  },
) {
  return useQuery({
    queryKey: ['searchArticles', query, params],
    queryFn: () => blogApi.searchArticles(query, params),
    staleTime: 1 * 60 * 1000,
    enabled: !!query && query.length > 0,
  });
}
