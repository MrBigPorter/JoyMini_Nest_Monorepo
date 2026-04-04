/**
 * Categories 缓存契约
 * 定义分类列表的 queryKey / prefetch 逻辑
 */

import { QueryClient } from '@tanstack/react-query';
import { categoryApi } from '@/api';

// ================= Cache Keys =================

export const CATEGORIES_LIST_TAG = 'categories:list';

export function categoriesListQueryKey() {
  return [CATEGORIES_LIST_TAG] as const;
}

// ================= Server Prefetch =================

/**
 * Server Component 调用：预取分类列表
 */
export async function prefetchCategoriesList(queryClient: QueryClient) {
  const queryKey = categoriesListQueryKey();

  try {
    await queryClient.prefetchQuery({
      queryKey,
      queryFn: () => categoryApi.getCategories(),
      staleTime: 60 * 1000, // 60秒内认为数据新鲜（分类数据变化较少）
    });
  } catch (error: unknown) {
    // 如果SSR预取失败，静默失败，客户端会重新请求数据
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.warn(
      '[SSR] Categories list prefetch failed, will retry on client:',
      errorMessage,
    );

    // 设置一个空的查询状态，避免客户端重复请求
    queryClient.setQueryData(queryKey, []);
  }

  return queryKey;
}
