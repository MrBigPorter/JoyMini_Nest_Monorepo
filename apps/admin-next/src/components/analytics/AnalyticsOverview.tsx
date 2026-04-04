/**
 * AnalyticsOverview — async Server Component
 * 服务端 fetch /v1/admin/stats/overview，Streaming SSR
 */
import React from 'react';
import {
  Users,
  ShoppingCart,
  DollarSign,
  TrendingUp,
  Clock,
  CheckCircle,
} from 'lucide-react';
import { Card } from '@/components/UIComponents';
import { serverGet } from '@/lib/serverFetch';
import type { StatsOverview } from '@/type/types';

function fmt(val: string | number, prefix = '₱') {
  const n = typeof val === 'string' ? parseFloat(val) : val;
  if (isNaN(n)) return `${prefix}0`;
  return `${prefix}${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function StatCard({
  title,
  value,
  sub,
  icon,
  iconBg,
}: {
  title: string;
  value: string | number;
  sub?: string;
  icon: React.ReactNode;
  iconBg: string;
}) {
  return (
    <Card className="flex flex-col gap-3 p-5">
      <div className="flex items-start justify-between">
        <div
          className={`w-10 h-10 rounded-xl flex items-center justify-center ${iconBg}`}
        >
          {icon}
        </div>
        {sub && (
          <span className="text-xs text-gray-400 dark:text-gray-500 font-medium">
            {sub}
          </span>
        )}
      </div>
      <p className="text-2xl font-bold text-gray-900 dark:text-white tracking-tight">
        {value}
      </p>
      <p className="text-sm text-gray-500 dark:text-gray-400">{title}</p>
    </Card>
  );
}

export async function AnalyticsOverview() {
  const data = await serverGet<StatsOverview>(
    '/v1/admin/stats/overview',
    undefined,
    { revalidate: 120 },
  ).catch(() => null);

  if (!data) {
    return (
      <div className="p-6 text-center text-gray-400">
        Failed to load statistics. Please refresh.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-4">
      <StatCard
        title="Total Users"
        value={data.users.total.toLocaleString()}
        sub={`+${data.users.today} today`}
        icon={<Users size={18} className="text-purple-600" />}
        iconBg="bg-purple-100 dark:bg-purple-500/15"
      />
      <StatCard
        title="New This Month"
        value={data.users.thisMonth.toLocaleString()}
        icon={<TrendingUp size={18} className="text-indigo-600" />}
        iconBg="bg-indigo-100 dark:bg-indigo-500/15"
      />
      <StatCard
        title="Total Orders"
        value={data.orders.total.toLocaleString()}
        sub={`+${data.orders.today} today`}
        icon={<ShoppingCart size={18} className="text-blue-600" />}
        iconBg="bg-blue-100 dark:bg-blue-500/15"
      />
      <StatCard
        title="Paid Orders"
        value={data.orders.paid.toLocaleString()}
        icon={<CheckCircle size={18} className="text-emerald-600" />}
        iconBg="bg-emerald-100 dark:bg-emerald-500/15"
      />
      <StatCard
        title="Total Revenue"
        value={fmt(data.revenue.total)}
        sub={`${fmt(data.revenue.today)} today`}
        icon={<DollarSign size={18} className="text-amber-600" />}
        iconBg="bg-amber-100 dark:bg-amber-500/15"
      />
      <StatCard
        title="Pending Withdrawals"
        value={data.finance.pendingWithdrawCount.toLocaleString()}
        sub={fmt(data.finance.pendingWithdrawAmount)}
        icon={<Clock size={18} className="text-red-500" />}
        iconBg="bg-red-100 dark:bg-red-500/15"
      />
    </div>
  );
}
