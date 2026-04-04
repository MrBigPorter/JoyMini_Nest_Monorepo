'use client';

/**
 * DashboardHeader — Client Component
 * 显示标题 + 日期 + 刷新按钮。
 * 刷新时同时触发：
 *   - router.refresh()  → 重新渲染 Server Components（DashboardStats）
 *   - queryClient.invalidateQueries() → 重新拉取 DashboardOrdersClient 的订单数据
 */
import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { ClientDate } from '@/components/ui/ClientDate';

export function DashboardHeader() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = async () => {
    setRefreshing(true);
    // 刷新 Server Components（重新 fetch DashboardStats）
    router.refresh();
    // 刷新 Client Components（重新 fetch 订单列表）
    await queryClient.invalidateQueries({ queryKey: ['dashboard-orders'] });
    setRefreshing(false);
  };

  return (
    <div className="flex items-center justify-between">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
          Dashboard
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
          <ClientDate pattern="MMMM d, yyyy" /> · Real-time overview
        </p>
      </div>
      <button
        onClick={handleRefresh}
        className="flex items-center gap-2 px-3 py-2 text-sm text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white bg-gray-100 dark:bg-white/5 rounded-xl transition-all"
      >
        <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
        Refresh
      </button>
    </div>
  );
}
