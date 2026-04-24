'use client';

import React, { useRef, useMemo, useCallback } from 'react';
import { Button, ModalManager } from '@repo/ui'; // 假设有 Tag 组件
import {
  SmartTable,
  ProColumns,
  ActionType,
} from '@/components/scaffold/SmartTable';
import { financeApi } from '@/api';
import { WithdrawListParams, WithdrawOrder } from '@/type/types';
import { WithdrawAuditModal } from './WithdrawAuditModal';
import { getStatusConfig } from '@/views/finance/type';
import {
  WITHDRAW_STATUS,
  WITHDRAW_STATUS_OPTIONS,
  NumHelper,
} from '@lucky/shared';
import { EyeIcon, ShieldCheck, Wallet, Landmark } from 'lucide-react';
import { FormSchema } from '@/type/search';
import {
  buildWithdrawalsListParams,
  parseWithdrawalsSearchParams,
  withdrawalsListQueryKey,
} from '@/lib/cache/finance-withdrawals-cache';
import { useTranslation } from '@/hooks/useTranslation';

// 简单的渠道图标映射助手
const ChannelIcon = ({
  code,
  name,
  t,
}: {
  code?: string;
  name?: string;
  t?: (key: string) => string;
}) => {
  const isBank = code?.includes('BANK') || name?.toLowerCase().includes('bank');
  return (
    <div className="flex items-center gap-2">
      <div
        className={`p-1.5 rounded-full ${isBank ? 'bg-indigo-50 text-indigo-600' : 'bg-blue-50 text-blue-600'}`}
      >
        {isBank ? <Landmark size={14} /> : <Wallet size={14} />}
      </div>
      <span className="font-medium text-sm text-gray-900 dark:text-gray-100">
        {name || (t ? t('finance.withdrawals.unknown') : 'Unknown')}
      </span>
    </div>
  );
};

interface WithdrawalListProps {
  initialFormParams?: Record<string, unknown>;
  onParamsChange?: (params: Record<string, unknown>) => void;
}

export const WithdrawalList: React.FC<WithdrawalListProps> = ({
  initialFormParams,
  onParamsChange,
}) => {
  const actionRef = useRef<ActionType>(null);
  const { t } = useTranslation();

  const normalizedInitialFormParams = useMemo(() => {
    const input = initialFormParams ?? {};
    return parseWithdrawalsSearchParams({
      page: typeof input.page === 'string' ? input.page : undefined,
      pageSize: typeof input.pageSize === 'string' ? input.pageSize : undefined,
      keyword: typeof input.keyword === 'string' ? input.keyword : undefined,
      status: typeof input.status === 'string' ? input.status : undefined,
      startDate:
        typeof input.startDate === 'string' ? input.startDate : undefined,
      endDate: typeof input.endDate === 'string' ? input.endDate : undefined,
    });
  }, [initialFormParams]);

  const hydrationQueryKey = useMemo(
    () => withdrawalsListQueryKey(normalizedInitialFormParams),
    [normalizedInitialFormParams],
  );

  const handleAudit = useCallback(
    (record: WithdrawOrder) => {
      ModalManager.open({
        title: t('finance.withdrawals.auditTitle'),
        renderChildren: ({ confirm }) => (
          <WithdrawAuditModal
            data={record}
            confirm={() => {
              confirm();
              actionRef.current?.reload(); // 审核完只需刷新数据，不需要 reset 页码
            }}
          />
        ),
      });
    },
    [t],
  );

  const statusConfig = useMemo(() => getStatusConfig(t), [t]);

  const statusValueEnum = useMemo(() => {
    return WITHDRAW_STATUS_OPTIONS.reduce(
      (acc, item) => {
        const config = statusConfig[item.value] || {
          color: 'default',
          label: item.label,
        };
        acc[item.value] = { text: config.label, status: config.color };
        return acc;
      },
      {} as Record<number, { text: string; status?: string }>,
    );
  }, [statusConfig]);

  const columns: ProColumns<WithdrawOrder>[] = useMemo(
    () => [
      {
        title: t('finance.withdrawals.orderNo'),
        dataIndex: 'withdrawNo',
        copyable: true,
        width: 180,
        render: (dom, row) => (
          <div className="flex flex-col">
            <span>{dom}</span>
            <span className="text-[10px] text-gray-400 dark:text-gray-500">
              {row.thirdPartyOrderNo}
            </span>
          </div>
        ),
      },
      {
        title: t('finance.withdrawals.userInfo'),
        dataIndex: 'user',
        width: 150,
        render: (_, row) => (
          <div className="flex items-center gap-2">
            {/* 如果有头像组件最好 */}
            <div>
              <div className="font-medium text-gray-900 dark:text-gray-100">
                {row.user?.nickname || '-'}
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400 font-mono">
                {row.user?.phone}
              </div>
            </div>
          </div>
        ),
      },
      {
        title: t('finance.withdrawals.channel'),
        dataIndex: 'bankName',
        width: 140,
        render: (_, row) => (
          <ChannelIcon code={row.channelCode} name={row.bankName} t={t} />
        ),
      },
      {
        title: t('finance.withdrawals.beneficiary'),
        width: 160,
        render: (_, row) => (
          <div className="flex flex-col">
            <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
              {row.accountName}
            </span>
            <span className="text-xs text-gray-500 dark:text-gray-400 font-mono">
              {row.withdrawAccount}
            </span>
          </div>
        ),
      },
      {
        title: t('finance.withdrawals.amountInfo'),
        dataIndex: 'withdrawAmount',
        width: 140,
        align: 'right', // 财务数据习惯右对齐
        render: (_, row) => (
          <div className="flex flex-col items-end">
            {/* 申请金额 */}
            <span className="font-bold ">
              {NumHelper.formatMoney(row.withdrawAmount)}
            </span>
            {/* 实付金额 (高亮显示) */}
            <div className="flex items-center gap-1 text-xs">
              <span className="text-gray-400 dark:text-gray-500">
                {t('finance.withdrawals.actualAmount')}:
              </span>
              <span className="font-medium text-primary-600">
                {NumHelper.formatMoney(row.actualAmount)}
              </span>
            </div>
          </div>
        ),
      },
      {
        title: t('finance.withdrawals.status'),
        dataIndex: 'withdrawStatus',
        valueType: 'select',
        valueEnum: statusValueEnum,
        width: 100,
      },
      {
        title: t('finance.withdrawals.time'),
        dataIndex: 'appliedAt',
        valueType: 'dateTime',
        width: 160,
        sorter: true, // 允许按时间排序
      },
      {
        title: t('finance.withdrawals.action'),
        valueType: 'option',
        fixed: 'right', // 固定在右侧
        width: 100,
        render: (_, row) => {
          const isPending =
            row.withdrawStatus === WITHDRAW_STATUS.PENDING_AUDIT;
          return (
            <Button
              variant={isPending ? 'info' : 'outline'}
              color={isPending ? 'primary' : 'gray'} // 待审核用醒目色
              size="sm"
              onClick={() => handleAudit(row)}
            >
              {isPending ? (
                <ShieldCheck size={14} className="mr-1" />
              ) : (
                <EyeIcon size={14} className="mr-1" />
              )}
              {isPending
                ? t('finance.withdrawals.audit')
                : t('finance.withdrawals.detail')}
            </Button>
          );
        },
      },
    ],
    [handleAudit, statusValueEnum, t],
  );

  const searchSchema: FormSchema[] = useMemo(
    () => [
      {
        type: 'input',
        key: 'keyword',
        label: t('finance.withdrawals.search'),
        placeholder: t('finance.withdrawals.searchPlaceholder'),
      },
      {
        type: 'select',
        key: 'status',
        label: t('finance.withdrawals.status'),
        defaultValue: 'ALL',
        options: [
          { label: t('finance.withdrawals.allStatus'), value: 'ALL' },
          ...WITHDRAW_STATUS_OPTIONS.map((opt) => ({
            label: opt.label,
            value: String(opt.value),
          })),
        ],
      },
      {
        type: 'date', // 建议改用范围选择器
        key: 'dateRange',
        label: t('finance.withdrawals.appliedDate'),
        props: {
          placeholder: [
            t('finance.withdrawals.startDate'),
            t('finance.withdrawals.endDate'),
          ],
        },
      },
    ],
    [t],
  );

  const requestWithdrawals = useCallback(async (params: WithdrawListParams) => {
    const input = params as Record<string, unknown>;
    const dateRange = input.dateRange as
      | { from?: string; to?: string }
      | undefined;
    const queryInput = parseWithdrawalsSearchParams({
      page: String(params.page ?? 1),
      pageSize: String(params.pageSize ?? 10),
      keyword: typeof input.keyword === 'string' ? input.keyword : undefined,
      status:
        typeof input.status === 'string' || typeof input.status === 'number'
          ? String(input.status)
          : undefined,
      startDate:
        typeof input.startDate === 'string' ? input.startDate : dateRange?.from,
      endDate:
        typeof input.endDate === 'string' ? input.endDate : dateRange?.to,
    });

    const res = await financeApi.getWithdrawals(
      buildWithdrawalsListParams(queryInput) as WithdrawListParams,
    );
    return {
      data: res.list,
      total: res.total,
      success: true,
    };
  }, []);

  return (
    <div className="p-4 ">
      <SmartTable<WithdrawOrder>
        rowKey="withdrawId"
        headerTitle={t('finance.withdrawals.headerTitle')}
        ref={actionRef}
        columns={columns}
        searchSchema={searchSchema}
        initialFormParams={normalizedInitialFormParams}
        onParamsChange={onParamsChange}
        request={requestWithdrawals}
        enableHydration={true}
        hydrationQueryKey={hydrationQueryKey}
      />
    </div>
  );
};
