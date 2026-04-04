/**
 * Customer Service 缓存契约
 * 定义会话列表的 queryKey / prefetch / URL 同步逻辑
 */

import { QueryClient } from '@tanstack/react-query';
import { chatApi } from '@/api';
import type { QueryConversationsParams } from '@/type/types';

// ================= Cache Keys =================

export const CUSTOMER_SERVICE_LIST_TAG = 'customer-service:list';

export function customerServiceListQueryKey(params: QueryConversationsParams) {
  return [CUSTOMER_SERVICE_LIST_TAG, params] as const;
}

// ================= Server Prefetch =================

/**
 * Server Component 调用：预取会话列表
 */
export async function prefetchCustomerServiceList(
  queryClient: QueryClient,
  params: QueryConversationsParams,
) {
  const queryKey = customerServiceListQueryKey(params);

  try {
    await queryClient.prefetchQuery({
      queryKey,
      queryFn: () => chatApi.getConversations(params, { trace: false }),
      staleTime: 30 * 1000, // 30秒内认为数据新鲜
    });
  } catch (error: unknown) {
    // 如果SSR预取失败（比如API服务器未运行），静默失败
    // 客户端会重新请求数据
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.warn(
      '[SSR] Customer service prefetch failed, will retry on client:',
      errorMessage,
    );

    // 设置一个空的查询状态，避免客户端重复请求
    queryClient.setQueryData(queryKey, {
      list: [],
      total: 0,
      page: 1,
      pageSize: 30,
    });
  }

  return queryKey;
}

// ================= URL SearchParams 解析 =================

/**
 * 从 URL searchParams 解析出查询参数
 */
export function parseCustomerServiceSearchParams(searchParams: {
  [key: string]: string | string[] | undefined;
}): QueryConversationsParams {
  const page = Number(searchParams.page) || 1;
  const pageSize = Number(searchParams.pageSize) || 30;
  const keyword = searchParams.keyword as string;
  const status = searchParams.status ? Number(searchParams.status) : undefined;

  return {
    page,
    pageSize,
    type: 'SUPPORT',
    keyword: keyword || undefined,
    status,
  };
}

/**
 * 将查询参数转换为 URL searchParams
 */
export function buildCustomerServiceSearchParams(
  params: QueryConversationsParams,
): Record<string, string> {
  const searchParams: Record<string, string> = {};

  if (params.page && params.page > 1) {
    searchParams.page = String(params.page);
  }
  if (params.pageSize && params.pageSize !== 30) {
    searchParams.pageSize = String(params.pageSize);
  }
  if (params.keyword) {
    searchParams.keyword = params.keyword;
  }
  if (params.status !== undefined) {
    searchParams.status = String(params.status);
  }

  return searchParams;
}
