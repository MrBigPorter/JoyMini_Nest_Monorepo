/**
 * 平台感知的文章无限滚动 Hooks
 * 使用平台适配器提供跨平台一致的缓存和错误处理
 */

import { useParams } from 'next/navigation';
import { frontendBlogApi } from '@/lib/api/frontendBlogApi';
import { usePlatformInfiniteQuery } from '@/lib/platform/hooks/usePlatformQuery';
import type {
  FrontendArticle,
  FrontendPaginatedResponse,
} from '@/lib/types/frontend-blog';

/**
 * 文章分页参数
 */
export interface PlatformArticlesParams {
  page: number;
  pageSize: number;
  categoryId?: string;
  tagId?: string;
  search?: string;
  sortBy?: 'latest' | 'popular' | 'trending';
}

/**
 * 无限查询页面类型
 */
export interface InfiniteQueryPage {
  items: FrontendArticle[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/**
 * 平台感知的文章无限滚动查询钩子
 * 基于平台适配器的 usePlatformInfiniteQuery
 */
export function usePlatformArticlesInfiniteQuery(options?: {
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

  return usePlatformInfiniteQuery<InfiniteQueryPage, number>({
    queryKey: [
      'articles',
      'infinite',
      { pageSize, categoryId, tagId, search, sortBy, locale },
    ],
    apiCall: async ({ pageParam = 1 }) => {
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
        page: response.page || (pageParam as number),
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
  });
}

/**
 * 简化的平台感知文章无限滚动钩子（常用场景）
 */
export function usePlatformArticlesInfiniteQuerySimple(options?: {
  pageSize?: number;
  categoryId?: string;
  tagId?: string;
  search?: string;
  sortBy?: 'latest' | 'popular' | 'trending';
  enabled?: boolean;
  initialData?: {
    items: FrontendArticle[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  };
}) {
  const result = usePlatformArticlesInfiniteQuery({
    ...options,
  });
  
  // 如果有初始数据，手动设置初始状态
  const hasInitialData = options?.initialData && options.initialData.items.length > 0;
  
  // 使用类型断言处理无限查询返回的数据结构
  const pages = (result.data as { pages?: InfiniteQueryPage[] })?.pages || [];
  
  // 如果有初始数据但查询还没有数据，使用初始数据
  const effectivePages = hasInitialData && pages.length === 0 ? [{
    items: options!.initialData!.items,
    total: options!.initialData!.total,
    page: options!.initialData!.page,
    pageSize: options!.initialData!.pageSize,
    totalPages: options!.initialData!.totalPages,
  }] : pages;

  // 扁平化所有页面的项目
  const allItems = effectivePages.flatMap((page: InfiniteQueryPage) => page.items) || [];
  const total = effectivePages[0]?.total || 0;
  const page = effectivePages[effectivePages.length - 1]?.page || 1;
  const totalPages = effectivePages[0]?.totalPages || 0;

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
 * 平台感知的首页文章无限滚动钩子
 */
export function usePlatformHomeArticlesInfiniteQuery() {
  return usePlatformArticlesInfiniteQuerySimple({
    pageSize: 12,
    sortBy: 'latest',
  });
}

/**
 * 平台感知的分类文章无限滚动钩子
 */
export function usePlatformCategoryArticlesInfiniteQuery(categoryId: string) {
  return usePlatformArticlesInfiniteQuerySimple({
    pageSize: 20,
    categoryId,
    sortBy: 'latest',
  });
}

/**
 * 平台感知的标签文章无限滚动钩子
 */
export function usePlatformTagArticlesInfiniteQuery(tagId: string) {
  return usePlatformArticlesInfiniteQuerySimple({
    pageSize: 20,
    tagId,
    sortBy: 'latest',
  });
}

/**
 * 平台感知的搜索文章无限滚动钩子
 */
export function usePlatformSearchArticlesInfiniteQuery(search: string) {
  return usePlatformArticlesInfiniteQuerySimple({
    pageSize: 20,
    search,
    sortBy: 'latest',
  });
}

/**
 * 兼容性包装器：保持向后兼容
 * 可以逐步迁移现有代码
 */
export const useArticlesInfiniteQuery = usePlatformArticlesInfiniteQuery;
export const useArticlesInfiniteQuerySimple =
  usePlatformArticlesInfiniteQuerySimple;
export const useHomeArticlesInfiniteQuery =
  usePlatformHomeArticlesInfiniteQuery;
export const useCategoryArticlesInfiniteQuery =
  usePlatformCategoryArticlesInfiniteQuery;
export const useTagArticlesInfiniteQuery = usePlatformTagArticlesInfiniteQuery;
export const useSearchArticlesInfiniteQuery =
  usePlatformSearchArticlesInfiniteQuery;
