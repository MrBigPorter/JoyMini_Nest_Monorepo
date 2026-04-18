'use client';

import { useInfiniteQuery } from '@tanstack/react-query';
import { frontendBlogApi } from '@/lib/api/frontendBlogApi';
import type { FrontendArticle } from '@/lib/types/frontend-blog';
import { useParams } from 'next/navigation';

/**
 * 文章分页参数
 */
export interface ArticlesParams {
  page: number;
  pageSize: number;
  categoryId?: string;
  tagId?: string;
  search?: string;
  sortBy?: 'latest' | 'popular' | 'trending';
}

/**
 * 文章无限滚动查询钩子
 * 基于 React Query 的 useInfiniteQuery
 */
export function useArticlesInfiniteQuery(options?: {
  pageSize?: number;
  categoryId?: string;
  tagId?: string;
  search?: string;
  sortBy?: 'latest' | 'popular' | 'trending';
  enabled?: boolean;
}) {
  const {
    pageSize = 20,
    categoryId,
    tagId,
    search,
    sortBy = 'latest',
    enabled = true,
  } = options || {};

  // 从路由参数获取当前语言
  const params = useParams();
  const locale = (params.locale as string) || 'zh';

  return useInfiniteQuery({
    queryKey: [
      'articles',
      'infinite',
      { pageSize, categoryId, tagId, search, sortBy, locale },
    ],
    queryFn: async ({ pageParam = 1 }) => {
      // 构建查询参数
      const queryParams: any = { page: pageParam, pageSize };
      if (categoryId) queryParams.categoryId = categoryId;
      if (tagId) queryParams.tagId = tagId;
      if (search) queryParams.search = search;
      if (sortBy) queryParams.sortBy = sortBy;

      const response = await frontendBlogApi.getArticles(queryParams);

      return {
        items: response.items || [],
        total: response.total || 0,
        page: response.page || pageParam,
        pageSize: response.pageSize || pageSize,
        totalPages: response.totalPages || 0,
      };
    },
    getNextPageParam: (lastPage, allPages) => {
      const currentPage = lastPage.page;
      const totalPages = lastPage.totalPages;

      if (currentPage < totalPages) {
        return currentPage + 1;
      }
      return undefined;
    },
    initialPageParam: 1,
    enabled,
  });
}

/**
 * 简化的文章无限滚动钩子（常用场景）
 */
export function useArticlesInfiniteQuerySimple(options?: {
  pageSize?: number;
  categoryId?: string;
  tagId?: string;
  search?: string;
  sortBy?: 'latest' | 'popular' | 'trending';
  enabled?: boolean;
}) {
  const result = useArticlesInfiniteQuery(options);

  // 扁平化所有页面的项目
  const allItems = result.data?.pages.flatMap((page) => page.items) || [];
  const total = result.data?.pages[0]?.total || 0;
  const page = result.data?.pages[result.data.pages.length - 1]?.page || 1;
  const totalPages = result.data?.pages[0]?.totalPages || 0;

  return {
    // 数据
    items: allItems,
    total,
    page,
    pageSize: options?.pageSize || 20,
    totalPages,

    // 状态
    isLoading: result.isLoading,
    isLoadingMore: result.isFetchingNextPage,
    hasMore: result.hasNextPage,
    error: result.error,

    // 操作
    loadMore: () => result.fetchNextPage(),
    reload: () => result.refetch(),
    reset: () => {
      // 重置需要清除缓存，这里简单重新获取
      result.refetch();
    },
  };
}

/**
 * 首页文章无限滚动钩子
 */
export function useHomeArticlesInfiniteQuery() {
  return useArticlesInfiniteQuerySimple({
    pageSize: 12,
    sortBy: 'latest',
  });
}

/**
 * 分类文章无限滚动钩子
 */
export function useCategoryArticlesInfiniteQuery(categoryId: string) {
  return useArticlesInfiniteQuerySimple({
    pageSize: 20,
    categoryId,
    sortBy: 'latest',
  });
}

/**
 * 标签文章无限滚动钩子
 */
export function useTagArticlesInfiniteQuery(tagId: string) {
  return useArticlesInfiniteQuerySimple({
    pageSize: 20,
    tagId,
    sortBy: 'latest',
  });
}

/**
 * 搜索文章无限滚动钩子
 */
export function useSearchArticlesInfiniteQuery(search: string) {
  return useArticlesInfiniteQuerySimple({
    pageSize: 20,
    search,
    sortBy: 'latest',
  });
}
