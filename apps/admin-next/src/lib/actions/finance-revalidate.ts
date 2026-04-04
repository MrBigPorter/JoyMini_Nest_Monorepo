'use server';

import { revalidateTag } from 'next/cache';
import {
  FINANCE_DEPOSITS_TAG,
  FINANCE_STATS_TAG,
  FINANCE_TAG,
  FINANCE_TRANSACTIONS_TAG,
  FINANCE_WITHDRAWALS_TAG,
} from '@/lib/cache/finance-cache';

/**
 * Finance 统计卡片失效：
 * - Finance 页统计卡片
 * - Dashboard 页共享财务统计
 */
export async function revalidateFinanceStats(): Promise<void> {
  revalidateTag(FINANCE_TAG);
  revalidateTag(FINANCE_STATS_TAG);
  revalidateTag('dashboard:stats');
}

/** 余额调整会影响统计与交易流水 */
export async function revalidateFinanceAfterAdjust(): Promise<void> {
  await revalidateFinanceStats();
  revalidateTag(FINANCE_TRANSACTIONS_TAG);
}

/** 提现审核会影响统计、提现列表、交易流水 */
export async function revalidateFinanceAfterWithdrawAudit(): Promise<void> {
  await revalidateFinanceStats();
  revalidateTag(FINANCE_WITHDRAWALS_TAG);
  revalidateTag(FINANCE_TRANSACTIONS_TAG);
}

/** 充值同步会影响统计、充值列表、交易流水 */
export async function revalidateFinanceAfterRechargeSync(): Promise<void> {
  await revalidateFinanceStats();
  revalidateTag(FINANCE_DEPOSITS_TAG);
  revalidateTag(FINANCE_TRANSACTIONS_TAG);
}
