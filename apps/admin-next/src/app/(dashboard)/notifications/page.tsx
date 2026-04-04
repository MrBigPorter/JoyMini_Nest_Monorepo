/**
 * Notifications Page — Server Component wrapper
 * 通知/推送管理界面
 * Phase 3: SSR 预取 + HydrationBoundary
 */
import type { Metadata } from 'next';
import React, { Suspense } from 'react';
import {
  dehydrate,
  HydrationBoundary,
  QueryClient,
} from '@tanstack/react-query';

import { NotificationManagement } from '@/components/notifications/NotificationsClient';
import { PageSkeleton } from '@/components/ui/PageSkeleton';
import {
  prefetchNotificationsList,
  prefetchNotificationsStats,
  parseNotificationsSearchParams,
} from '@/lib/notifications-cache';

export const metadata: Metadata = { title: 'Notifications' };

interface NotificationsPageProps {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function NotificationsPage({
  searchParams,
}: NotificationsPageProps) {
  const queryClient = new QueryClient();
  const params = await searchParams;

  // 解析搜索参数
  const queryParams = parseNotificationsSearchParams(params);

  // 并行预取推送日志列表和设备统计数据
  await Promise.all([
    prefetchNotificationsList(queryClient, queryParams),
    prefetchNotificationsStats(queryClient),
  ]);

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <Suspense fallback={<PageSkeleton />}>
        <NotificationManagement />
      </Suspense>
    </HydrationBoundary>
  );
}
