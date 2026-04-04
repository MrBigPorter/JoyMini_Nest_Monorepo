/**
 * KYC Page — Server Component
 * Phase 3: URL searchParams 驱动 filter
 */
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'KYC Review' };

import React, { Suspense } from 'react';
import {
  HydrationBoundary,
  QueryClient,
  dehydrate,
} from '@tanstack/react-query';
import { KycClient } from '@/components/kyc/KycClient';
import { serverGet } from '@/lib/serverFetch';
import type { PaginatedResponse } from '@/api/types';
import type { KycRecord } from '@/type/types';
import {
  KYC_LIST_TAG,
  buildKycListParams,
  kycListQueryKey,
  parseKycSearchParams,
  type NextSearchParams,
} from '@/lib/cache/kyc-cache';

function KycPageSkeleton() {
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

interface KycPageProps {
  searchParams?: Promise<NextSearchParams>;
}

export default async function KycPage({ searchParams }: KycPageProps) {
  const resolvedSearchParams = (await searchParams) ?? {};
  const queryClient = new QueryClient();
  const queryInput = parseKycSearchParams(resolvedSearchParams);

  await queryClient.prefetchQuery({
    queryKey: kycListQueryKey(queryInput),
    queryFn: async () => {
      const res = await serverGet<PaginatedResponse<KycRecord>>(
        '/v1/admin/kyc/records',
        buildKycListParams(queryInput) as Record<
          string,
          string | number | boolean | undefined | null
        >,
        {
          revalidate: 30,
          tags: [KYC_LIST_TAG],
        },
      );
      return { data: res.list, total: res.total };
    },
  });

  return (
    <Suspense fallback={<KycPageSkeleton />}>
      <HydrationBoundary state={dehydrate(queryClient)}>
        <KycClient />
      </HydrationBoundary>
    </Suspense>
  );
}
