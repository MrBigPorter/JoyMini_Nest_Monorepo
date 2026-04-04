/**
 * Marketing Page — Server Component
 * Phase 3: SSR 预取 + HydrationBoundary
 */
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Marketing' };

import React, { Suspense } from 'react';
import {
  dehydrate,
  HydrationBoundary,
  QueryClient,
} from '@tanstack/react-query';
import { MarketingClient } from '@/components/marketing/MarketingClient';
import {
  prefetchMarketingList,
  parseMarketingSearchParams,
} from '@/lib/marketing-cache';

function MarketingPageSkeleton() {
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

interface MarketingPageProps {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function MarketingPage({
  searchParams,
}: MarketingPageProps) {
  const queryClient = new QueryClient();
  const params = await searchParams;

  // 解析搜索参数
  const queryParams = parseMarketingSearchParams(params);

  // 预取优惠券列表数据
  await prefetchMarketingList(queryClient, queryParams);

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <Suspense fallback={<MarketingPageSkeleton />}>
        <MarketingClient />
      </Suspense>
    </HydrationBoundary>
  );
}
