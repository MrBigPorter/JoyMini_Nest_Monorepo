'use client';

import React, { useMemo, useCallback, useEffect } from 'react';
import { useAntdTable, useRequest } from 'ahooks';
import { createColumnHelper, ColumnDef } from '@tanstack/react-table';
import { Edit3, Trash2, Calendar, Hash } from 'lucide-react';

import { Button, ModalManager } from '@repo/ui';
import { Badge, Card } from '@/components/UIComponents';
import { useToastStore } from '@/store/useToastStore';
import { SchemaSearchForm } from '@/components/scaffold/SchemaSearchForm';
import { BaseTable } from '@/components/scaffold/BaseTable';
import { PageHeader } from '@/components/scaffold/PageHeader';

// 引入你之前定义的常量和 Modal
import {
  CouponModal, // 假设这是你上一段代码里的 Modal 组件
} from './CouponModal'; // 请确保路径正确

import {
  CalcHelper,
  COUPON_STATUS,
  COUPON_TYPE_OPTIONS,
  DISCOUNT_TYPE,
  ISSUE_TYPE,
  NumHelper,
  TimeHelper,
  VALID_TYPE,
} from '@lucky/shared';
import { Coupon, CouponListParams } from '@/type/types';
import { couponApi } from '@/api';

// 搜索表单类型定义
type CouponSearchForm = {
  keyword: string;
  status: string; // 'ALL' | '1' | '0'
  couponType: string;
};

// --- Helper Components ---

const StatusBadge: React.FC<{ status: number }> = ({ status }) => (
  <Badge color={status === 1 ? 'green' : 'gray'}>
    {status === 1 ? `Active` : 'Disabled'}
  </Badge>
);

interface CouponListProps {
  initialFormParams?: Record<string, unknown>;
  onParamsChange?: (params: Record<string, unknown>) => void;
}

export const CouponList: React.FC<CouponListProps> = ({
  initialFormParams,
  onParamsChange,
}) => {
  const addToast = useToastStore((s) => s.addToast);

  // 1. 数据获取逻辑 (useAntdTable)
  const getTableData = async (
    { current, pageSize }: { current: number; pageSize: number },
    formData: CouponSearchForm,
  ) => {
    // 组装 API 参数
    const params: CouponListParams = {
      page: current,
      pageSize,
    };

    if (formData?.keyword?.trim()) {
      params.keyword = formData.keyword.trim();
    }
    if (formData?.status && formData.status !== 'ALL') {
      params.status = Number(formData.status);
    }
    if (formData?.couponType && formData.couponType !== 'ALL') {
      params.couponType = Number(formData.couponType);
    }

    const res = await couponApi.getList(params);
    return { list: res.list, total: res.total };
  };

  const {
    tableProps,
    refresh,
    run,
    search: { reset },
  } = useAntdTable(getTableData, {
    manual: true,
    defaultPageSize: 10,
    defaultParams: [
      { current: 1, pageSize: 10 },
      {
        keyword: (initialFormParams?.keyword as string) || '',
        status: (initialFormParams?.status as string) || 'ALL',
        couponType: (initialFormParams?.couponType as string) || 'ALL',
      },
    ],
  });

  // 搜索处理
  const handleSearch = (values: CouponSearchForm) => {
    run({ current: 1, pageSize: 10 }, values);
    onParamsChange?.(values);
  };

  const handleReset = () => {
    reset();
    onParamsChange?.({ keyword: '', status: 'ALL', couponType: 'ALL' });
  };

  const dataSource = useMemo(
    () => tableProps.dataSource || [],
    [tableProps.dataSource],
  );

  // 2. 操作逻辑 (Delete / Create / Edit)
  const { run: deleteCoupon } = useRequest(couponApi.delete, {
    manual: true,
    onSuccess: () => {
      addToast('success', 'Coupon deleted');
      refresh();
    },
  });

  const handleOpenModal = useCallback(
    (record?: Coupon) => {
      ModalManager.open({
        title: record ? 'Edit Coupon' : 'Create Coupon',
        // 这里的 CreateCouponModal 就是你上一段代码里的组件
        renderChildren: ({ close, confirm }) => (
          <CouponModal
            editingData={record}
            close={close}
            confirm={() => {
              confirm(); // 关闭弹窗
              refresh(); // 刷新表格
              addToast(
                'success',
                record ? 'Updated successfully' : 'Created successfully',
              );
            }}
          />
        ),
      });
    },
    [refresh, addToast],
  );

  const handleDelete = useCallback(
    (record: Coupon) => {
      ModalManager.open({
        title: 'Delete Coupon?',
        content: `Are you sure you want to delete "${record.couponName}"?`,
        confirmText: 'Delete',
        onConfirm: () => deleteCoupon(record.id),
      });
    },
    [deleteCoupon],
  );

  useEffect(() => {
    run(
      { current: 1, pageSize: 10 },
      {
        keyword: (initialFormParams?.keyword as string) || '',
        status: (initialFormParams?.status as string) || 'ALL',
        couponType: (initialFormParams?.couponType as string) || 'ALL',
      },
    );
  }, [run, initialFormParams]);

  const columns = useMemo(() => {
    const columnHelper = createColumnHelper<Coupon>();
    return [
      columnHelper.accessor('couponName', {
        header: 'Coupon Info',
        cell: (info) => (
          <div>
            <div className="flex items-center gap-2">
              <span className="font-medium text-gray-900 dark:text-white">
                {info.getValue()}
              </span>
              {info.row.original.couponCode && (
                <span className="inline-flex items-center rounded-md bg-gray-100 px-1.5 py-0.5 text-xs font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                  <Hash size={10} className="mr-0.5" />
                  {info.row.original.couponCode}
                </span>
              )}
            </div>
            <div className="mt-1 flex gap-2">
              <StatusBadge status={info.row.original.status} />
              <Badge color="blue">
                {info.row.original.issueType === ISSUE_TYPE.CLAIM
                  ? 'Claim'
                  : 'System'}
              </Badge>
            </div>
          </div>
        ),
      }),
      columnHelper.accessor('discountValue', {
        header: 'Benefit',
        cell: (info) => {
          const { discountType, minPurchase } = info.row.original;
          const isPercent = discountType === DISCOUNT_TYPE.PERCENTAGE;
          const valueStr = isPercent
            ? `${NumHelper.formatRate(info.getValue())}OFF`
            : `-${NumHelper.formatMoney(info.getValue())}`;

          return (
            <div className="flex flex-col">
              <span className="font-semibold text-pink-600">{valueStr}</span>
              <span className="text-xs text-gray-500">
                Min: {NumHelper.formatMoney(minPurchase)}
              </span>
            </div>
          );
        },
      }),
      columnHelper.display({
        id: 'usage',
        header: 'Usage',
        cell: (info) => {
          const { issuedQuantity = 0, totalQuantity } = info.row.original;
          const isUnlimited = totalQuantity === -1;

          let percent = 0;
          if (!isUnlimited && totalQuantity > 0) {
            const ratio = CalcHelper.div(issuedQuantity, totalQuantity);
            const rawPercent = CalcHelper.mul(ratio, 100);
            percent = CalcHelper.round(rawPercent, 0);
            if (percent > 100) {
              percent = 100;
            }
          }
          return (
            <div className="w-24">
              <div className="flex justify-between text-xs mb-1">
                <span className="text-gray-500">Used</span>
                <span className="font-medium">
                  {isUnlimited ? 'Unlimited' : `${percent}%`}
                </span>
              </div>
              <div className="h-1.5 w-full bg-gray-100 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-300 ${
                    isUnlimited ? 'bg-green-500' : 'bg-blue-500'
                  }`}
                  style={{
                    width: isUnlimited ? '100%' : `${percent}%`,
                  }}
                />
              </div>
              <div className="text-[10px] text-gray-400 mt-1">
                {NumHelper.formatNumber(issuedQuantity)} /{' '}
                {isUnlimited ? '∞' : NumHelper.formatNumber(totalQuantity)}
              </div>
            </div>
          );
        },
      }),
      columnHelper.accessor('validType', {
        header: 'Validity',
        cell: (info) => {
          const row = info.row.original;
          if (row.validType === VALID_TYPE.RANGE) {
            return (
              <div className="text-xs text-gray-600">
                <div className="flex items-center gap-1">
                  <Calendar size={12} className="text-gray-400" />
                  {TimeHelper.formatDate(row.validStartAt)}
                </div>
                <div className="pl-4 text-gray-400">
                  to {TimeHelper.formatDate(row.validEndAt)}
                </div>
              </div>
            );
          }
          return (
            <div className="text-xs flex items-center gap-1 text-orange-600">
              <Calendar size={12} />
              {row.validDays} days after claim
            </div>
          );
        },
      }),
      columnHelper.display({
        id: 'actions',
        header: 'Actions',
        cell: (info) => (
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => handleOpenModal(info.row.original)}
            >
              <Edit3 size={14} />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => handleDelete(info.row.original)}
            >
              <Trash2 size={14} />
            </Button>
          </div>
        ),
      }),
    ] as ColumnDef<Coupon>[];
  }, [handleDelete, handleOpenModal]);

  return (
    <div className="space-y-6">
      {/* 1. Page Header */}
      <PageHeader
        title="Coupon Management"
        description="Create and manage discount coupons for your customers."
        buttonText="Create Coupon"
        buttonOnClick={() => handleOpenModal()}
      />

      <Card>
        {/* 2. Search Form */}
        <div className="space-y-3 mb-6">
          <SchemaSearchForm<CouponSearchForm>
            schema={[
              {
                type: 'input',
                key: 'keyword',
                label: 'Search',
                placeholder: 'Coupon name or code...',
              },
              {
                type: 'select',
                key: 'status',
                label: 'Status',
                defaultValue: 'ALL',
                options: [{ label: 'All Status', value: 'ALL' }].concat(
                  Object.entries(COUPON_STATUS).map(([key, val]) => ({
                    label: key.charAt(0) + key.slice(1).toLowerCase(),
                    value: val.toString(),
                  })),
                ),
              },
              {
                type: 'select',
                key: 'couponType',
                label: 'Type',
                defaultValue: 'ALL',
                options: [{ label: 'All Types', value: 'ALL' }].concat(
                  COUPON_TYPE_OPTIONS.map((option) => ({
                    label: option.label,
                    value: option.value.toString(),
                  })),
                ),
              },
            ]}
            initialValues={{
              keyword: (initialFormParams?.keyword as string) || '',
              status: (initialFormParams?.status as string) || 'ALL',
              couponType: (initialFormParams?.couponType as string) || 'ALL',
            }}
            onSearch={handleSearch}
            onReset={handleReset}
          />
        </div>

        {/* 3. Data Table */}
        <BaseTable
          data={dataSource}
          rowKey="id"
          columns={columns}
          loading={tableProps.loading}
          pagination={{
            ...tableProps.pagination,
            onChange: (page, pageSize) => {
              tableProps.onChange?.({
                current: page,
                pageSize: pageSize || 10,
              });
            },
          }}
        />
      </Card>
    </div>
  );
};
