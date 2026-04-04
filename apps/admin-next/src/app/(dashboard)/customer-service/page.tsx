import type { Metadata } from 'next';
import React, { Suspense } from 'react';
import {
  dehydrate,
  HydrationBoundary,
  QueryClient,
} from '@tanstack/react-query';
import { CustomerServiceDesk } from '@/components/customer-service/CustomerServiceClient';
import { PageSkeleton } from '@/components/ui/PageSkeleton';
import {
  prefetchCustomerServiceList,
  parseCustomerServiceSearchParams,
} from '@/lib/customer-service-cache';

export const metadata: Metadata = { title: 'Customer Service' };

interface CustomerServicePageProps {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function CustomerServicePage({
  searchParams,
}: CustomerServicePageProps) {
  const queryClient = new QueryClient();
  const params = await searchParams;

  // 解析搜索参数
  const queryParams = parseCustomerServiceSearchParams(params);

  // 预取会话列表数据
  await prefetchCustomerServiceList(queryClient, queryParams);

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <Suspense fallback={<PageSkeleton rows={8} />}>
        <CustomerServiceDesk />
      </Suspense>
    </HydrationBoundary>
  );
}
