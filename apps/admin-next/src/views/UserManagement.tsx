'use client';

import React, { useCallback, useMemo, useRef } from 'react';
import Image from 'next/image';
import { Button, ModalManager, cn } from '@repo/ui';
import {
  ActionType,
  ProColumns,
  SmartTable,
} from '@/components/scaffold/SmartTable';
import { User as UserIcon, Eye, Ban, CheckCircle } from 'lucide-react';
import { FormSchema } from '@/type/search';
import { ClientUserListItem, QueryClientUserParams } from '@/type/types';
import { KYC_STATUS } from '@lucky/shared';
import { Badge, BadgeVariant } from '@repo/ui';
import { clientUserApi } from '@/api';
import { Card } from '@/components/UIComponents';
import { useToastStore } from '@/store/useToastStore';
import { UserDetailModal } from '@/views/user-management/UserDetailModal';
import { useTranslation } from '@/hooks/useTranslation';

export const UserManagement: React.FC = () => {
  const actionRef = useRef<ActionType>(null);
  const addToast = useToastStore((state) => state.addToast);
  const { t } = useTranslation();

  // 1. 查看详情弹窗
  const handleView = useCallback(
    (record: ClientUserListItem) => {
      ModalManager.open({
        title: t('users_modalDetailTitle'),
        size: 'xl',
        renderChildren: ({ close }) => (
          <UserDetailModal
            userId={record.id}
            closeAction={close}
            reloadAction={() => actionRef.current?.reload()}
            tAction={t}
          />
        ),
      });
    },
    [t],
  );

  // 2. 封禁/解禁逻辑（带备注输入）
  const handleStatusChange = useCallback(
    async (record: ClientUserListItem) => {
      const isBanning = record.status === 1; // 1 为活跃，0 为封禁
      const targetStatus = isBanning ? 0 : 1;

      ModalManager.open({
        title: isBanning
          ? t('users_modalFreezeTitle')
          : t('users_modalRestoreTitle'),
        renderChildren: ({ close }) => (
          <div className="p-6 space-y-4">
            <p className="text-sm text-slate-600 dark:text-slate-400">
              {t('users_modalConfirmAction')}
              <span className="font-bold text-slate-900 dark:text-white ml-1 px-2 py-1 bg-slate-100 dark:bg-slate-800 rounded">
                {record.nickname || record.phone}
              </span>
            </p>
            <textarea
              id="op-remark"
              placeholder={t('users_modalRemarkPlaceholder')}
              className="w-full h-24 text-xs border border-slate-200 rounded-xl p-3 outline-none focus:ring-4 focus:ring-red-500/10 transition-all dark:bg-gray-800 dark:border-slate-700"
            />
            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={close} className="font-medium">
                {t('users_modalCancel')}
              </Button>
              <Button
                variant={isBanning ? 'danger' : 'primary'}
                className="font-bold"
                onClick={async () => {
                  const remark = (
                    document.getElementById('op-remark') as HTMLTextAreaElement
                  )?.value;
                  if (isBanning && !remark?.trim()) {
                    addToast('error', t('users_toastRemarkRequired'));
                    return;
                  }
                  try {
                    await clientUserApi.updateUser(record.id, {
                      status: targetStatus,
                      remark:
                        remark?.trim() ||
                        (isBanning
                          ? t('users_remarkBan')
                          : t('users_remarkUnban')),
                    });
                    addToast(
                      'success',
                      isBanning
                        ? t('users_toastFrozenSuccess')
                        : t('users_toastRestoredSuccess'),
                    );
                    actionRef.current?.reload();
                    close();
                  } catch {
                    addToast('error', t('users_toastOperationFailed'));
                  }
                }}
              >
                {isBanning
                  ? t('users_modalConfirmFreeze')
                  : t('users_modalConfirmRestore')}
              </Button>
            </div>
          </div>
        ),
      });
    },
    [addToast, t],
  );

  // KYC 状态映射
  const kycStatusConfig: Record<number, { label: string; color: string }> =
    useMemo(
      () => ({
        [KYC_STATUS.DRAFT]: {
          label: t('users_kycUnverified'),
          color: 'secondary',
        },
        [KYC_STATUS.REVIEWING]: {
          label: t('users_kycReviewing'),
          color: 'primary',
        },
        [KYC_STATUS.APPROVED]: {
          label: t('users_kycVerified'),
          color: 'success',
        },
        [KYC_STATUS.REJECTED]: {
          label: t('users_kycRejected'),
          color: 'danger',
        },
      }),
      [t],
    );

  const columns: ProColumns<ClientUserListItem>[] = useMemo(
    () => [
      {
        title: t('users_columnUserInfo'),
        dataIndex: 'nickname',
        render: (_, row) => {
          const isBanned = row.status === 0;
          return (
            <div className="flex items-center gap-3">
              <div
                className={cn(
                  'h-10 w-10 rounded-full flex items-center justify-center overflow-hidden border shrink-0 transition-all',
                  isBanned
                    ? 'grayscale opacity-60 border-red-300'
                    : 'border-slate-200 bg-slate-100 shadow-sm',
                )}
              >
                {row.avatar ? (
                  <div className="relative h-full w-full">
                    <Image
                      fill
                      src={row.avatar}
                      className="object-cover"
                      alt=""
                      sizes="40px"
                    />
                  </div>
                ) : (
                  <span className="text-slate-400 text-xs font-bold uppercase">
                    {row.nickname?.slice(0, 1) || 'U'}
                  </span>
                )}
              </div>
              <div className="flex flex-col min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span
                    className={cn(
                      'font-bold truncate max-w-[120px] transition-colors',
                      isBanned
                        ? 'text-slate-400'
                        : 'text-slate-900 dark:text-slate-100',
                    )}
                  >
                    {row.nickname || t('users_guest')}
                  </span>
                  {isBanned && (
                    <Badge
                      variant="warning"
                      className="h-4 text-[9px] px-1.5 font-black uppercase tracking-tighter"
                    >
                      {t('users_frozenBadge')}
                    </Badge>
                  )}
                </div>
                <span className="text-[11px] text-slate-500 font-mono tracking-tight">
                  {row.phone}
                </span>
              </div>
            </div>
          );
        },
      },
      {
        title: t('users_columnWalletAssets'),
        dataIndex: 'wallet',
        render: (_, row) => (
          <div className="text-[11px] space-y-0.5 bg-slate-50/50 dark:bg-white/5 p-1.5 rounded-lg border border-slate-100 dark:border-slate-800">
            <div className="flex items-center justify-between gap-4">
              <span className="text-slate-400 font-medium uppercase tracking-tighter scale-90">
                {t('users_walletCash')}
              </span>
              <span className="font-mono font-bold text-emerald-600">
                ${Number(row.wallet?.realBalance || 0).toFixed(2)}
              </span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="text-slate-400 font-medium uppercase tracking-tighter scale-90">
                {t('users_walletCoin')}
              </span>
              <span className="font-mono font-bold text-amber-600">
                {Math.floor(Number(row.wallet?.coinBalance || 0))}
              </span>
            </div>
          </div>
        ),
      },
      {
        title: t('users_columnKycLevel'),
        dataIndex: 'kycStatus',
        render: (_, row) => (
          <div className="flex flex-col gap-1.5 t">
            <Badge
              variant="outline"
              className="w-fit py-0 h-4 text-[9px] border-slate-300 text-red-500 font-bold"
            >
              {t('users_vipLabel', { level: row.vipLevel })}
            </Badge>
            {kycStatusConfig[row.kycStatus] && (
              <Badge
                className="w-fit text-[10px] font-bold py-0 h-5"
                variant={kycStatusConfig[row.kycStatus].color as BadgeVariant}
              >
                {kycStatusConfig[row.kycStatus].label}
              </Badge>
            )}
          </div>
        ),
      },
      {
        title: t('users_columnRegisterTime'),
        dataIndex: 'createdAt',
        valueType: 'dateTime',
        width: 160,
        render: (dom) => (
          <span className="text-[11px] font-medium text-slate-500">{dom}</span>
        ),
      },
      {
        title: t('users_columnAction'),
        valueType: 'option',
        width: 120,
        fixed: 'right',
        render: (_, row) => {
          const isActive = row.status === 1;
          return (
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-8 px-2.5 hover:bg-slate-50 dark:hover:bg-slate-100 font-bold text-xs"
                onClick={() => handleView(row)}
              >
                <Eye size={14} className="mr-1.5" /> {t('users_detailButton')}
              </Button>

              <Button
                variant="outline"
                size="sm"
                title={
                  isActive ? t('users_freezeUser') : t('users_restoreUser')
                }
                className={cn('h-8 w-8 p-0 transition-all shadow-sm')}
                onClick={() => handleStatusChange(row)}
              >
                {isActive ? <Ban size={15} /> : <CheckCircle size={15} />}
              </Button>
            </div>
          );
        },
      },
    ],
    [handleView, handleStatusChange, kycStatusConfig, t],
  );

  const searchSchema: FormSchema[] = useMemo(
    () => [
      {
        type: 'input',
        key: 'userId',
        label: t('users_searchUserId'),
        placeholder: t('users_searchUserIdPlaceholder'),
      },
      {
        type: 'input',
        key: 'phone',
        label: t('users_searchPhone'),
        placeholder: t('users_searchPhonePlaceholder'),
      },
      {
        type: 'select',
        key: 'status',
        label: t('users_searchAccountStatus'),
        options: [
          { label: t('users_searchActive'), value: '1' },
          { label: t('users_searchFrozen'), value: '0' },
        ],
      },
      {
        type: 'select',
        key: 'kycStatus',
        label: t('users_searchKycStatus'),
        options: Object.entries(kycStatusConfig).map(([k, v]) => ({
          label: v.label,
          value: k,
        })),
      },
      {
        type: 'date',
        key: 'dateRange',
        label: t('users_searchRegisterTime'),
        mode: 'range',
      },
    ],
    [kycStatusConfig, t],
  );

  const requestUsers = useCallback(async (params: QueryClientUserParams) => {
    // 适配后端：确保 status 是 number 或 undefined
    const queryParams: QueryClientUserParams = {
      ...params,
      status: params.status !== undefined ? Number(params.status) : undefined,
    };

    if (params.dateRange) {
      queryParams.startTime = params.dateRange.from;
      queryParams.endTime = params.dateRange.to;
      delete queryParams.dateRange;
    }

    const res = await clientUserApi.getUsers(queryParams);

    return {
      data: res.list,
      total: res.total,
      success: true,
    };
  }, []);

  return (
    <Card className="border-none shadow-md overflow-hidden rounded-xl">
      <SmartTable<ClientUserListItem>
        headerTitle={
          <div className="flex items-center gap-3 font-black text-slate-800 dark:text-slate-100 uppercase tracking-tight">
            <div className="p-1.5 bg-blue-500 rounded-lg">
              <UserIcon className="text-white" size={18} strokeWidth={3} />
            </div>
            <span>{t('users_clientDatabase')}</span>
          </div>
        }
        rowKey="id"
        ref={actionRef}
        columns={columns}
        searchSchema={searchSchema}
        request={requestUsers}
      />
    </Card>
  );
};
