/**
 * Admin Users Page — Server Component
 * Phase 3: URL searchParams 驱动 filter
 */
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Admin Users' };

import React, { Suspense } from 'react';
import {
  HydrationBoundary,
  QueryClient,
  dehydrate,
} from '@tanstack/react-query';
import { AdminUsersClient } from '@/components/admin-users/AdminUsersClient';
import { serverGet } from '@/lib/serverFetch';
import type { PaginatedResponse } from '@/api/types';
import type { AdminUser } from '@/type/types';
import {
  ADMIN_USERS_LIST_TAG,
  adminUsersListQueryKey,
  buildAdminUsersListParams,
  parseAdminUsersSearchParams,
  type NextSearchParams,
} from '@/lib/cache/admin-users-cache';

function AdminUsersPageSkeleton() {
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

interface AdminUsersPageProps {
  searchParams?: Promise<NextSearchParams>;
}

export default async function AdminUsersPage({
  searchParams,
}: AdminUsersPageProps) {
  const resolvedSearchParams = (await searchParams) ?? {};
  const queryClient = new QueryClient();
  const queryInput = parseAdminUsersSearchParams(resolvedSearchParams);

  await queryClient.prefetchQuery({
    queryKey: adminUsersListQueryKey(queryInput),
    queryFn: async () => {
      const res = await serverGet<PaginatedResponse<AdminUser>>(
        '/v1/admin/user/list',
        buildAdminUsersListParams(queryInput) as Record<
          string,
          string | number | boolean | undefined | null
        >,
        {
          revalidate: 30,
          tags: [ADMIN_USERS_LIST_TAG],
        },
      );
      return { list: res.list, total: res.total };
    },
  });

  return (
    <Suspense fallback={<AdminUsersPageSkeleton />}>
      <HydrationBoundary state={dehydrate(queryClient)}>
        <AdminUsersClient />
      </HydrationBoundary>
    </Suspense>
  );
}
