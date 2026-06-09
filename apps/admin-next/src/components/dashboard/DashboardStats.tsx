/**
 * DashboardStats — Server Component
 * 服务端直接 fetch 财务统计 + 用户总数，零 loading 闪烁。
 * 被 page.tsx 用 <Suspense> 包裹，支持 Streaming SSR。
 */
import 'server-only';
import React from 'react';
import {
  DollarSign,
  Users,
  Clock,
  TrendingUp,
  TrendingDown,
  Minus,
} from 'lucide-react';
import { Card } from '@/components/UIComponents';
import { serverGet } from '@/lib/serverFetch';
import { FINANCE_STATS_TAG, FINANCE_TAG } from '@/lib/cache/finance-cache';
import { getTranslations } from 'next-intl/server';
import type { FinanceStatistics, ClientUserListItem } from '@/type/types';
import type { PaginatedResponse } from '@/api/types';
import type { Locale } from '@lucky/shared';

// ── Trend 组件（纯展示，无交互） ───────────────────────────────
function Trend({
  value,
  t,
}: {
  value: string;
  t: (key: string, values?: Record<string, string | number>) => string;
}) {
  const num = parseFloat(value ?? '0');
  if (isNaN(num) || num === 0) {
    return (
      <span className="flex items-center gap-1 text-xs text-gray-400">
        <Minus size={12} />
        {t('dashboard_trendZero')}
      </span>
    );
  }

  const isUp = num > 0;
  return (
    <span
      className={`flex items-center gap-1 text-xs font-semibold ${
        isUp ? 'text-emerald-500' : 'text-red-400'
      }`}
    >
      {isUp ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
      {isUp ? '+' : ''}
      {t('dashboard_trendComparison', { percent: num.toFixed(1) })}
    </span>
  );
}

// ── StatCard 组件 ────────────────────────────────────────────
function StatCard({
  title,
  value,
  icon,
  iconBg,
  trend,
}: {
  title: string;
  value: string | number;
  icon: React.ReactNode;
  iconBg: string;
  trend?: React.ReactNode;
}) {
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-start justify-between">
        <div
          className={`w-11 h-11 rounded-xl flex items-center justify-center ${iconBg}`}
        >
          {icon}
        </div>
        {trend}
      </div>
      <p className="text-2xl font-bold text-gray-900 dark:text-white tracking-tight">
        {value}
      </p>
      <p className="text-sm text-gray-500 dark:text-gray-400">{title}</p>
    </Card>
  );
}

// ── 主组件（async Server Component）─────────────────────────
export async function DashboardStats({ locale: _locale }: { locale?: Locale }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const t = (await getTranslations()) as any;

  const [finance, usersRes] = await (async () => {
    // 并行请求，任一失败则 fallback 为 null
    return Promise.all([
      serverGet<FinanceStatistics>(
        '/v1/admin/finance/statistics',
        undefined,
        {
          revalidate: 60,
          tags: ['dashboard:stats', FINANCE_TAG, FINANCE_STATS_TAG],
        },
      ).catch(() => null),
      serverGet<PaginatedResponse<ClientUserListItem>>(
        '/v1/admin/client-user/list',
        { page: 1, pageSize: 1 },
        { revalidate: 300, tags: ['dashboard:stats', 'admin:users'] },
      ).catch(() => null),
    ]);
  })();

  const totalUsers = usersRes?.total ?? 0;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-5">
      <StatCard
        title={t('dashboard_totalDeposits')}
        value={
          finance
            ? `₱${parseFloat(finance.totalDeposit).toLocaleString()}`
            : '—'
        }
        icon={<DollarSign size={20} className="text-emerald-600" />}
        iconBg="bg-emerald-100 dark:bg-emerald-500/15"
        trend={
          finance ? <Trend value={finance.depositTrend} t={t} /> : undefined
        }
      />
      <StatCard
        title={t('dashboard_totalWithdrawals')}
        value={
          finance
            ? `₱${parseFloat(finance.totalWithdraw).toLocaleString()}`
            : '—'
        }
        icon={<DollarSign size={20} className="text-blue-600" />}
        iconBg="bg-blue-100 dark:bg-blue-500/15"
        trend={
          finance ? <Trend value={finance.withdrawTrend} t={t} /> : undefined
        }
      />
      <StatCard
        title={t('dashboard_pendingWithdrawals')}
        value={
          finance
            ? `₱${parseFloat(finance.pendingWithdraw).toLocaleString()}`
            : '—'
        }
        icon={<Clock size={20} className="text-amber-600" />}
        iconBg="bg-amber-100 dark:bg-amber-500/15"
        trend={
          <span className="text-xs text-amber-500 font-medium">
            {t('dashboard_requiresAudit')}
          </span>
        }
      />
      <StatCard
        title={t('dashboard_totalUsers')}
        value={totalUsers.toLocaleString()}
        icon={<Users size={20} className="text-purple-600" />}
        iconBg="bg-purple-100 dark:bg-purple-500/15"
      />
    </div>
  );
}
