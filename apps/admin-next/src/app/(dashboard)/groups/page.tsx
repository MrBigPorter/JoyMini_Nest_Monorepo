/**
 * Groups Page — Server Component
 * Phase 3: URL searchParams 驱动 filter
 */
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Group Buys' };

import React, { Suspense } from 'react';
import {
  HydrationBoundary,
  QueryClient,
  dehydrate,
} from '@tanstack/react-query';
import { GroupsClient } from '@/components/groups/GroupsClient';
import { serverGet } from '@/lib/serverFetch';
import type { PaginatedResponse } from '@/api/types';
import type { AdminGroupItem } from '@/type/types';
import {
  GROUPS_LIST_TAG,
  buildGroupsListParams,
  groupsListQueryKey,
  parseGroupsSearchParams,
  type NextSearchParams,
} from '@/lib/cache/groups-cache';

function GroupsPageSkeleton() {
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

interface GroupsPageProps {
  searchParams?: Promise<NextSearchParams>;
}

export default async function GroupsPage({ searchParams }: GroupsPageProps) {
  const resolvedSearchParams = (await searchParams) ?? {};
  const queryClient = new QueryClient();
  const queryInput = parseGroupsSearchParams(resolvedSearchParams);

  await queryClient.prefetchQuery({
    queryKey: groupsListQueryKey(queryInput),
    queryFn: async () => {
      const res = await serverGet<PaginatedResponse<AdminGroupItem>>(
        '/v1/admin/groups/list',
        buildGroupsListParams(queryInput) as Record<
          string,
          string | number | boolean | undefined | null
        >,
        {
          revalidate: 30,
          tags: [GROUPS_LIST_TAG],
        },
      );

      return { data: res.list, total: res.total };
    },
  });

  return (
    <Suspense fallback={<GroupsPageSkeleton />}>
      <HydrationBoundary state={dehydrate(queryClient)}>
        <GroupsClient />
      </HydrationBoundary>
    </Suspense>
  );
}
