/**
 * FinanceStatsServer — async Server Component
 * Stage 4：统计数字在服务端直出，不占用客户端 JS bundle，无网络瀑布。
 * 配合 finance/page.tsx 的 <Suspense> 实现流式渲染。
 */
import 'server-only';
import { serverGet } from '@/lib/serverFetch';
import { FINANCE_STATS_TAG, FINANCE_TAG } from '@/lib/cache/finance-cache';
import type { FinanceStatistics } from '@/type/types';
import { NumHelper } from '@lucky/shared';
import { Clock, TrendingUp, TrendingDown, Wallet, Lock } from 'lucide-react';
import { FinanceRefreshButton } from './FinanceRefreshButton';

export async function FinanceStatsServer() {
  const statistics = await serverGet<FinanceStatistics>(
    '/v1/admin/finance/statistics',
    undefined,
    {
      revalidate: 60,
      tags: [FINANCE_TAG, FINANCE_STATS_TAG],
    },
  );

  // 无权限 / 请求失败 → 降级展示，不崩溃
  if (!statistics) {
    return (
      <div className="relative overflow-hidden rounded-3xl bg-slate-900 p-8 text-white shadow-2xl ring-1 ring-white/10">
        <div className="relative z-10 flex flex-col items-center justify-center py-8 gap-4 text-center">
          <div className="p-3 bg-slate-700/50 rounded-full">
            <Lock className="h-8 w-8 text-slate-400" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-slate-300">
              No Permission
            </h2>
            <p className="text-sm text-slate-500 mt-1">
              Your account does not have access to finance statistics.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative overflow-hidden rounded-3xl bg-slate-900 p-8 text-white shadow-2xl ring-1 ring-white/10">
      {/* 背景装饰光晕 */}
      <div className="absolute top-0 right-0 -mr-20 -mt-20 h-[500px] w-[500px] rounded-full bg-blue-600/20 blur-[100px] pointer-events-none" />
      <div className="absolute bottom-0 left-0 -ml-20 -mb-20 h-[300px] w-[300px] rounded-full bg-purple-600/20 blur-[80px] pointer-events-none" />

      <div className="relative z-10">
        {/* 标题 + 刷新按钮 */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-3 text-white tracking-tight">
              <div className="p-2 bg-blue-500/20 rounded-lg backdrop-blur-md border border-blue-400/20">
                <Wallet className="text-blue-400 h-6 w-6" />
              </div>
              Finance Center
            </h1>
            <p className="text-slate-400 mt-2 text-sm md:text-base max-w-xl">
              Global financial overview. Monitor deposit inflows, audit pending
              withdrawals, and track real-time liquidity.
            </p>
          </div>
          {/* FinanceRefreshButton 是 Client Component，触发 router.refresh() 重新流式渲染 */}
          <FinanceRefreshButton />
        </div>

        {/* 核心指标卡片 Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <StatsCard
            title="Pending Withdrawals"
            amount={statistics.pendingWithdraw}
            icon={<Clock size={20} className="text-amber-400" />}
            trend="Requires Audit"
            isTrend={false}
            colorClass="bg-amber-500/10 border-amber-500/20 text-amber-400"
          />
          <StatsCard
            title="Total Deposits"
            amount={statistics.totalDeposit}
            isTrend={true}
            trend={statistics.depositTrend}
            colorClass="bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
          />
          <StatsCard
            title="Total Withdrawals"
            amount={statistics.totalWithdraw}
            isTrend={true}
            trend={statistics.withdrawTrend}
            colorClass="bg-rose-500/10 border-rose-500/20 text-rose-400"
          />
        </div>
      </div>
    </div>
  );
}

// --- 子组件：统计卡片（Server Component，无交互，无 state）---
function StatsCard({
  title,
  amount,
  icon,
  trend,
  colorClass,
  isTrend = true,
}: {
  title: string;
  amount: string;
  icon?: React.ReactNode;
  trend: string;
  isTrend?: boolean;
  colorClass: string;
}) {
  const trendValue = Number(trend);
  let trendColor = 'text-slate-400';
  let TrendIcon: React.ElementType | null = null;

  if (trendValue > 0 && isTrend) {
    trendColor = 'text-emerald-400';
    TrendIcon = TrendingUp;
  } else if (trendValue < 0 && isTrend) {
    trendColor = 'text-rose-400';
    TrendIcon = TrendingDown;
  }

  return (
    <div
      className={`relative overflow-hidden rounded-2xl p-5 border backdrop-blur-md transition-transform hover:-translate-y-1 ${colorClass}`}
    >
      <div className="flex justify-between items-start mb-4">
        <div className={`p-2 rounded-lg bg-white/10 ${trendColor}`}>
          {TrendIcon ? <TrendIcon size={20} /> : icon}
        </div>
        <div className="absolute right-[-10px] top-[-10px] opacity-10 scale-150 transform rotate-12" />
      </div>

      <div className="space-y-1">
        <p className="text-slate-300 text-sm font-medium opacity-80">{title}</p>
        <h3 className="text-2xl font-bold tracking-tight text-white">
          {NumHelper.formatMoney(amount)}
        </h3>
      </div>

      <div
        className={`mt-4 flex items-center text-xs font-mono font-bold ${trendColor}`}
      >
        {isTrend ? (
          <>
            {TrendIcon && <TrendIcon size={14} className="mr-1" />}
            {trendValue > 0 ? `+${trendValue}%` : `${trendValue}%`} vs last week
          </>
        ) : (
          <>⏳ {trend}</>
        )}
      </div>
    </div>
  );
}
