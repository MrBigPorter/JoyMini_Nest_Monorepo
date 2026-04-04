'use client';

import React, { useCallback, useMemo, useRef } from 'react';
import { Button, ModalManager } from '@repo/ui';
import {
  ActionType,
  ProColumns,
  SmartTable,
} from '@/components/scaffold/SmartTable';
import { KycAuditModal } from '@/views/kyc/KycAuditModal';
import { KycFormModal } from '@/views/kyc/KycFormModal'; // 👈 引入新组件
import { Eye, Shield, Edit2, Trash2, Ban, MoreHorizontal } from 'lucide-react';
import { FormSchema } from '@/type/search';
import { KycRecord, KycRecordListParams } from '@/type/types';
import { KYC_STATUS, KycIdCardType, KycIdCardTypeLabel } from '@lucky/shared';
import { Badge, BadgeVariant } from '@repo/ui';
import { kycApi } from '@/api';
import { Card } from '@/components/UIComponents';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@repo/ui';
import { useToastStore } from '@/store/useToastStore';
import { PageHeader } from '@/components/scaffold/PageHeader';
import {
  buildKycListParams,
  kycListQueryKey,
  parseKycSearchParams,
} from '@/lib/cache/kyc-cache';

interface KycListProps {
  // Phase 3: URL searchParams 驱动 filter
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  initialFormParams?: Record<string, any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onParamsChange?: (params: Record<string, any>) => void;
}

export const KycList: React.FC<KycListProps> = ({
  initialFormParams,
  onParamsChange,
}) => {
  const actionRef = useRef<ActionType>(null);
  const addToast = useToastStore((state) => state.addToast);
  const getErrorMessage = useCallback(
    (error: unknown, fallback: string) =>
      error instanceof Error ? error.message : fallback,
    [],
  );

  const normalizedInitialFormParams = useMemo(() => {
    const input = initialFormParams ?? {};
    return parseKycSearchParams({
      page: typeof input.page === 'string' ? input.page : undefined,
      pageSize: typeof input.pageSize === 'string' ? input.pageSize : undefined,
      userId: typeof input.userId === 'string' ? input.userId : undefined,
      kycStatus:
        typeof input.kycStatus === 'string' ? input.kycStatus : undefined,
      startDate:
        typeof input.startDate === 'string' ? input.startDate : undefined,
      endDate: typeof input.endDate === 'string' ? input.endDate : undefined,
    });
  }, [initialFormParams]);

  const hydrationQueryKey = useMemo(
    () => kycListQueryKey(normalizedInitialFormParams),
    [normalizedInitialFormParams],
  );

  // --- Actions ---

  // 1. 打开审核/查看详情弹窗
  const handleView = useCallback((record: KycRecord) => {
    ModalManager.open({
      title: 'KYC Audit Detail',
      size: 'xl',
      renderChildren: ({ close }) => (
        <KycAuditModal
          data={record}
          close={close}
          reload={() => actionRef.current?.reload()}
        />
      ),
    });
  }, []);

  // 2. 打开 [创建] 弹窗
  const handleCreate = useCallback(() => {
    ModalManager.open({
      title: 'Manual Create KYC', // ModalManager 可能会覆盖 KycFormModal 内部的 title，这没关系
      renderChildren: ({ close }) => (
        <KycFormModal
          mode="create"
          close={close}
          reload={() => actionRef.current?.reload()}
        />
      ),
    });
  }, []);

  // 3. 打开 [编辑] 弹窗
  const handleEdit = useCallback((record: KycRecord) => {
    ModalManager.open({
      title: 'Edit KYC Info',
      renderChildren: ({ close }) => (
        <KycFormModal
          mode="edit"
          initialData={record}
          close={close}
          reload={() => actionRef.current?.reload()}
        />
      ),
    });
  }, []);

  // 4. 执行 [撤销]
  const handleRevoke = useCallback(
    async (record: KycRecord) => {
      // 简单起见使用 prompt，建议换成 ModalManager.confirm 配合 input
      const reason = window.prompt(
        `Revoke KYC for ${record.realName}?\nEnter reason:`,
      );
      if (reason === null) return; // Cancelled
      if (!reason.trim()) return addToast('error', 'Reason is required');

      try {
        await kycApi.revoke(record.userId, reason);
        addToast('success', 'KYC revoked successfully');
        actionRef.current?.reload();
      } catch (error: unknown) {
        addToast('error', getErrorMessage(error, 'Revoke failed'));
      }
    },
    [addToast, getErrorMessage],
  );

  // 5. 执行 [删除]
  const handleDelete = useCallback(
    (record: KycRecord) => {
      ModalManager.open({
        title: 'Delete KYC Record',
        content: `Physically delete record for ${record.userId}? This cannot be undone.`,
        confirmText: 'Delete',
        onConfirm: async () => {
          try {
            await kycApi.delete(record.userId);
            addToast('success', 'Record deleted successfully');
            actionRef.current?.reload();
          } catch (error: unknown) {
            addToast('error', getErrorMessage(error, 'Delete failed'));
          }
        },
      });
    },
    [addToast, getErrorMessage],
  );

  // --- Configs ---
  const statusConfig = useMemo(
    () => ({
      [KYC_STATUS.DRAFT]: { label: 'Draft', color: 'secondary' },
      [KYC_STATUS.REVIEWING]: { label: 'Reviewing', color: 'primary' },
      [KYC_STATUS.APPROVED]: { label: 'Approved', color: 'success' },
      [KYC_STATUS.REJECTED]: { label: 'Rejected', color: 'danger' },
      [KYC_STATUS.NEED_MORE]: { label: 'Need More', color: 'warning' },
      [KYC_STATUS.AUTO_REJECTED]: { label: 'Auto Rejected', color: 'danger' },
    }),
    [],
  );

  const columns: ProColumns<KycRecord>[] = useMemo(
    () => [
      {
        title: 'User',
        dataIndex: 'userId',
        render: (_, row) => (
          <div>
            <div className="font-medium text-gray-900 dark:text-white">
              {row.user?.nickname || 'Unknown'}
            </div>
            <div className="text-xs text-gray-500 font-mono">
              {row.user?.phone}
            </div>
          </div>
        ),
      },
      {
        title: 'Real Name / ID',
        dataIndex: 'realName',
        render: (_, row) => (
          <div>
            <div className="font-bold">{row.realName}</div>
            <div className="text-xs text-gray-500 font-mono bg-gray-100 dark:bg-white/10 px-1 rounded inline-block">
              {row.idNumber}
            </div>
          </div>
        ),
      },
      {
        title: 'ID Type',
        dataIndex: 'idType',
        render: (_, row) => {
          return KycIdCardTypeLabel[row?.idType as KycIdCardType] || 'Unknown';
        },
      },
      {
        title: 'Status',
        dataIndex: 'kycStatus',
        valueType: 'select',
        valueEnum: {
          0: { text: 'Draft', status: 'default' },
          1: { text: 'Reviewing', status: 'destructive' },
          2: { text: 'Rejected', status: 'success' },
          3: { text: 'Need More', status: 'warning' },
          4: { text: 'Approved', status: 'success' },
          5: { text: 'Auto Rejected', status: 'info' },
        },
        render: (_, row) => {
          const conf = statusConfig[row.kycStatus];
          return (
            <Badge variant={conf?.color as BadgeVariant}>{conf?.label}</Badge>
          );
        },
      },
      {
        title: 'Submitted At',
        dataIndex: 'submittedAt',
        valueType: 'dateTime',
      },
      {
        title: 'Action',
        valueType: 'option',
        width: 140, // 稍微宽一点
        fixed: 'right',
        render: (_, row) => (
          <div className="flex items-center gap-2">
            {/* 1. 主要按钮：Audit 或 View */}
            <Button
              variant={
                row.kycStatus === KYC_STATUS.REVIEWING ? 'primary' : 'outline'
              }
              size="sm"
              onClick={() => handleView(row)}
            >
              {row.kycStatus === KYC_STATUS.REVIEWING ? (
                <>
                  <Shield size={14} className="mr-1" /> Audit
                </>
              ) : (
                <>
                  <Eye size={14} className="mr-1" /> View
                </>
              )}
            </Button>

            {/* 2. 更多操作下拉菜单 (Dropdown) */}
            {/* 如果你的项目没有 DropdownMenu 组件，可以暂时只显示 View 按钮，或者把 Delete 按钮直接放出来 */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                  <MoreHorizontal size={16} />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>Actions</DropdownMenuLabel>

                {/* Edit: 任何状态都能修数据 */}
                <DropdownMenuItem onClick={() => handleEdit(row)}>
                  <Edit2 size={14} className="mr-2" /> Edit Info
                </DropdownMenuItem>

                {/* Revoke: 只有 Approved 状态能撤销 */}
                {row.kycStatus === KYC_STATUS.APPROVED && (
                  <DropdownMenuItem
                    onClick={() => handleRevoke(row)}
                    className="text-amber-600 focus:text-amber-600"
                  >
                    <Ban size={14} className="mr-2" /> Revoke
                  </DropdownMenuItem>
                )}

                <DropdownMenuSeparator />

                {/* Delete: 危险操作 */}
                <DropdownMenuItem
                  onClick={() => handleDelete(row)}
                  className="text-red-600 focus:text-red-600"
                >
                  <Trash2 size={14} className="mr-2" /> Delete Record
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ),
      },
    ],
    [handleView, handleEdit, handleRevoke, handleDelete, statusConfig],
  );

  const searchSchema: FormSchema[] = useMemo(
    () => [
      {
        type: 'input',
        key: 'userId',
        label: 'User ID',
        placeholder: 'Search User ID',
      },
      {
        type: 'select',
        key: 'kycStatus',
        label: 'Status',
        options: Object.entries(statusConfig).map(([k, v]) => ({
          label: v.label,
          value: k,
        })),
      },
      {
        type: 'date',
        key: 'dateRange',
        label: 'Submit Date',
        mode: 'range',
      },
    ],
    [statusConfig],
  );

  const requestKyc = useCallback(async (params: KycRecordListParams) => {
    const input = params as unknown as Record<string, unknown>;
    const dateRange = input.dateRange as
      | { from?: string; to?: string }
      | undefined;

    const queryInput = parseKycSearchParams({
      page: String(params.page ?? 1),
      pageSize: String(params.pageSize ?? 10),
      userId: typeof input.userId === 'string' ? input.userId : undefined,
      kycStatus:
        typeof input.kycStatus === 'string' ||
        typeof input.kycStatus === 'number'
          ? String(input.kycStatus)
          : undefined,
      startDate:
        typeof input.startDate === 'string' ? input.startDate : dateRange?.from,
      endDate:
        typeof input.endDate === 'string' ? input.endDate : dateRange?.to,
    });

    const res = await kycApi.getRecords(
      buildKycListParams(queryInput) as KycRecordListParams,
    );
    return {
      data: res.list,
      total: res.total,
      success: true,
    };
  }, []);

  return (
    <div>
      {/* 顶部操作按钮 */}
      <PageHeader
        title="KYC Applications"
        description="Manage and audit KYC applications from users."
        buttonText="Manual Create KYC"
        buttonOnClick={handleCreate}
      />
      <Card>
        <div className="p-4">
          <SmartTable<KycRecord>
            headerTitle={
              <div className="flex items-center gap-2">
                <Shield className="text-primary-600" size={20} />
                <span>KYC Applications</span>
              </div>
            }
            rowKey="id"
            ref={actionRef}
            columns={columns}
            searchSchema={searchSchema}
            request={requestKyc}
            initialFormParams={normalizedInitialFormParams}
            onParamsChange={onParamsChange}
            enableHydration={true}
            hydrationQueryKey={hydrationQueryKey}
          />
        </div>
      </Card>
    </div>
  );
};
