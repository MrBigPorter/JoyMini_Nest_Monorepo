'use client';

import React, { useRef, useMemo, useCallback } from 'react';
import { Badge } from '@repo/ui';
import {
  SmartTable,
  ProColumns,
  ActionType,
} from '@/components/scaffold/SmartTable';
import { financeApi } from '@/api';
import { TransactionsListParams, WalletTransaction } from '@/type/types';
import { TRANSACTION_TYPE, NumHelper } from '@lucky/shared';
import { ArrowDownRight, ArrowUpRight, Repeat } from 'lucide-react';
import { FormSchema } from '@/type/search';
import {
  buildTransactionsListParams,
  parseTransactionsSearchParams,
  transactionsListQueryKey,
} from '@/lib/cache/finance-transactions-cache';

// Build a local options array from the shared enum (no TRANSACTION_TYPES_OPTIONS in shared)
const TRANSACTION_TYPE_OPTIONS = Object.entries(TRANSACTION_TYPE).map(
  ([key, value]) => ({ label: key, value }),
);

interface TransactionListProps {
  initialFormParams?: Record<string, unknown>;
  onParamsChange?: (params: Record<string, unknown>) => void;
}

export const TransactionList: React.FC<TransactionListProps> = ({
  initialFormParams,
  onParamsChange,
}) => {
  const actionRef = useRef<ActionType>(null);

  const normalizedInitialFormParams = useMemo(() => {
    const input = initialFormParams ?? {};
    return parseTransactionsSearchParams({
      page: typeof input.page === 'string' ? input.page : undefined,
      pageSize: typeof input.pageSize === 'string' ? input.pageSize : undefined,
      keyword: typeof input.keyword === 'string' ? input.keyword : undefined,
      transactionType:
        typeof input.transactionType === 'string'
          ? input.transactionType
          : undefined,
      startDate:
        typeof input.startDate === 'string' ? input.startDate : undefined,
      endDate: typeof input.endDate === 'string' ? input.endDate : undefined,
    });
  }, [initialFormParams]);

  const hydrationQueryKey = useMemo(
    () => transactionsListQueryKey(normalizedInitialFormParams),
    [normalizedInitialFormParams],
  );

  const AmountDisplay = ({
    amount,
    type,
  }: {
    amount: string | number;
    type: number;
  }) => {
    const isIncome =
      type === TRANSACTION_TYPE.RECHARGE ||
      type === TRANSACTION_TYPE.REWARD ||
      type === TRANSACTION_TYPE.INVITE_REWARD ||
      type === TRANSACTION_TYPE.REFUND;
    const color = isIncome ? 'text-emerald-500' : 'text-rose-500';
    const sign = isIncome ? '+' : '-';
    return (
      <div className={`font-mono font-bold ${color}`}>
        {sign}
        {NumHelper.formatMoney(amount)}
      </div>
    );
  };

  const columns: ProColumns<WalletTransaction>[] = useMemo(
    () => [
      {
        title: 'Transaction No.',
        dataIndex: 'transactionNo',
        copyable: true,
        width: 180,
      },
      {
        title: 'User Info',
        dataIndex: 'user',
        width: 150,
        render: (_, row) => (
          <div className="flex flex-col">
            <span className="font-medium text-gray-900 dark:text-gray-100">
              {row.user?.nickname || '-'}
            </span>
            <span className="text-xs text-gray-500 dark:text-gray-400 font-mono">
              {row.user?.phone}
            </span>
          </div>
        ),
      },
      {
        title: 'Type',
        dataIndex: 'transactionType',
        width: 120,
        valueType: 'select',
        valueEnum: TRANSACTION_TYPE_OPTIONS.reduce(
          (acc: Record<number, { text: string }>, item) => {
            acc[item.value] = { text: item.label };
            return acc;
          },
          {},
        ),
        render: (_, row) => {
          let icon = <Repeat size={14} className="mr-1 inline" />;
          let color: 'default' | 'success' | 'warning' | 'error' | 'info' =
            'default';

          if (row.transactionType === TRANSACTION_TYPE.RECHARGE) {
            icon = <ArrowDownRight size={14} className="mr-1 inline" />;
            color = 'success';
          } else if (row.transactionType === TRANSACTION_TYPE.WITHDRAWAL) {
            icon = <ArrowUpRight size={14} className="mr-1 inline" />;
            color = 'warning';
          }

          const label =
            TRANSACTION_TYPE_OPTIONS.find(
              (o) => o.value === row.transactionType,
            )?.label || String(row.transactionType);

          return (
            <Badge variant="outline" color={color}>
              {icon}
              {label}
            </Badge>
          );
        },
      },
      {
        title: 'Amount (Cash)',
        dataIndex: 'amount',
        width: 140,
        align: 'right',
        render: (_, row) => (
          <AmountDisplay amount={row.amount} type={row.transactionType} />
        ),
      },
      {
        title: 'Balance After',
        dataIndex: 'afterBalance',
        width: 120,
        align: 'right',
        render: (dom) => (
          <span className="font-mono text-gray-600 dark:text-gray-300">
            {NumHelper.formatMoney(dom as string)}
          </span>
        ),
      },
      {
        title: 'Remark / Ref',
        dataIndex: 'remark',
        width: 200,
        render: (_, row) => (
          <div className="flex flex-col">
            <span className="text-sm text-gray-700 dark:text-gray-300">
              {row.remark || '-'}
            </span>
            {row.relatedId && (
              <span className="text-xs text-gray-400 dark:text-gray-500 font-mono mt-1">
                Ref: {row.relatedId}
              </span>
            )}
          </div>
        ),
      },
      {
        title: 'Time',
        dataIndex: 'createdAt',
        valueType: 'dateTime',
        width: 160,
        sorter: true,
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const searchSchema: FormSchema[] = useMemo(
    () => [
      {
        type: 'input',
        key: 'keyword',
        label: 'Search',
        placeholder: 'Transaction No / Phone / User',
      },
      {
        type: 'select',
        key: 'transactionType',
        label: 'Type',
        defaultValue: 'ALL',
        options: [
          { label: 'All Types', value: 'ALL' },
          ...TRANSACTION_TYPE_OPTIONS.map((opt) => ({
            label: opt.label,
            value: String(opt.value),
          })),
        ],
      },
      {
        type: 'date',
        key: 'dateRange',
        label: 'Time Range',
        props: {
          placeholder: ['Start Date', 'End Date'],
        },
      },
    ],
    [],
  );

  const requestTransactions = useCallback(
    async (params: TransactionsListParams) => {
      const input = params as Record<string, unknown>;
      const queryInput = parseTransactionsSearchParams({
        page: String(params.page ?? 1),
        pageSize: String(params.pageSize ?? 10),
        keyword: typeof input.keyword === 'string' ? input.keyword : undefined,
        transactionType:
          typeof input.transactionType === 'string' ||
          typeof input.transactionType === 'number'
            ? String(input.transactionType)
            : undefined,
        startDate:
          typeof input.startDate === 'string' ? input.startDate : undefined,
        endDate: typeof input.endDate === 'string' ? input.endDate : undefined,
      });

      const res = await financeApi.getTransactions(
        buildTransactionsListParams(queryInput) as TransactionsListParams,
      );
      return {
        data: res.list,
        total: res.total,
        success: true,
      };
    },
    [],
  );

  return (
    <div className="p-4">
      <SmartTable<WalletTransaction>
        rowKey="id"
        headerTitle="Wallet Transactions"
        ref={actionRef}
        columns={columns}
        searchSchema={searchSchema}
        initialFormParams={normalizedInitialFormParams}
        onParamsChange={onParamsChange}
        request={requestTransactions}
        enableHydration={true}
        hydrationQueryKey={hydrationQueryKey}
      />
    </div>
  );
};
