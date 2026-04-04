'use client';

import React, { useMemo, useState } from 'react';
import { useRequest } from 'ahooks';
import { Button, ModalManager } from '@repo/ui';
import { financeApi } from '@/api';
import { revalidateFinanceAfterWithdrawAudit } from '@/lib/actions/finance-revalidate';
import {
  User,
  CreditCard,
  ArrowRight,
  Clock,
  Copy,
  Hash,
  AlertCircle,
  Wallet,
  Landmark,
} from 'lucide-react';
import {
  NumHelper,
  TimeHelper,
  WITHDRAW_STATUS,
  WithdrawStatus,
} from '@lucky/shared';
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard';
import { WithdrawOrder } from '@/type/types';

interface Props {
  data: WithdrawOrder;
  confirm: () => void;
}

export const WithdrawAuditModal: React.FC<Props> = ({ data, confirm }) => {
  const [remark, setRemark] = useState('');
  const { copy } = useCopyToClipboard();

  const { runAsync, loading } = useRequest(financeApi.withdrawalsAudit, {
    manual: true,
  });

  const isWaitForAudit = useMemo(() => {
    return data.withdrawStatus === WITHDRAW_STATUS.PENDING_AUDIT;
  }, [data.withdrawStatus]);

  // 1. 提交逻辑
  const submitAudit = async (status: WithdrawStatus) => {
    try {
      await runAsync({ withdrawId: data.withdrawId, status, remark });
      void revalidateFinanceAfterWithdrawAudit();
      confirm();
    } catch (e) {
      // 4xx 由 HTTP 拦截器统一 toast，此处不重复 console.error
      const status = (e as { response?: { status?: number } })?.response
        ?.status;
      if (!status || status < 400 || status >= 500) console.error(e);
    }
  };

  // 2. 带有二次确认的操作处理
  const handleAction = (status: WithdrawStatus) => {
    if (status === WITHDRAW_STATUS.SUCCESS) {
      ModalManager.open({
        title: 'Confirm Payout Approval',
        confirmText: 'Approve',
        cancelText: 'Cancel',
        renderChildren: (
          <div>
            Are you sure you want to approve{' '}
            <span className="font-bold text-primary-600">
              {NumHelper.formatMoney(data.actualAmount)}
            </span>{' '}
            via{' '}
            <span className="font-bold">
              {data.bankName || 'Unknown Channel'}
            </span>
            ?
            <br />
            <span className="text-xs text-gray-500 mt-2 block bg-gray-50 p-2 rounded">
              Beneficiary: {data.accountName} ({data.withdrawAccount})
            </span>
          </div>
        ),
        onConfirm: () => submitAudit(status),
      });
    } else {
      submitAudit(status);
    }
  };

  // 3. 核心优化：智能获取渠道展示信息
  const channelDisplay = useMemo(() => {
    // 优先使用后端返回的具体渠道名 (如 "GCash", "BDO")
    const label = data.bankName || `Method ${data.withdrawMethod}`;

    // 根据类型 (1:钱包, 2:银行) 决定图标和颜色风格
    const isBank =
      data.withdrawMethod === 2 || label.toLowerCase().includes('bank');

    return {
      label,
      icon: isBank ? <Landmark size={14} /> : <Wallet size={14} />,
      colorClass: '',
      borderColor: '',
    };
  }, [data]);

  return (
    <div className="space-y-5">
      {/* Header: ID & Time */}
      <div className="flex justify-between items-center text-xs text-gray-400 border-b border-gray-100 pb-3 dark:border-white/10">
        <div className="flex items-center gap-1 font-mono">
          <Hash size={12} />
          {data.withdrawNo}
          <Copy
            size={12}
            className="cursor-pointer hover:text-primary-500"
            onClick={() => copy(data.withdrawNo, 'Order No')}
          />
        </div>
        <div className="flex items-center gap-1">
          <Clock size={12} />
          {TimeHelper.formatDateTime(data.appliedAt)}
        </div>
      </div>

      {/* Info Cards Grid */}
      <div className="grid grid-cols-2 gap-4">
        {/* Left: User Info */}
        <div className="bg-gray-50 dark:bg-white/5 p-3 rounded-lg space-y-2 border border-transparent">
          <div className="flex items-center gap-2 text-gray-500 uppercase text-[10px] font-bold tracking-wider">
            <User size={12} /> Applicant
          </div>
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-gray-200 flex-shrink-0 flex items-center justify-center font-bold text-sm text-gray-600">
              {data.user?.nickname?.[0]?.toUpperCase() || 'U'}
            </div>
            <div className="overflow-hidden min-w-0">
              <div className="text-sm font-bold truncate text-gray-900 dark:text-gray-100">
                {data.user?.nickname || 'Unknown'}
              </div>
              <div className="text-xs text-gray-500 font-mono">
                {data.user?.phone}
              </div>
            </div>
          </div>
        </div>

        {/* Right: Target Account (Visual Highlight) */}
        <div
          className={`p-3 rounded-lg space-y-2 bg-gray-50 dark:bg-white/5 ${channelDisplay.colorClass.split(' ')[1]} `}
        >
          <div
            className={`flex items-center gap-2 uppercase text-[10px] font-bold tracking-wider ${channelDisplay.colorClass.split(' ')[0]}`}
          >
            <CreditCard size={12} /> Beneficiary
          </div>

          <div className="space-y-1.5">
            {/* Channel Name */}
            <div className="flex justify-between items-center">
              <span className="text-xs text-gray-500/80">Channel</span>
              <div
                className={`flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-bold ${channelDisplay.colorClass}`}
              >
                {channelDisplay.icon}
                {channelDisplay.label}
              </div>
            </div>

            {/* Account Name */}
            <div className="flex justify-between items-center">
              <span className="text-xs text-gray-500/80">Name</span>
              <span className="text-xs font-bold text-gray-900 dark:text-white">
                {data.accountName}
              </span>
            </div>

            {/* Account Number */}
            <div className="pt-2 mt-1 border-t border-gray-200/50 dark:border-white/10 flex justify-between items-center">
              <span className="font-mono font-bold text-sm tracking-wide text-gray-800 dark:text-gray-200">
                {data.withdrawAccount}
              </span>
              <Copy
                size={12}
                className="cursor-pointer text-gray-400 hover:text-primary-500"
                onClick={() => copy(data.withdrawAccount, 'Account No')}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Financial Breakdown */}
      <div className="bg-gradient-to-r from-gray-50 to-white dark:from-white/5 dark:to-transparent border border-gray-200 dark:border-white/10 rounded-xl p-4">
        [Image of audit financial breakdown]
        <div className="flex items-center justify-between">
          <div className="text-left">
            <div className="text-xs text-gray-400 mb-1">Requested</div>
            <div className="text-lg font-bold text-gray-700 dark:text-gray-300">
              {NumHelper.formatMoney(data.withdrawAmount)}
            </div>
          </div>

          <div className="flex flex-col items-center px-2">
            <div className="text-[10px] text-red-500 bg-red-50 dark:bg-red-900/20 px-2 py-0.5 rounded-full mb-1">
              Fee: {NumHelper.formatMoney(data.feeAmount)}
            </div>
            <ArrowRight size={16} className="text-gray-300" />
          </div>

          <div className="text-right">
            <div className="text-xs text-gray-400 mb-1">Actual Payout</div>
            <div className="text-2xl font-black text-primary-600 dark:text-primary-400">
              {NumHelper.formatMoney(data.actualAmount)}
            </div>
          </div>
        </div>
      </div>

      {/* Audit Form Section */}
      <div className="pt-2">
        {isWaitForAudit && (
          <div className="flex items-start gap-2 bg-amber-50 border border-amber-100 text-amber-800 text-xs p-3 rounded-lg mb-4">
            <AlertCircle size={16} className="mt-0.5 shrink-0 text-amber-600" />
            <div>
              <span className="font-bold">Risk Verification Required:</span>
              <ul className="list-disc list-inside mt-1 space-y-0.5 text-amber-700/80">
                <li>
                  Verify beneficiary name matches user KYC (if applicable).
                </li>
                <li>Check for duplicate withdrawals from same IP/Device.</li>
              </ul>
            </div>
          </div>
        )}

        <label className="text-sm font-medium flex justify-between mb-2">
          <span>Audit Remark</span>
          {isWaitForAudit && (
            <span className="text-xs text-gray-400 font-normal">
              Required for Rejection
            </span>
          )}
        </label>

        {isWaitForAudit ? (
          <textarea
            className="w-full border border-gray-200 dark:border-white/20 rounded-lg p-3 text-sm focus:ring-2 focus:ring-primary-500 outline-none bg-transparent transition-all"
            rows={3}
            placeholder="Enter reason for rejection or approval notes..."
            value={remark}
            onChange={(e) => setRemark(e.target.value)}
          />
        ) : (
          <div className="bg-gray-50 dark:bg-white/5 p-3 rounded-lg text-sm border border-gray-100 dark:border-white/5">
            <span className="text-xs text-gray-400 block mb-1">
              Audit Result:
            </span>
            <div className="text-gray-700 dark:text-gray-300">
              {data.auditResult || data.rejectReason || 'No remark recorded.'}
            </div>
          </div>
        )}
      </div>

      {/* Actions */}
      {isWaitForAudit && (
        <div className="flex gap-3 pt-2">
          <Button
            variant="danger"
            className="flex-1"
            disabled={!remark.trim()}
            isLoading={loading}
            onClick={() => handleAction(WITHDRAW_STATUS.REJECTED)}
          >
            Reject
          </Button>
          <Button
            variant="primary"
            className="flex-1"
            isLoading={loading}
            onClick={() => handleAction(WITHDRAW_STATUS.SUCCESS)}
          >
            Approve & Pay
          </Button>
        </div>
      )}
    </div>
  );
};
