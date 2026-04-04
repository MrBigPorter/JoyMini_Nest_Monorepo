/**
 * Dashboard Page — Server Component
 * Phase 2: SSR 数据预取
 *   - DashboardStats  → async Server Component，服务端 fetch 统计数据，Suspense streaming
 *   - DashboardOrdersClient → Client Component，HydrationBoundary 注入预取数据
 *   - DashboardHeader → Client Component，提供 Refresh 按钮
 */
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Dashboard' };

import React, { Suspense } from 'react';
import {
  HydrationBoundary,
  QueryClient,
  dehydrate,
} from '@tanstack/react-query';
import { DashboardStats } from '@/components/dashboard/DashboardStats';
import { DashboardStatsSkeleton } from '@/components/dashboard/DashboardStatsSkeleton';
import { DashboardOrdersClient } from '@/components/dashboard/DashboardOrdersClient';
import { DashboardHeader } from '@/components/dashboard/DashboardHeader';
import { ORDERS_LIST_TAG } from '@/lib/cache/orders-cache';
import { serverGet } from '@/lib/serverFetch';
import type { PaginatedResponse } from '@/api/types';
import type { Order } from '@/type/types';

export default async function DashboardPage() {
  // 服务端预取最近 5 笔订单，注入 HydrationBoundary
  const queryClient = new QueryClient();

  await queryClient.prefetchQuery({
    queryKey: ['dashboard-orders'],
    queryFn: () =>
      serverGet<PaginatedResponse<Order>>(
        '/v1/admin/order/list',
        {
          page: 1,
          pageSize: 5,
        },
        { revalidate: 30, tags: ['dashboard:orders', ORDERS_LIST_TAG] },
      ),
  });

  return (
    <div className="space-y-6">
      {/* 标题 + 刷新按钮（Client Component） */}
      <DashboardHeader />

      {/* 4 统计卡片 — async Server Component + Streaming */}
      <Suspense fallback={<DashboardStatsSkeleton />}>
        <DashboardStats />
      </Suspense>

      {/* 最近订单 — Client Component，由 HydrationBoundary 注入预取数据 */}
      <HydrationBoundary state={dehydrate(queryClient)}>
        <DashboardOrdersClient />
      </HydrationBoundary>
    </div>
  );
}
