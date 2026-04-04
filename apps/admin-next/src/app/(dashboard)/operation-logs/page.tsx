/**
 * Operation Logs Page — Server Component
 * Phase 3: URL searchParams 驱动 filter
 */
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Operation Logs' };

import React, { Suspense } from 'react';
import {
  HydrationBoundary,
  QueryClient,
  dehydrate,
} from '@tanstack/react-query';
import { OperationLogsClient } from '@/components/operation-logs/OperationLogClient';
import { serverGet } from '@/lib/serverFetch';
import type { PaginatedResponse } from '@/api/types';
import type { AdminOperationLog } from '@/type/types';
import {
  OPERATION_LOGS_LIST_TAG,
  buildOperationLogsListParams,
  operationLogsListQueryKey,
  parseOperationLogsSearchParams,
  type NextSearchParams,
} from '@/lib/cache/operation-logs-cache';

function OperationLogPageSkeleton() {
  return (
    <div className="rounded-xl border border-gray-100 dark:border-white/5 bg-white dark:bg-white/5 p-6 space-y-4 animate-pulse">
      <div className="h-9 w-64 rounded-lg bg-gray-100 dark:bg-white/10" />
      <div className="h-12 w-full rounded-xl bg-gray-100 dark:bg-white/10" />
      {Array.from({ length: 8 }).map((_, i) => (
        <div
          key={i}
          className="h-14 w-full rounded-xl bg-gray-100 dark:bg-white/5"
        />
      ))}
    </div>
  );
}

interface OperationLogsPageProps {
  searchParams?: Promise<NextSearchParams>;
}

export default async function OperationLogsPage({
  searchParams,
}: OperationLogsPageProps) {
  const resolvedSearchParams = (await searchParams) ?? {};
  const queryClient = new QueryClient();

  const queryInput = parseOperationLogsSearchParams(resolvedSearchParams);
  await queryClient.prefetchQuery({
    queryKey: operationLogsListQueryKey(queryInput),
    queryFn: async () => {
      const res = await serverGet<PaginatedResponse<AdminOperationLog>>(
        '/v1/admin/operation-logs/list',
        buildOperationLogsListParams(queryInput) as Record<
          string,
          string | number | boolean | undefined | null
        >,
        {
          revalidate: 30,
          tags: [OPERATION_LOGS_LIST_TAG],
        },
      );
      // 如果返回null（401错误），返回空数据
      if (!res) {
        return { data: [], total: 0 };
      }
      return { data: res.list, total: res.total };
    },
  });

  return (
    <Suspense fallback={<OperationLogPageSkeleton />}>
      <HydrationBoundary state={dehydrate(queryClient)}>
        <OperationLogsClient />
      </HydrationBoundary>
    </Suspense>
  );
}
