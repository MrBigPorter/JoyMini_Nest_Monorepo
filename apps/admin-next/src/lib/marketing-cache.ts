/**
 * Marketing 缓存契约
 * 定义优惠券列表的 queryKey / prefetch / URL 同步逻辑
 */

import { QueryClient } from '@tanstack/react-query';
import { couponApi } from '@/api';
import type { CouponListParams } from '@/type/types';

// ================= Cache Keys =================

export const MARKETING_LIST_TAG = 'marketing:coupon-list';

export function marketingListQueryKey(params: CouponListParams) {
  return [MARKETING_LIST_TAG, params] as const;
}

// ================= Server Prefetch =================

/**
 * Server Component 调用：预取优惠券列表
 */
export async function prefetchMarketingList(
  queryClient: QueryClient,
  params: CouponListParams,
) {
  const queryKey = marketingListQueryKey(params);

  try {
    await queryClient.prefetchQuery({
      queryKey,
      queryFn: () => couponApi.getList(params),
      staleTime: 30 * 1000, // 30秒内认为数据新鲜
    });
  } catch (error: unknown) {
    // 如果SSR预取失败，静默失败，客户端会重新请求数据
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.warn(
      '[SSR] Marketing list prefetch failed, will retry on client:',
      errorMessage,
    );

    // 设置一个空的查询状态，避免客户端重复请求
    queryClient.setQueryData(queryKey, {
      list: [],
      total: 0,
      page: 1,
      pageSize: 10,
    });
  }

  return queryKey;
}

// ================= URL SearchParams 解析 =================

/**
 * 从 URL searchParams 解析出查询参数
 */
export function parseMarketingSearchParams(searchParams: {
  [key: string]: string | string[] | undefined;
}): CouponListParams {
  const page = Number(searchParams.page) || 1;
  const pageSize = Number(searchParams.pageSize) || 10;
  const keyword = searchParams.keyword as string;
  const status = searchParams.status ? Number(searchParams.status) : undefined;
  const couponType = searchParams.couponType
    ? Number(searchParams.couponType)
    : undefined;

  return {
    page,
    pageSize,
    keyword: keyword || undefined,
    status,
    couponType,
  };
}

/**
 * 将查询参数转换为 URL searchParams
 */
export function buildMarketingSearchParams(
  params: CouponListParams,
): Record<string, string> {
  const searchParams: Record<string, string> = {};

  if (params.page && params.page > 1) {
    searchParams.page = String(params.page);
  }
  if (params.pageSize && params.pageSize !== 10) {
    searchParams.pageSize = String(params.pageSize);
  }
  if (params.keyword) {
    searchParams.keyword = params.keyword;
  }
  if (params.status !== undefined) {
    searchParams.status = String(params.status);
  }
  if (params.couponType !== undefined) {
    searchParams.couponType = String(params.couponType);
  }

  return searchParams;
}
