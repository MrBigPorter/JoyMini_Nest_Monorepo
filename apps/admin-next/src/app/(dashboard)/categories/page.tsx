/**
 * Categories Page — Server Component
 * Phase 3: SSR 预取 + HydrationBoundary
 */
import type { Metadata } from 'next';
import React, { Suspense } from 'react';
import {
  dehydrate,
  HydrationBoundary,
  QueryClient,
} from '@tanstack/react-query';

import { PageSkeleton } from '@/components/ui/PageSkeleton';
import { CategoryManagement } from '@/components/categories/CategoriesClient';
import { prefetchCategoriesList } from '@/lib/categories-cache';

export const metadata: Metadata = { title: 'Categories' };

export default async function CategoriesPage() {
  const queryClient = new QueryClient();

  // 预取分类列表数据
  await prefetchCategoriesList(queryClient);

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <Suspense fallback={<PageSkeleton />}>
        <CategoryManagement />
      </Suspense>
    </HydrationBoundary>
  );
}
