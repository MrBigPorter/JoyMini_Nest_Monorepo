/**
 * Payment Channels Page — Server Component
 * Phase 6: URL searchParams 驱动 filter + 首屏预取
 */
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Payment Channels' };

import React, { Suspense } from 'react';
import {
  HydrationBoundary,
  QueryClient,
  dehydrate,
} from '@tanstack/react-query';
import { PaymentChannelsClient } from '@/components/payment/PaymentChannelsClient';
import { serverGet } from '@/lib/serverFetch';
import type { PaginatedResponse } from '@/api/types';
import type { PaymentChannel } from '@/type/types';
import {
  PAYMENT_CHANNELS_LIST_TAG,
  paymentChannelsListQueryKey,
  buildPaymentChannelsListParams,
  parsePaymentChannelsSearchParams,
  type NextSearchParams,
} from '@/lib/cache/payment-channels-cache';

function PaymentChannelsPageSkeleton() {
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

interface PaymentChannelsPageProps {
  searchParams?: Promise<NextSearchParams>;
}

export default async function PaymentChannelsPage({
  searchParams,
}: PaymentChannelsPageProps) {
  const resolvedSearchParams = (await searchParams) ?? {};
  const queryClient = new QueryClient();
  const queryInput = parsePaymentChannelsSearchParams(resolvedSearchParams);

  await queryClient.prefetchQuery({
    queryKey: paymentChannelsListQueryKey(queryInput),
    queryFn: async () => {
      const res = await serverGet<PaginatedResponse<PaymentChannel>>(
        '/v1/admin/payment/channels/list',
        buildPaymentChannelsListParams(queryInput) as Record<
          string,
          string | number | boolean | undefined | null
        >,
        {
          revalidate: 30,
          tags: [PAYMENT_CHANNELS_LIST_TAG],
        },
      );
      // 如果返回null（401错误），返回空数据
      if (!res) {
        return { list: [], total: 0 };
      }
      return { list: res.list, total: res.total };
    },
  });

  return (
    <Suspense fallback={<PaymentChannelsPageSkeleton />}>
      <HydrationBoundary state={dehydrate(queryClient)}>
        <PaymentChannelsClient />
      </HydrationBoundary>
    </Suspense>
  );
}
