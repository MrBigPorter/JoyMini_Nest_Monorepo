/**
 * Notifications 缓存契约
 * 定义通知列表和设备统计的 queryKey / prefetch 逻辑
 */

import { QueryClient } from '@tanstack/react-query';
import { notificationApi } from '@/api';
import type { QueryPushLogParams } from '@/type/types';

// ================= Cache Keys =================

export const NOTIFICATIONS_LIST_TAG = 'notifications:list';
export const NOTIFICATIONS_STATS_TAG = 'notifications:stats';

export function notificationsListQueryKey(params: QueryPushLogParams) {
  return [NOTIFICATIONS_LIST_TAG, params] as const;
}

export function notificationsStatsQueryKey() {
  return [NOTIFICATIONS_STATS_TAG] as const;
}

// ================= Server Prefetch =================

/**
 * Server Component 调用：预取推送日志列表
 */
export async function prefetchNotificationsList(
  queryClient: QueryClient,
  params: QueryPushLogParams,
) {
  const queryKey = notificationsListQueryKey(params);

  try {
    await queryClient.prefetchQuery({
      queryKey,
      queryFn: () => notificationApi.getLogs(params),
      staleTime: 30 * 1000, // 30秒内认为数据新鲜
    });
  } catch (error: unknown) {
    // 如果SSR预取失败，静默失败，客户端会重新请求数据
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.warn(
      '[SSR] Notifications list prefetch failed, will retry on client:',
      errorMessage,
    );

    // 设置一个空的查询状态，避免客户端重复请求
    queryClient.setQueryData(queryKey, {
      list: [],
      total: 0,
      page: 1,
      pageSize: 20,
    });
  }

  return queryKey;
}

/**
 * Server Component 调用：预取设备统计数据
 */
export async function prefetchNotificationsStats(queryClient: QueryClient) {
  const queryKey = notificationsStatsQueryKey();

  try {
    await queryClient.prefetchQuery({
      queryKey,
      queryFn: () => notificationApi.getDeviceStats(),
      staleTime: 60 * 1000, // 60秒内认为数据新鲜（统计数据变化较慢）
    });
  } catch (error: unknown) {
    // 如果SSR预取失败，静默失败
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.warn(
      '[SSR] Notifications stats prefetch failed, will retry on client:',
      errorMessage,
    );

    // 设置一个空的查询状态
    queryClient.setQueryData(queryKey, {
      total: 0,
      android: 0,
      ios: 0,
      web: 0,
      activeInLast7Days: 0,
    });
  }

  return queryKey;
}

// ================= URL SearchParams 解析 =================

/**
 * 从 URL searchParams 解析出查询参数
 */
export function parseNotificationsSearchParams(searchParams: {
  [key: string]: string | string[] | undefined;
}): QueryPushLogParams {
  const page = Number(searchParams.page) || 1;
  const pageSize = Number(searchParams.pageSize) || 20;
  const type = searchParams.type as string;

  return {
    page,
    pageSize,
    type: type === 'ALL' || !type ? undefined : type,
  };
}

/**
 * 将查询参数转换为 URL searchParams
 */
export function buildNotificationsSearchParams(
  params: QueryPushLogParams,
): Record<string, string> {
  const searchParams: Record<string, string> = {};

  if (params.page && params.page > 1) {
    searchParams.page = String(params.page);
  }
  if (params.pageSize && params.pageSize !== 20) {
    searchParams.pageSize = String(params.pageSize);
  }
  if (params.type) {
    searchParams.type = params.type;
  }

  return searchParams;
}
