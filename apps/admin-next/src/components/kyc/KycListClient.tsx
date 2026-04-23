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
import { useTranslation } from '@/hooks/useTranslation';
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
  const { t } = useTranslation();
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
      title: t('kyc_modalAuditDetail'),
      size: 'xl',
      renderChildren: ({ close }) => (
        <KycAuditModal
          data={record}
          close={close}
          reload={() => actionRef.current?.reload()}
          t={t}
        />
      ),
    });
  }, []);

  // 2. 打开 [创建] 弹窗
  const handleCreate = useCallback(() => {
    ModalManager.open({
      title: t('kyc_modalCreateKyc'), // ModalManager 可能会覆盖 KycFormModal 内部的 title，这没关系
      renderChildren: ({ close }) => (
        <KycFormModal
          mode="create"
          close={close}
          reload={() => actionRef.current?.reload()}
          t={t}
        />
      ),
    });
  }, []);

  // 3. 打开 [编辑] 弹窗
  const handleEdit = useCallback((record: KycRecord) => {
    ModalManager.open({
      title: t('kyc_modalEditKyc'),
      renderChildren: ({ close }) => (
        <KycFormModal
          mode="edit"
          initialData={record}
          close={close}
          reload={() => actionRef.current?.reload()}
          t={t}
        />
      ),
    });
  }, []);

  // 4. 执行 [撤销]
  const handleRevoke = useCallback(
    async (record: KycRecord) => {
      // 简单起见使用 prompt，建议换成 ModalManager.confirm 配合 input
      const reason = window.prompt(
        `${t('kyc_revokePrompt')} ${record.realName}?\n${t('kyc_enterReason')}:`,
      );
      if (reason === null) return; // Cancelled
      if (!reason.trim()) return addToast('error', t('kyc_reasonRequired'));

      try {
        await kycApi.revoke(record.userId, reason);
        addToast('success', t('kyc_revokedSuccess'));
        actionRef.current?.reload();
      } catch (error: unknown) {
        addToast('error', getErrorMessage(error, t('kyc_revokeFailed')));
      }
    },
    [addToast, getErrorMessage, t],
  );

  // 5. 执行 [删除]
  const handleDelete = useCallback(
    (record: KycRecord) => {
      ModalManager.open({
        title: t('kyc_deleteRecord'),
        content: `${t('kyc_deleteConfirm')} ${record.userId}? ${t('kyc_deleteWarning')}`,
        confirmText: t('kyc_delete'),
        onConfirm: async () => {
          try {
            await kycApi.delete(record.userId);
            addToast('success', t('kyc_deletedSuccess'));
            actionRef.current?.reload();
          } catch (error: unknown) {
            addToast('error', getErrorMessage(error, t('kyc_deleteFailed')));
          }
        },
      });
    },
    [addToast, getErrorMessage, t],
  );

  // --- Configs ---
  const statusConfig = useMemo(
    () => ({
      [KYC_STATUS.DRAFT]: { label: t('kyc_statusDraft'), color: 'secondary' },
      [KYC_STATUS.REVIEWING]: {
        label: t('kyc_statusReviewing'),
        color: 'primary',
      },
      [KYC_STATUS.APPROVED]: {
        label: t('kyc_statusApproved'),
        color: 'success',
      },
      [KYC_STATUS.REJECTED]: {
        label: t('kyc_statusRejected'),
        color: 'danger',
      },
      [KYC_STATUS.NEED_MORE]: {
        label: t('kyc_statusNeedMore'),
        color: 'warning',
      },
      [KYC_STATUS.AUTO_REJECTED]: {
        label: t('kyc_statusAutoRejected'),
        color: 'danger',
      },
    }),
    [t],
  );

  const columns: ProColumns<KycRecord>[] = useMemo(
    () => [
      {
        title: t('kyc_columnUser'),
        dataIndex: 'userId',
        render: (_, row) => (
          <div>
            <div className="font-medium text-gray-900 dark:text-white">
              {row.user?.nickname || t('kyc_unknown')}
            </div>
            <div className="text-xs text-gray-500 font-mono">
              {row.user?.phone}
            </div>
          </div>
        ),
      },
      {
        title: t('kyc_columnRealName'),
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
        title: t('kyc_columnIdType'),
        dataIndex: 'idType',
        render: (_, row) => {
          const idType = row?.idType as KycIdCardType;
          const key = `kyc_idType_${KycIdCardType[idType]?.toLowerCase()}`;
          const translated = t(key);
          // If translation key not found (returns the key itself), fall back to KycIdCardTypeLabel
          return translated !== key
            ? translated
            : KycIdCardTypeLabel[idType] || t('kyc_unknown');
        },
      },
      {
        title: t('kyc_columnStatus'),
        dataIndex: 'kycStatus',
        valueType: 'select',
        valueEnum: {
          0: { text: t('kyc_statusDraft'), status: 'default' },
          1: { text: t('kyc_statusReviewing'), status: 'destructive' },
          2: { text: t('kyc_statusRejected'), status: 'success' },
          3: { text: t('kyc_statusNeedMore'), status: 'warning' },
          4: { text: t('kyc_statusApproved'), status: 'success' },
          5: { text: t('kyc_statusAutoRejected'), status: 'info' },
        },
        render: (_, row) => {
          const conf = statusConfig[row.kycStatus];
          return (
            <Badge variant={conf?.color as BadgeVariant}>{conf?.label}</Badge>
          );
        },
      },
      {
        title: t('kyc_columnSubmittedAt'),
        dataIndex: 'submittedAt',
        valueType: 'dateTime',
      },
      {
        title: t('kyc_columnAction'),
        valueType: 'option',
        width: 140,
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
                  <Shield size={14} className="mr-1" /> {t('kyc_btnAudit')}
                </>
              ) : (
                <>
                  <Eye size={14} className="mr-1" /> {t('kyc_btnView')}
                </>
              )}
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                  <MoreHorizontal size={16} />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>{t('kyc_actions')}</DropdownMenuLabel>

                <DropdownMenuItem onClick={() => handleEdit(row)}>
                  <Edit2 size={14} className="mr-2" /> {t('kyc_btnEditInfo')}
                </DropdownMenuItem>

                {row.kycStatus === KYC_STATUS.APPROVED && (
                  <DropdownMenuItem
                    onClick={() => handleRevoke(row)}
                    className="text-amber-600 focus:text-amber-600"
                  >
                    <Ban size={14} className="mr-2" /> {t('kyc_btnRevoke')}
                  </DropdownMenuItem>
                )}

                <DropdownMenuSeparator />

                <DropdownMenuItem
                  onClick={() => handleDelete(row)}
                  className="text-red-600 focus:text-red-600"
                >
                  <Trash2 size={14} className="mr-2" />{' '}
                  {t('kyc_btnDeleteRecord')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ),
      },
    ],
    [handleView, handleEdit, handleRevoke, handleDelete, statusConfig, t],
  );

  const searchSchema: FormSchema[] = useMemo(
    () => [
      {
        type: 'input',
        key: 'userId',
        label: t('kyc_searchUserId'),
        placeholder: t('kyc_searchUserIdPlaceholder'),
      },
      {
        type: 'select',
        key: 'kycStatus',
        label: t('kyc_searchStatus'),
        options: Object.entries(statusConfig).map(([k, v]) => ({
          label: v.label,
          value: k,
        })),
      },
      {
        type: 'date',
        key: 'dateRange',
        label: t('kyc_searchSubmitDate'),
        mode: 'range',
      },
    ],
    [statusConfig, t],
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
        title={t('kyc_pageTitle')}
        description={t('kyc_pageDescription')}
        buttonText={t('kyc_modalCreateKyc')}
        buttonOnClick={handleCreate}
      />
      <Card>
        <div className="p-4">
          <SmartTable<KycRecord>
            headerTitle={
              <div className="flex items-center gap-2">
                <Shield className="text-primary-600" size={20} />
                <span>{t('kyc_pageTitle')}</span>
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
