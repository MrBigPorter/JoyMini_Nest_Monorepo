'use client';

import React from 'react';
import { Copy, FileText, User, Wallet, Clock } from 'lucide-react';
import { Button } from '@repo/ui';
import { Badge } from '@/components/UIComponents';
import { WalletTransaction } from '@/type/types';
import {
  NumHelper,
  TimeHelper,
  TRANSACTION_TYPE_LABEL,
  BALANCE_TYPE,
  TRANSACTION_STATUS,
} from '@lucky/shared';
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard';
import { useTranslation } from '@/hooks/useTranslation';

interface Props {
  data: WalletTransaction;
  close: () => void;
}

// 辅助组件：信息行
const InfoRow: React.FC<{
  label: string;
  value: React.ReactNode;
  icon?: React.ElementType;
}> = ({ label, value, icon: Icon }) => (
  <div className="flex flex-col gap-1">
    <span className="text-xs text-gray-500 flex items-center gap-1">
      {Icon && <Icon size={12} />} {label}
    </span>
    <div className="text-sm font-medium text-gray-900 dark:text-gray-100 break-words">
      {value || '-'}
    </div>
  </div>
);

export const TransactionDetailModal: React.FC<Props> = ({ data, close }) => {
  const { t } = useTranslation();
  const { copy } = useCopyToClipboard();

  const isCash = data.balanceType === BALANCE_TYPE?.CASH;
  const isSuccess =
    data.status === TRANSACTION_STATUS?.SUCCESS ||
    data.status === TRANSACTION_STATUS?.FAILED;
  const isFailed = data.status === TRANSACTION_STATUS?.FAILED;

  return (
    <div className="space-y-6">
      {/* 1. 顶部总览卡片 */}
      <div
        className={`p-4 rounded-xl border ${isSuccess ? 'bg-green-50 border-green-100' : isFailed ? 'bg-red-50 border-red-100' : 'bg-gray-50 border-gray-100'} dark:bg-white/5 dark:border-white/10`}
      >
        <div className="flex justify-between items-start">
          <div>
            <div className="text-xs text-gray-500 uppercase font-semibold">
              {t('finance.transactionDetail.transactionAmount')}
            </div>
            <div
              className={`text-2xl font-bold mt-1 ${Number(data.amount) > 0 ? 'text-green-600' : 'text-red-600'}`}
            >
              {Number(data.amount) > 0 ? '+' : ''}
              {NumHelper.formatMoney(Number(data.amount))}
            </div>
          </div>
          <Badge color={isSuccess ? 'green' : isFailed ? 'red' : 'yellow'}>
            {isSuccess
              ? t('finance.transactionDetail.statusSuccess')
              : isFailed
                ? t('finance.transactionDetail.statusFailed')
                : t('finance.transactionDetail.statusPending')}
          </Badge>
        </div>
      </div>

      {/* 2. 核心信息网格 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-6 gap-x-4">
        {/* User Info */}
        <div className="col-span-2 pb-4 border-b border-gray-100 dark:border-white/10">
          <h4 className="text-sm font-bold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
            <User size={16} className="text-primary-500" />{' '}
            {t('finance.transactionDetail.userInformation')}
          </h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <InfoRow
              label={t('finance.transactionDetail.userNickname')}
              value={data.user?.nickname}
            />
            <InfoRow
              label={t('finance.transactionDetail.userPhone')}
              value={data.user?.phone}
            />
            <InfoRow
              label={t('finance.transactionDetail.userId')}
              value={data.userId}
            />
          </div>
        </div>

        {/* Transaction Info */}
        <div className="col-span-2">
          <h4 className="text-sm font-bold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
            <FileText size={16} className="text-primary-500" />{' '}
            {t('finance.transactionDetail.transactionDetails')}
          </h4>
        </div>

        <div className="col-span-2 sm:col-span-1">
          <InfoRow
            label={t('finance.transactionDetail.transactionNo')}
            value={
              <div className="flex items-center gap-2 min-w-0">
                <span className="font-mono text-xs break-all [overflow-wrap:anywhere] min-w-0">
                  {data.transactionNo}
                </span>
                <Copy
                  size={12}
                  className="cursor-pointer text-gray-400 hover:text-primary-500"
                  onClick={() => copy(data.transactionNo, 'Transaction No.')}
                />
              </div>
            }
          />
        </div>

        <InfoRow
          label={t('finance.transactionDetail.type')}
          value={
            <Badge color="blue">
              {TRANSACTION_TYPE_LABEL[data.transactionType]}
            </Badge>
          }
        />

        <InfoRow
          label={t('finance.transactionDetail.assetClass')}
          value={
            isCash
              ? t('finance.transactionDetail.cashBalance')
              : t('finance.transactionDetail.goldCoins')
          }
        />

        <InfoRow
          label={t('finance.transactionDetail.time')}
          icon={Clock}
          value={TimeHelper.formatDateTime(data.createdAt)}
        />

        {/* 关联单号 */}
        {data.relatedId && (
          <div className="col-span-2 p-3 bg-gray-50 dark:bg-white/5 rounded-lg border border-dashed border-gray-300 dark:border-white/10">
            <InfoRow
              label={t('finance.transactionDetail.relatedRef', {
                type: data.relatedType || 'Unknown',
              })}
              value={
                <span className="font-mono break-all [overflow-wrap:anywhere]">
                  {data.relatedId}
                </span>
              }
            />
          </div>
        )}

        {/* 3. 余额变动快照 */}
        <div className="col-span-2 pt-4 border-t border-gray-100 dark:border-white/10">
          <h4 className="text-sm font-bold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
            <Wallet size={16} className="text-primary-500" />{' '}
            {t('finance.transactionDetail.balanceSnapshot')}
          </h4>
          <div className="flex items-center justify-between bg-gray-50 dark:bg-black/20 p-3 rounded-lg">
            <div>
              <div className="text-xs text-gray-500">
                {t('finance.transactionDetail.before')}
              </div>
              <div className="font-mono font-medium">
                {isCash
                  ? NumHelper.formatMoney(Number(data.beforeBalance))
                  : NumHelper.formatNumber(Number(data.beforeBalance))}
              </div>
            </div>
            <div className="text-gray-300">→</div>
            <div className="text-right">
              <div className="text-xs text-gray-500">
                {t('finance.transactionDetail.after')}
              </div>
              <div className="font-mono font-bold text-gray-900 dark:text-white">
                {isCash
                  ? NumHelper.formatMoney(Number(data.afterBalance))
                  : NumHelper.formatNumber(Number(data.afterBalance))}
              </div>
            </div>
          </div>
        </div>

        {/* 4. 备注信息 */}
        {(data.description || data.remark) && (
          <div className="col-span-2 pt-2">
            <InfoRow
              label={t('finance.transactionDetail.systemDescription')}
              value={data.description}
            />
            {data.remark && (
              <div className="mt-3">
                <InfoRow
                  label={t('finance.transactionDetail.adminRemark')}
                  value={data.remark}
                />
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex justify-end pt-4">
        <Button onClick={close} variant="outline">
          {t('finance.transactionDetail.close')}
        </Button>
      </div>
    </div>
  );
};
