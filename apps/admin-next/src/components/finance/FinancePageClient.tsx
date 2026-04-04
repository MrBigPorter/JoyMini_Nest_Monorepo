'use client';

/**
 * FinancePage — Client Component（Tabs only）
 * Stage 4: Stats 已抽离到 FinanceStatsServer（async Server Component）
 * 本组件只负责 Tab 切换 + 列表渲染，不再拉取 statistics。
 */
import React, {
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { financeApi } from '@/api';
import { TransactionList } from '@/views/finance/TransactionList';
import { WithdrawalList } from '@/views/finance/WithdrawalList';
import { DepositList } from '@/views/finance/DepositList';
import { FileText, ArrowRightLeft, TrendingUp } from 'lucide-react';
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

interface FinancePageProps {
  initialFormParams?: Record<string, unknown>;
  onParamsChange?: (params: Record<string, unknown>) => void;
}

type FinanceTab = 'deposits' | 'transactions' | 'withdrawals';
const PREFETCH_STALE_TIME = 30_000;
const PREFETCH_TABS: FinanceTab[] = ['deposits', 'withdrawals'];

const isFinanceTab = (value: unknown): value is FinanceTab =>
  value === 'deposits' || value === 'transactions' || value === 'withdrawals';

export const FinancePage: React.FC<FinancePageProps> = ({
  initialFormParams,
  onParamsChange,
}) => {
  const queryClient = useQueryClient();
  const onParamsChangeRef = useRef(onParamsChange);
  const initialTab = isFinanceTab(initialFormParams?.tab)
    ? initialFormParams.tab
    : 'transactions';
  const [activeTab, setActiveTab] = useState<FinanceTab>(initialTab);

  useEffect(() => {
    onParamsChangeRef.current = onParamsChange;
  }, [onParamsChange]);

  // `tab` is page UI state only; do not pass it into list query params.
  const listInitialParams = useMemo(() => {
    const rest = { ...(initialFormParams ?? {}) };
    delete rest.tab;
    return rest;
  }, [initialFormParams]);

  const prefetchDeposits = useCallback(() => {
    const queryInput = parseDepositsSearchParams({
      page:
        typeof listInitialParams.page === 'string'
          ? listInitialParams.page
          : '1',
      pageSize:
        typeof listInitialParams.pageSize === 'string'
          ? listInitialParams.pageSize
          : '10',
      keyword:
        typeof listInitialParams.keyword === 'string'
          ? listInitialParams.keyword
          : undefined,
      status:
        typeof listInitialParams.status === 'string'
          ? listInitialParams.status
          : undefined,
      channel:
        typeof listInitialParams.channel === 'string'
          ? listInitialParams.channel
          : undefined,
      startDate:
        typeof listInitialParams.startDate === 'string'
          ? listInitialParams.startDate
          : undefined,
      endDate:
        typeof listInitialParams.endDate === 'string'
          ? listInitialParams.endDate
          : undefined,
    });

    const queryKey = depositsListQueryKey(queryInput);
    const queryState = queryClient.getQueryState<{
      data: unknown[];
      total: number;
    }>(queryKey);
    if (queryState?.fetchStatus === 'fetching') {
      return;
    }
    if (
      queryState?.dataUpdatedAt &&
      Date.now() - queryState.dataUpdatedAt < PREFETCH_STALE_TIME
    ) {
      return;
    }

    void queryClient.prefetchQuery({
      queryKey,
      queryFn: async () => {
        const res = await financeApi.getDeposits(
          buildDepositsListParams(queryInput),
        );
        return { data: res.list, total: res.total };
      },
      staleTime: PREFETCH_STALE_TIME,
    });
  }, [listInitialParams, queryClient]);

  const prefetchWithdrawals = useCallback(() => {
    const queryInput = parseWithdrawalsSearchParams({
      page:
        typeof listInitialParams.page === 'string'
          ? listInitialParams.page
          : '1',
      pageSize:
        typeof listInitialParams.pageSize === 'string'
          ? listInitialParams.pageSize
          : '10',
      keyword:
        typeof listInitialParams.keyword === 'string'
          ? listInitialParams.keyword
          : undefined,
      status:
        typeof listInitialParams.status === 'string'
          ? listInitialParams.status
          : undefined,
      startDate:
        typeof listInitialParams.startDate === 'string'
          ? listInitialParams.startDate
          : undefined,
      endDate:
        typeof listInitialParams.endDate === 'string'
          ? listInitialParams.endDate
          : undefined,
    });

    const queryKey = withdrawalsListQueryKey(queryInput);
    const queryState = queryClient.getQueryState<{
      data: unknown[];
      total: number;
    }>(queryKey);
    if (queryState?.fetchStatus === 'fetching') {
      return;
    }
    if (
      queryState?.dataUpdatedAt &&
      Date.now() - queryState.dataUpdatedAt < PREFETCH_STALE_TIME
    ) {
      return;
    }

    void queryClient.prefetchQuery({
      queryKey,
      queryFn: async () => {
        const res = await financeApi.getWithdrawals(
          buildWithdrawalsListParams(queryInput),
        );
        return { data: res.list, total: res.total };
      },
      staleTime: PREFETCH_STALE_TIME,
    });
  }, [listInitialParams, queryClient]);

  const prefetchByTab = useCallback(
    (tab: FinanceTab) => {
      if (tab === 'deposits') {
        prefetchDeposits();
        return;
      }
      if (tab === 'withdrawals') {
        prefetchWithdrawals();
      }
    },
    [prefetchDeposits, prefetchWithdrawals],
  );

  // Idle warm-up: prefetch non-active tabs in sequence to reduce first switch latency.
  useEffect(() => {
    if (process.env.NODE_ENV === 'test') {
      return;
    }

    if (typeof window === 'undefined') {
      return;
    }

    const tabsToPrefetch = PREFETCH_TABS.filter((tab) => tab !== activeTab);
    if (tabsToPrefetch.length === 0) {
      return;
    }

    let cancelled = false;
    const timeoutIds: number[] = [];
    let idleId: number | null = null;

    const runPrefetch = () => {
      if (typeof window === 'undefined') return;
      tabsToPrefetch.forEach((tab, index) => {
        const id = window.setTimeout(() => {
          if (!cancelled) {
            prefetchByTab(tab);
          }
        }, index * 200);
        timeoutIds.push(id);
      });
    };

    if ('requestIdleCallback' in window) {
      idleId = (
        window as Window & {
          requestIdleCallback: (cb: IdleRequestCallback) => number;
        }
      ).requestIdleCallback(() => {
        if (!cancelled) runPrefetch();
      });
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const id = (window as any).setTimeout(runPrefetch, 120);
      timeoutIds.push(id);
    }

    return () => {
      cancelled = true;
      timeoutIds.forEach((id) => window.clearTimeout(id));
      if (idleId !== null && 'cancelIdleCallback' in window) {
        (
          window as Window & {
            cancelIdleCallback: (id: number) => void;
          }
        ).cancelIdleCallback(idleId);
      }
    };
  }, [activeTab, prefetchByTab]);

  // 当 Tab 切换时同步更新 URL
  useEffect(() => {
    onParamsChangeRef.current?.({ tab: activeTab });
  }, [activeTab]);

  return (
    <div className="flex flex-col space-y-6">
      {/* Tab 导航 */}
      <div className="border-b border-gray-200 dark:border-gray-700">
        <nav className="flex space-x-8" aria-label="Tabs">
          <TabButton
            isActive={activeTab === 'transactions'}
            onClick={() => setActiveTab('transactions')}
            icon={<ArrowRightLeft size={18} />}
            label="Transactions Flow"
          />
          <TabButton
            isActive={activeTab === 'deposits'}
            onClick={() => {
              prefetchByTab('deposits');
              setActiveTab('deposits');
            }}
            onMouseEnter={() => prefetchByTab('deposits')}
            onFocus={() => prefetchByTab('deposits')}
            icon={<TrendingUp size={18} />}
            label="Deposit Records"
          />
          <TabButton
            isActive={activeTab === 'withdrawals'}
            onClick={() => {
              prefetchByTab('withdrawals');
              setActiveTab('withdrawals');
            }}
            onMouseEnter={() => prefetchByTab('withdrawals')}
            onFocus={() => prefetchByTab('withdrawals')}
            icon={<FileText size={18} />}
            label="Withdrawal Audits"
          />
        </nav>
      </div>

      {/* 内容区域 */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl p-6 shadow-sm border border-gray-100 dark:border-white/10 min-h-[600px] transition-all">
        {activeTab === 'deposits' && (
          <DepositList
            initialFormParams={listInitialParams}
            onParamsChange={(params) =>
              onParamsChange?.({ ...params, tab: 'deposits' })
            }
          />
        )}
        {activeTab === 'transactions' && (
          <TransactionList
            initialFormParams={listInitialParams}
            onParamsChange={(params) =>
              onParamsChange?.({ ...params, tab: 'transactions' })
            }
          />
        )}
        {activeTab === 'withdrawals' && (
          <WithdrawalList
            initialFormParams={listInitialParams}
            onParamsChange={(params) =>
              onParamsChange?.({ ...params, tab: 'withdrawals' })
            }
          />
        )}
      </div>
    </div>
  );
};

// --- 子组件：Tab 按钮 ---
const TabButton = ({
  isActive,
  onClick,
  onMouseEnter,
  onFocus,
  icon,
  label,
  badge,
}: {
  isActive: boolean;
  onClick: () => void;
  onMouseEnter?: () => void;
  onFocus?: () => void;
  icon: React.ReactNode;
  label: string;
  badge?: string;
}) => (
  <button
    onClick={onClick}
    onMouseEnter={onMouseEnter}
    onFocus={onFocus}
    className={`
      group relative py-4 px-1 flex items-center gap-2 text-sm font-medium transition-all duration-200 ease-in-out
      ${
        isActive
          ? 'text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400'
          : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 border-b-2 border-transparent hover:border-gray-300'
      }
    `}
  >
    <span
      className={`transition-colors ${isActive ? 'text-blue-600 dark:text-blue-400' : 'text-gray-400 group-hover:text-gray-600 dark:text-gray-500 dark:group-hover:text-gray-300'}`}
    >
      {icon}
    </span>
    {label}
    {badge && (
      <span className="ml-2 bg-red-100 text-red-600 dark:bg-red-500/20 dark:text-red-300 py-0.5 px-2 rounded-full text-[10px] font-bold uppercase tracking-wide">
        {badge}
      </span>
    )}
  </button>
);
