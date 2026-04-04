/**
 * Users Page — Server Component
 * Phase 3: URL searchParams 驱动 filter
 *
 * UsersClient 使用 useSearchParams() 读取 URL 参数，必须包在 <Suspense> 里。
 * 这样 Next.js 才能在 streaming 时正确处理 searchParams 的异步读取。
 */
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Users' };

import React, { Suspense } from 'react';
import {
  HydrationBoundary,
  QueryClient,
  dehydrate,
} from '@tanstack/react-query';
import { UsersClient } from '@/components/users/UsersClient';
import { serverGet } from '@/lib/serverFetch';
import type { PaginatedResponse } from '@/api/types';
import type { ClientUserListItem } from '@/type/types';
import {
  USERS_LIST_TAG,
  buildUsersListParams,
  parseUsersSearchParams,
  usersListQueryKey,
  type NextSearchParams,
} from '@/lib/cache/users-cache';

function UsersPageSkeleton() {
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

interface UsersPageProps {
  searchParams?: Promise<NextSearchParams>;
}

export default async function UsersPage({ searchParams }: UsersPageProps) {
  const resolvedSearchParams = (await searchParams) ?? {};
  const queryClient = new QueryClient();
  const queryInput = parseUsersSearchParams(resolvedSearchParams);

  await queryClient.prefetchQuery({
    queryKey: usersListQueryKey(queryInput),
    queryFn: async () => {
      const res = await serverGet<PaginatedResponse<ClientUserListItem>>(
        '/v1/admin/client-user/list',
        buildUsersListParams(queryInput) as unknown as Record<
          string,
          string | number | boolean | undefined | null
        >,
        {
          revalidate: 30,
          tags: [USERS_LIST_TAG],
        },
      );
      return { data: res.list, total: res.total };
    },
  });

  return (
    <Suspense fallback={<UsersPageSkeleton />}>
      <HydrationBoundary state={dehydrate(queryClient)}>
        <UsersClient />
      </HydrationBoundary>
    </Suspense>
  );
}
