/**
 * Products Page — Server Component
 * Phase 3: URL searchParams 驱动 filter
 */
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Products' };

import React, { Suspense } from 'react';
import {
  HydrationBoundary,
  QueryClient,
  dehydrate,
} from '@tanstack/react-query';
import { ProductsClient } from '@/components/products/ProductsClient';
import { serverGet } from '@/lib/serverFetch';
import type { PaginatedResponse } from '@/api/types';
import type { Product } from '@/type/types';
import {
  PRODUCTS_LIST_TAG,
  buildProductsListParams,
  parseProductsSearchParams,
  productsListQueryKey,
  type NextSearchParams,
} from '@/lib/cache/products-cache';

function ProductsPageSkeleton() {
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

interface ProductsPageProps {
  searchParams?: Promise<NextSearchParams>;
}

export default async function ProductsPage({
  searchParams,
}: ProductsPageProps) {
  const resolvedSearchParams = (await searchParams) ?? {};
  const queryClient = new QueryClient();
  const queryInput = parseProductsSearchParams(resolvedSearchParams);

  await queryClient.prefetchQuery({
    queryKey: productsListQueryKey(queryInput),
    queryFn: async () => {
      const res = await serverGet<PaginatedResponse<Product>>(
        '/v1/admin/treasure/list',
        buildProductsListParams(queryInput) as Record<
          string,
          string | number | boolean | undefined | null
        >,
        {
          revalidate: 30,
          tags: [PRODUCTS_LIST_TAG],
        },
      );
      return { data: res.list, total: res.total };
    },
  });

  return (
    <Suspense fallback={<ProductsPageSkeleton />}>
      <HydrationBoundary state={dehydrate(queryClient)}>
        <ProductsClient />
      </HydrationBoundary>
    </Suspense>
  );
}
