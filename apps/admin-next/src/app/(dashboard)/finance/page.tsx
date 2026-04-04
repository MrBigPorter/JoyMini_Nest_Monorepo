/**
 * Finance Page — Server Component
 * Stage 4: 双 Suspense 并行流式渲染
 *   ① FinanceStatsServer → async Server Component，统计数字服务端直出
 *   ② FinanceClient      → Client Component，Tab 切换 + 列表渲染
 *   ③ transactions 首屏预取 → HydrationBoundary 注水，首屏无客户端瀑布请求
 */
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Finance' };

import React, { Suspense } from 'react';
import {
  HydrationBoundary,
  QueryClient,
  dehydrate,
} from '@tanstack/react-query';
import { FinanceStatsServer } from '@/components/finance/FinanceStatsServer';
import { FinanceClient } from '@/components/finance/FinanceClient';
import { serverGet } from '@/lib/serverFetch';
import type { PaginatedResponse } from '@/api/types';
import type {
  RechargeOrder,
  WalletTransaction,
  WithdrawOrder,
} from '@/type/types';
import {
  buildTransactionsListParams,
  parseTransactionsSearchParams,
  transactionsListQueryKey,
  type NextSearchParams,
} from '@/lib/cache/finance-transactions-cache';
import {
  buildDepositsListParams,
  depositsListQueryKey,
  parseDepositsSearchParams,
} from '@/lib/cache/finance-deposits-cache';
import {
  buildWithdrawalsListParams,
  parseWithdrawalsSearchParams,
  withdrawalsListQueryKey,
} from '@/lib/cache/finance-withdrawals-cache';
import {
  FINANCE_DEPOSITS_TAG,
  FINANCE_TRANSACTIONS_TAG,
  FINANCE_WITHDRAWALS_TAG,
} from '@/lib/cache/finance-cache';

function FinanceSkeleton() {
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

interface FinancePageProps {
  searchParams?: Promise<NextSearchParams>;
}

export default async function FinancePage({ searchParams }: FinancePageProps) {
  const resolvedSearchParams = (await searchParams) ?? {};

  const tab =
    typeof resolvedSearchParams.tab === 'string'
      ? resolvedSearchParams.tab
      : 'transactions';

  const queryClient = new QueryClient();

  if (tab === 'transactions') {
    const queryInput = parseTransactionsSearchParams(resolvedSearchParams);
    await queryClient.prefetchQuery({
      queryKey: transactionsListQueryKey(queryInput),
      queryFn: async () => {
        const res = await serverGet<PaginatedResponse<WalletTransaction>>(
          '/v1/admin/finance/transactions',
          buildTransactionsListParams(queryInput) as Record<
            string,
            string | number | boolean | undefined | null
          >,
          {
            revalidate: 30,
            tags: [FINANCE_TRANSACTIONS_TAG],
          },
        );
        return { data: res.list, total: res.total };
      },
    });
  } else if (tab === 'deposits') {
    const queryInput = parseDepositsSearchParams(resolvedSearchParams);
    await queryClient.prefetchQuery({
      queryKey: depositsListQueryKey(queryInput),
      queryFn: async () => {
        const res = await serverGet<PaginatedResponse<RechargeOrder>>(
          '/v1/admin/finance/recharges',
          buildDepositsListParams(queryInput) as Record<
            string,
            string | number | boolean | undefined | null
          >,
          {
            revalidate: 30,
            tags: [FINANCE_DEPOSITS_TAG],
          },
        );
        return { data: res.list, total: res.total };
      },
    });
  } else if (tab === 'withdrawals') {
    const queryInput = parseWithdrawalsSearchParams(resolvedSearchParams);
    await queryClient.prefetchQuery({
      queryKey: withdrawalsListQueryKey(queryInput),
      queryFn: async () => {
        const res = await serverGet<PaginatedResponse<WithdrawOrder>>(
          '/v1/admin/finance/withdrawals',
          buildWithdrawalsListParams(queryInput) as Record<
            string,
            string | number | boolean | undefined | null
          >,
          {
            revalidate: 30,
            tags: [FINANCE_WITHDRAWALS_TAG],
          },
        );
        return { data: res.list, total: res.total };
      },
    });
  }

  return (
    <div className="space-y-6">
      <Suspense fallback={null}>
        <FinanceStatsServer />
      </Suspense>
      <Suspense fallback={<FinanceSkeleton />}>
        <HydrationBoundary state={dehydrate(queryClient)}>
          <FinanceClient />
        </HydrationBoundary>
      </Suspense>
    </div>
  );
}
