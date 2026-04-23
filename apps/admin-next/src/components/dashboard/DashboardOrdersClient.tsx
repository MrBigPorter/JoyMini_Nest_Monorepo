'use client';

/**
 * DashboardOrdersClient — Client Component
 * 使用 @tanstack/react-query useQuery。
 * 初始数据由 page.tsx 通过 HydrationBoundary 从服务端预取注入。
 * 客户端可以独立刷新，不影响 Server Component 部分。
 */
import React from 'react';
import { ShoppingCart, ArrowRight } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { Card, Badge } from '@/components/UIComponents';
import type { BadgeColor } from '@/components/UIComponents';
import { orderApi } from '@/api';
import { SmartImage } from '@/components/ui/SmartImage';
import { useRouter } from 'next/navigation';
import { ClientDate } from '@/components/ui/ClientDate';
import { useTranslation } from '@/hooks/useTranslation';

export function DashboardOrdersClient() {
  const router = useRouter();
  const { t } = useTranslation();

  const { data: ordersRes, isLoading } = useQuery({
    queryKey: ['dashboard-orders'],
    queryFn: () => orderApi.getList({ page: 1, pageSize: 5 }),
    staleTime: 30_000, // 30s 内不重新请求（秒级一致性）
    gcTime: 5 * 60 * 1000, // 5min 后从内存清理（防泄漏）
    refetchOnWindowFocus: true, // 切回窗口时自动检查是否需要刷新
  });

  const orders = ordersRes?.list ?? [];
  const totalOrders = ordersRes?.total ?? 0;

  // 订单状态映射函数
  const getOrderStatus = (status: number) => {
    const statusMap: Record<number, { label: string; color: BadgeColor }> = {
      1: { label: t('dashboard_orderStatusPending'), color: 'yellow' },
      2: { label: t('dashboard_orderStatusPaid'), color: 'green' },
      3: { label: t('dashboard_orderStatusCancelled'), color: 'gray' },
      4: { label: t('dashboard_orderStatusRefunded'), color: 'red' },
    };
    return (
      statusMap[status] ?? {
        label: t('dashboard_orderStatusUnknown'),
        color: 'gray' as BadgeColor,
      }
    );
  };

  return (
    <Card>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <ShoppingCart size={18} className="text-primary-500" />
          <h3 className="font-semibold text-gray-900 dark:text-white">
            {t('dashboard_recentOrders')}
          </h3>
          {!isLoading && (
            <span className="text-xs text-gray-400 bg-gray-100 dark:bg-white/10 px-2 py-0.5 rounded-full">
              {totalOrders.toLocaleString()} {t('dashboard_total')}
            </span>
          )}
        </div>
        <button
          onClick={() => router.push('/orders')}
          className="flex items-center gap-1 text-xs text-primary-500 hover:text-primary-600 font-medium"
        >
          {t('dashboard_viewAll')} <ArrowRight size={12} />
        </button>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="h-14 rounded-xl bg-gray-100 dark:bg-white/5 animate-pulse"
            />
          ))}
        </div>
      ) : orders.length === 0 ? (
        <div className="py-12 text-center text-gray-400 text-sm">
          {t('dashboard_noOrdersYet')}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="text-gray-400 border-b border-gray-100 dark:border-white/5 text-xs font-semibold uppercase tracking-wider">
                <th className="pb-3">{t('dashboard_order')}</th>
                <th className="pb-3">{t('dashboard_product')}</th>
                <th className="pb-3">{t('dashboard_customer')}</th>
                <th className="pb-3">{t('dashboard_amount')}</th>
                <th className="pb-3">{t('dashboard_status')}</th>
                <th className="pb-3">{t('dashboard_date')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-white/5">
              {orders.map((order) => {
                const status = getOrderStatus(order.orderStatus);
                return (
                  <tr
                    key={order.orderId}
                    className="hover:bg-gray-50 dark:hover:bg-white/5 transition-colors"
                  >
                    <td className="py-3 text-gray-400 font-mono text-xs">
                      #{order.orderNo.slice(-8)}
                    </td>
                    <td className="py-3">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-lg overflow-hidden shrink-0 bg-gray-100 dark:bg-gray-800">
                          <SmartImage
                            src={order.treasure?.treasureCoverImg}
                            width={32}
                            height={32}
                            className="w-full h-full object-cover"
                          />
                        </div>
                        <span className="text-sm font-medium text-gray-900 dark:text-white line-clamp-1 max-w-[140px]">
                          {order.treasure?.treasureName ?? '—'}
                        </span>
                      </div>
                    </td>
                    <td className="py-3 text-sm text-gray-500">
                      {order.user?.nickname ?? '—'}
                    </td>
                    <td className="py-3 text-sm font-bold text-gray-900 dark:text-white">
                      ₱{order.finalAmount.toLocaleString()}
                    </td>
                    <td className="py-3">
                      <Badge color={status.color}>{status.label}</Badge>
                    </td>
                    <td className="py-3 text-xs text-gray-400">
                      <ClientDate
                        value={order.createdAt}
                        unit="s"
                        pattern="MM-dd HH:mm"
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
