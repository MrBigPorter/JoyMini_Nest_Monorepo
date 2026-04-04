/**
 * Banners Page — Server Component
 * Phase 3: URL searchParams 驱动 filter
 */
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Banners' };

import React, { Suspense } from 'react';
import {
  HydrationBoundary,
  QueryClient,
  dehydrate,
} from '@tanstack/react-query';
import { BannersClient } from '@/components/banners/BannersClient';
import { serverGet } from '@/lib/serverFetch';
import type { PaginatedResponse } from '@/api/types';
import type { Banner } from '@/type/types';
import {
  BANNERS_LIST_TAG,
  bannersListQueryKey,
  buildBannersListParams,
  parseBannersSearchParams,
  type NextSearchParams,
} from '@/lib/cache/banners-cache';

function BannersPageSkeleton() {
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

interface BannersPageProps {
  searchParams?: Promise<NextSearchParams>;
}

export default async function BannersPage({ searchParams }: BannersPageProps) {
  const resolvedSearchParams = (await searchParams) ?? {};
  const queryClient = new QueryClient();
  const queryInput = parseBannersSearchParams(resolvedSearchParams);

  await queryClient.prefetchQuery({
    queryKey: bannersListQueryKey(queryInput),
    queryFn: async () => {
      const res = await serverGet<PaginatedResponse<Banner>>(
        '/v1/admin/banners/list',
        buildBannersListParams(queryInput) as Record<
          string,
          string | number | boolean | undefined | null
        >,
        {
          revalidate: 30,
          tags: [BANNERS_LIST_TAG],
        },
      );
      return { list: res.list, total: res.total };
    },
  });

  return (
    <Suspense fallback={<BannersPageSkeleton />}>
      <HydrationBoundary state={dehydrate(queryClient)}>
        <BannersClient />
      </HydrationBoundary>
    </Suspense>
  );
}
