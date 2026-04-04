'use server';

/**
 * Dashboard 缓存失效 Server Actions
 *
 * 职责：在后台写操作（创建/更新/删除）完成后，精准清除 Next.js Data Cache，
 * 确保下次访问 Dashboard 时数据是最新的。
 *
 * 调用位置：
 *   - revalidateDashboardOrders → OrdersClient（updateState / delete）
 *   - revalidateDashboardStats  → ManualAdjustModal（adjust）
 *                                 WithdrawAuditModal（withdrawalsAudit）
 *                                 DepositList（syncRecharge）
 *
 * 关联缓存 tags（见 DashboardStats.tsx / page.tsx）：
 *   'dashboard:orders'  — 最近订单列表（revalidate: 30s）
 *   'dashboard:stats'   — 统计卡片（finance + users，revalidate: 60s/300s）
 *   'finance'           — 财务统计（被 Dashboard 和 Finance 页共享）
 */

import { revalidateTag } from 'next/cache';
import { FINANCE_STATS_TAG, FINANCE_TAG } from '@/lib/cache/finance-cache';

/** 订单写操作后调用：清除 Dashboard 最近订单列表缓存 */
export async function revalidateDashboardOrders(): Promise<void> {
  revalidateTag('dashboard:orders');
}

/**
 * 财务写操作后调用：清除财务统计 + Dashboard 统计卡片缓存
 * 包含：手动调账、提现审核、充值同步
 */
export async function revalidateDashboardStats(): Promise<void> {
  revalidateTag(FINANCE_TAG);
  revalidateTag(FINANCE_STATS_TAG);
  revalidateTag('dashboard:stats');
}
