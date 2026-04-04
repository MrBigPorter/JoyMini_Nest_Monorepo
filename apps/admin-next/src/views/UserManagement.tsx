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

export const UserManagement: React.FC = () => {
  const actionRef = useRef<ActionType>(null);
  const addToast = useToastStore((state) => state.addToast);

  // 1. 查看详情弹窗
  const handleView = useCallback((record: ClientUserListItem) => {
    ModalManager.open({
      title: 'User Comprehensive Profile',
      size: 'xl',
      renderChildren: ({ close }) => (
        <UserDetailModal
          userId={record.id}
          close={close}
          reload={() => actionRef.current?.reload()}
        />
      ),
    });
  }, []);

  // 2. 封禁/解禁逻辑（带备注输入）
  const handleStatusChange = useCallback(
    async (record: ClientUserListItem) => {
      const isBanning = record.status === 1; // 1 为活跃，0 为封禁
      const targetStatus = isBanning ? 0 : 1;

      ModalManager.open({
        title: isBanning ? 'Freeze User Account' : 'Restore User Account',
        renderChildren: ({ close }) => (
          <div className="p-6 space-y-4">
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Confirm action for:
              <span className="font-bold text-slate-900 dark:text-white ml-1 px-2 py-1 bg-slate-100 dark:bg-slate-800 rounded">
                {record.nickname || record.phone}
              </span>
            </p>
            <textarea
              id="op-remark"
              placeholder="Please enter the reason (Required for freezing)..."
              className="w-full h-24 text-xs border border-slate-200 rounded-xl p-3 outline-none focus:ring-4 focus:ring-red-500/10 transition-all dark:bg-gray-800 dark:border-slate-700"
            />
            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={close} className="font-medium">
                Cancel
              </Button>
              <Button
                variant={isBanning ? 'danger' : 'primary'}
                className="font-bold"
                onClick={async () => {
                  const remark = (
                    document.getElementById('op-remark') as HTMLTextAreaElement
                  )?.value;
                  if (isBanning && !remark?.trim()) {
                    addToast('error', 'Remark is required for freezing');
                    return;
                  }
                  try {
                    await clientUserApi.updateUser(record.id, {
                      status: targetStatus,
                      remark:
                        remark?.trim() ||
                        (isBanning ? 'Admin manual ban' : 'Admin manual unban'),
                    });
                    addToast(
                      'success',
                      `User ${isBanning ? 'frozen' : 'restored'} successfully`,
                    );
                    actionRef.current?.reload();
                    close();
                  } catch (error) {
                    addToast('error', 'Operation failed');
                  }
                }}
              >
                Confirm {isBanning ? 'Freeze' : 'Restore'}
              </Button>
            </div>
          </div>
        ),
      });
    },
    [addToast],
  );

  // KYC 状态映射
  const kycStatusConfig: Record<number, { label: string; color: string }> =
    useMemo(
      () => ({
        [KYC_STATUS.DRAFT]: { label: 'Unverified', color: 'secondary' },
        [KYC_STATUS.REVIEWING]: { label: 'Reviewing', color: 'primary' },
        [KYC_STATUS.APPROVED]: { label: 'Verified', color: 'success' },
        [KYC_STATUS.REJECTED]: { label: 'Rejected', color: 'danger' },
      }),
      [],
    );

  const columns: ProColumns<ClientUserListItem>[] = useMemo(
    () => [
      {
        title: 'User Info',
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
                    {row.nickname || 'Guest'}
                  </span>
                  {isBanned && (
                    <Badge
                      variant="warning"
                      className="h-4 text-[9px] px-1.5 font-black uppercase tracking-tighter"
                    >
                      FROZEN
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
        title: 'Wallet Assets',
        dataIndex: 'wallet',
        render: (_, row) => (
          <div className="text-[11px] space-y-0.5 bg-slate-50/50 dark:bg-white/5 p-1.5 rounded-lg border border-slate-100 dark:border-slate-800">
            <div className="flex items-center justify-between gap-4">
              <span className="text-slate-400 font-medium uppercase tracking-tighter scale-90">
                Cash
              </span>
              <span className="font-mono font-bold text-emerald-600">
                ${Number(row.wallet?.realBalance || 0).toFixed(2)}
              </span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="text-slate-400 font-medium uppercase tracking-tighter scale-90">
                Coin
              </span>
              <span className="font-mono font-bold text-amber-600">
                {Math.floor(Number(row.wallet?.coinBalance || 0))}
              </span>
            </div>
          </div>
        ),
      },
      {
        title: 'KYC & Level',
        dataIndex: 'kycStatus',
        render: (_, row) => (
          <div className="flex flex-col gap-1.5 t">
            <Badge
              variant="outline"
              className="w-fit py-0 h-4 text-[9px] border-slate-300 text-red-500 font-bold"
            >
              VIP {row.vipLevel}
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
        title: 'Register Time',
        dataIndex: 'createdAt',
        valueType: 'dateTime',
        width: 160,
        render: (dom) => (
          <span className="text-[11px] font-medium text-slate-500">{dom}</span>
        ),
      },
      {
        title: 'Action',
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
                <Eye size={14} className="mr-1.5" /> Detail
              </Button>

              <Button
                variant="outline"
                size="sm"
                title={isActive ? 'Freeze User' : 'Restore User'}
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
    [handleView, handleStatusChange, kycStatusConfig],
  );

  const searchSchema: FormSchema[] = useMemo(
    () => [
      {
        type: 'input',
        key: 'userId',
        label: 'User ID',
        placeholder: 'Enter ID',
      },
      {
        type: 'input',
        key: 'phone',
        label: 'Phone',
        placeholder: 'Enter Phone',
      },
      {
        type: 'select',
        key: 'status',
        label: 'Account Status',
        options: [
          { label: 'Active', value: '1' },
          { label: 'Frozen', value: '0' },
        ],
      },
      {
        type: 'select',
        key: 'kycStatus',
        label: 'KYC Status',
        options: Object.entries(kycStatusConfig).map(([k, v]) => ({
          label: v.label,
          value: k,
        })),
      },
      {
        type: 'date',
        key: 'dateRange',
        label: 'Register Time',
        mode: 'range',
      },
    ],
    [kycStatusConfig],
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
            <span>Client Database</span>
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
