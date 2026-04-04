/**
 * Address Page — Server Component
 * Phase 3: URL searchParams 驱动 filter
 */
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Addresses' };

import React, { Suspense } from 'react';
import {
  HydrationBoundary,
  QueryClient,
  dehydrate,
} from '@tanstack/react-query';
import { AddressClient } from '@/components/address/AddressClient';
import { serverGet } from '@/lib/serverFetch';
import type { PaginatedResponse } from '@/api/types';
import type { AddressResponse } from '@/type/types';
import {
  ADDRESS_LIST_TAG,
  addressListQueryKey,
  buildAddressListParams,
  parseAddressSearchParams,
  type NextSearchParams,
} from '@/lib/cache/address-cache';

function AddressPageSkeleton() {
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

interface AddressPageProps {
  searchParams?: Promise<NextSearchParams>;
}

export default async function AddressPage({ searchParams }: AddressPageProps) {
  const resolvedSearchParams = (await searchParams) ?? {};
  const queryClient = new QueryClient();
  const queryInput = parseAddressSearchParams(resolvedSearchParams);

  await queryClient.prefetchQuery({
    queryKey: addressListQueryKey(queryInput),
    queryFn: async () => {
      const res = await serverGet<PaginatedResponse<AddressResponse>>(
        '/v1/admin/address/list',
        buildAddressListParams(queryInput) as Record<
          string,
          string | number | boolean | undefined | null
        >,
        {
          revalidate: 30,
          tags: [ADDRESS_LIST_TAG],
        },
      );

      return { data: res.list, total: res.total };
    },
  });

  return (
    <Suspense fallback={<AddressPageSkeleton />}>
      <HydrationBoundary state={dehydrate(queryClient)}>
        <AddressClient />
      </HydrationBoundary>
    </Suspense>
  );
}
