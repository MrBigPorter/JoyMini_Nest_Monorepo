import type { Metadata } from 'next';
import React, { Suspense } from 'react';
import {
  HydrationBoundary,
  QueryClient,
  dehydrate,
} from '@tanstack/react-query';
import { LoginLogList } from '@/components/login-logs/LoginLogsClient';
import { PageSkeleton } from '@/components/ui/PageSkeleton';
import { serverGet } from '@/lib/serverFetch';
import type { PaginatedResponse } from '@/api/types';
import type { UserLoginLog } from '@/type/types';
import {
  LOGIN_LOGS_LIST_TAG,
  buildLoginLogsListParams,
  loginLogsListQueryKey,
  parseLoginLogsSearchParams,
  type NextSearchParams,
} from '@/lib/cache/login-logs-cache';

export const metadata: Metadata = { title: 'Login Logs' };

interface LoginLogsPageProps {
  searchParams?: Promise<NextSearchParams>;
}

export default async function LoginLogsPage({
  searchParams,
}: LoginLogsPageProps) {
  const resolvedSearchParams = (await searchParams) ?? {};
  const queryClient = new QueryClient();
  const queryInput = parseLoginLogsSearchParams(resolvedSearchParams);

  await queryClient.prefetchQuery({
    queryKey: loginLogsListQueryKey(queryInput),
    queryFn: async () => {
      const res = await serverGet<PaginatedResponse<UserLoginLog>>(
        '/v1/admin/login-logs/list',
        buildLoginLogsListParams(queryInput) as Record<
          string,
          string | number | boolean | undefined | null
        >,
        {
          revalidate: 30,
          tags: [LOGIN_LOGS_LIST_TAG],
        },
      );
      return { list: res.list, total: res.total };
    },
  });

  return (
    <Suspense fallback={<PageSkeleton />}>
      <HydrationBoundary state={dehydrate(queryClient)}>
        <LoginLogList />
      </HydrationBoundary>
    </Suspense>
  );
}
