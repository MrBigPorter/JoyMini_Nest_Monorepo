/**
 * Orders Page — Server Component
 * Phase 6: URL searchParams 驱动 filter + 首屏预取
 */
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Orders' };

import React, { Suspense } from 'react';
import {
  HydrationBoundary,
  QueryClient,
  dehydrate,
} from '@tanstack/react-query';
import { OrdersClient } from '@/components/orders/OrdersClient';
import { serverGet } from '@/lib/serverFetch';
import type { PaginatedResponse } from '@/api/types';
import type { Order } from '@/type/types';
import {
  buildOrdersListParams,
  ordersListQueryKey,
  parseOrdersSearchParams,
  type NextSearchParams,
  ORDERS_LIST_TAG,
} from '@/lib/cache/orders-cache';

function OrdersPageSkeleton() {
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

interface OrdersPageProps {
  searchParams?: Promise<NextSearchParams>;
}

export default async function OrdersPage({ searchParams }: OrdersPageProps) {
  const resolvedSearchParams = (await searchParams) ?? {};
  const queryInput = parseOrdersSearchParams(resolvedSearchParams);

  const queryClient = new QueryClient();
  await queryClient.prefetchQuery({
    queryKey: ordersListQueryKey(queryInput),
    queryFn: async () => {
      const res = await serverGet<PaginatedResponse<Order>>(
        '/v1/admin/order/list',
        buildOrdersListParams(queryInput) as Record<
          string,
          string | number | boolean | undefined | null
        >,
        {
          revalidate: 30,
          tags: [ORDERS_LIST_TAG, 'dashboard:orders'],
        },
      );
      return { list: res.list, total: res.total };
    },
  });

  return (
    <Suspense fallback={<OrdersPageSkeleton />}>
      <HydrationBoundary state={dehydrate(queryClient)}>
        <OrdersClient />
      </HydrationBoundary>
    </Suspense>
  );
}
