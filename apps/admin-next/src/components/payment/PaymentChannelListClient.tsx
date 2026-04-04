'use client';

import React, { useCallback, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, ModalManager, cn } from '@repo/ui';
import { createColumnHelper, ColumnDef } from '@tanstack/react-table';
import { Edit, CreditCard, ArrowRightLeft, Power } from 'lucide-react';
import { FormSchema } from '@/type/search';
import { PaymentChannel, PaymentChannelListParams } from '@/type/types';
import { Card } from '@/components/UIComponents';
import { useToastStore } from '@/store/useToastStore';
import { paymentChannelApi } from '@/api';
import { PageHeader } from '@/components/scaffold/PageHeader';
import { PaymentChannelModal } from '@/views/payment-channel/PaymentChannelModal';
import { SchemaSearchForm } from '@/components/scaffold/SchemaSearchForm';
import { BaseTable } from '@/components/scaffold/BaseTable';
import { SmartImage } from '@/components/ui/SmartImage';
import {
  paymentChannelsListQueryKey,
  buildPaymentChannelsListParams,
  parsePaymentChannelsSearchParams,
} from '@/lib/cache/payment-channels-cache';

// --- 辅助组件：状态标签 ---
const StatusBadge = ({ status }: { status: number }) => {
  const config = useMemo(() => {
    switch (status) {
      case 1:
        return {
          label: 'Active',
          className: 'bg-green-100 text-green-700 border-green-200',
        };
      case 2:
        return {
          label: 'Maintenance',
          className: 'bg-amber-100 text-amber-700 border-amber-200',
        };
      case 0:
      default:
        return {
          label: 'Disabled',
          className: 'bg-gray-100 text-gray-500 border-gray-200',
        };
    }
  }, [status]);

  return (
    <span
      className={cn(
        'px-2 py-0.5 rounded text-[11px] font-bold uppercase border tracking-wide',
        config.className,
      )}
    >
      {config.label}
    </span>
  );
};

// --- 辅助组件：类型标签 ---
const TypeBadge = ({ type }: { type: number }) => {
  const isRecharge = type === 1;
  return (
    <div
      className={cn(
        'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold border transition-colors',
        isRecharge
          ? 'bg-blue-50 text-blue-700 border-blue-200'
          : 'bg-orange-50 text-orange-700 border-orange-200',
      )}
    >
      {isRecharge ? <CreditCard size={12} /> : <ArrowRightLeft size={12} />}
      {isRecharge ? 'Money In' : 'Money Out'}
    </div>
  );
};

interface PaymentChannelListProps {
  initialFormParams?: Record<string, unknown>;
  onParamsChange?: (params: Record<string, unknown>) => void;
}

type PaymentChannelSearchForm = {
  name: string;
  type: string;
  status: string;
};

// --- 主组件 ---
export const PaymentChannelList: React.FC<PaymentChannelListProps> = ({
  initialFormParams,
  onParamsChange,
}) => {
  const addToast = useToastStore((s) => s.addToast);

  const normalizedInitialQuery = useMemo(() => {
    const input = initialFormParams ?? {};
    return parsePaymentChannelsSearchParams({
      page: typeof input.page === 'string' ? input.page : undefined,
      pageSize: typeof input.pageSize === 'string' ? input.pageSize : undefined,
      name: typeof input.name === 'string' ? input.name : undefined,
      type: typeof input.type === 'string' ? input.type : undefined,
      status: typeof input.status === 'string' ? input.status : undefined,
    });
  }, [initialFormParams]);

  const [pagination, setPagination] = useState({
    page: normalizedInitialQuery.page,
    pageSize: normalizedInitialQuery.pageSize,
  });
  const [filters, setFilters] = useState<PaymentChannelSearchForm>({
    name: normalizedInitialQuery.name ?? '',
    type:
      normalizedInitialQuery.type !== undefined
        ? String(normalizedInitialQuery.type)
        : 'ALL',
    status:
      normalizedInitialQuery.status !== undefined
        ? String(normalizedInitialQuery.status)
        : 'ALL',
  });

  const channelsQueryInput = useMemo(() => {
    const searchParams: Record<string, string | undefined> = {
      page: String(pagination.page),
      pageSize: String(pagination.pageSize),
      ...(filters.name && filters.name !== '' ? { name: filters.name } : {}),
      ...(filters.type && filters.type !== 'ALL' ? { type: filters.type } : {}),
      ...(filters.status && filters.status !== 'ALL'
        ? { status: filters.status }
        : {}),
    };
    return parsePaymentChannelsSearchParams(searchParams);
  }, [
    filters.name,
    filters.type,
    filters.status,
    pagination.page,
    pagination.pageSize,
  ]);

  const {
    data: channelsData,
    isFetching: channelsLoading,
    refetch: refresh,
  } = useQuery({
    queryKey: paymentChannelsListQueryKey(channelsQueryInput),
    queryFn: () =>
      paymentChannelApi.getList(
        buildPaymentChannelsListParams(
          channelsQueryInput,
        ) as PaymentChannelListParams,
      ),
    staleTime: 30_000,
  });

  const handleSearch = (values: PaymentChannelSearchForm) => {
    setFilters(values);
    setPagination((prev) => ({ ...prev, page: 1 }));
    onParamsChange?.(values);
  };

  const handleReset = () => {
    setFilters({ name: '', type: 'ALL', status: 'ALL' });
    setPagination((prev) => ({ ...prev, page: 1 }));
    onParamsChange?.({ name: '', type: 'ALL', status: 'ALL' });
  };

  const dataSource = useMemo(
    () => channelsData?.list || [],
    [channelsData?.list],
  );

  const handleEdit = useCallback(
    (record?: PaymentChannel) => {
      ModalManager.open({
        title: record ? `Edit Channel` : 'Create New Channel',
        size: 'xl',
        renderChildren: ({ close }) => (
          <PaymentChannelModal data={record} close={close} reload={refresh} />
        ),
      });
    },
    [refresh],
  );

  const handleDelete = useCallback(
    (id: number) => {
      ModalManager.open({
        title: 'Disable Channel',
        content:
          'Are you sure you want to disable this channel? Users will not be able to see it.',
        confirmText: 'Disable',
        onConfirm: async () => {
          try {
            await paymentChannelApi.delete(id, 0);
            addToast('success', 'Channel disabled successfully');
            void refresh();
          } catch {
            addToast('error', 'Failed to disable channel');
          }
        },
      });
    },
    [addToast, refresh],
  );

  const columns: ColumnDef<PaymentChannel>[] = useMemo(() => {
    const col = createColumnHelper<PaymentChannel>();
    return [
      col.accessor('name', {
        header: 'Channel Info',
        size: 240,
        cell: (info) => {
          const row = info.row.original;
          return (
            <div className="flex items-center gap-3 group">
              <div className="w-10 h-10 rounded-xl border border-gray-200 bg-gray-50 p-1.5 flex items-center justify-center shrink-0 shadow-sm group-hover:shadow-md transition-all">
                {row.icon ? (
                  <SmartImage
                    src={row.icon}
                    alt={row.name}
                    className="w-full h-full"
                    imgClassName="w-full h-full object-contain"
                  />
                ) : (
                  <CreditCard size={20} className="text-gray-400" />
                )}
              </div>
              <div className="flex flex-col">
                <div className="font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2 text-sm">
                  {row.name}
                  {row.isCustom && (
                    <span className="text-[10px] leading-none bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded border border-blue-100 font-medium">
                      Custom
                    </span>
                  )}
                </div>
                <div className="text-xs text-gray-500 font-mono mt-0.5 flex items-center gap-1">
                  <span className="bg-gray-100 px-1 rounded text-[10px] text-gray-600">
                    CODE
                  </span>
                  {row.code}
                </div>
              </div>
            </div>
          );
        },
      }),
      col.accessor('type', {
        header: 'Type',
        size: 120,
        cell: (info) => <TypeBadge type={info.getValue()} />,
      }),
      col.accessor('minAmount', {
        header: 'Limits Range',
        size: 180,
        cell: (info) => {
          const row = info.row.original;
          return (
            <div className="flex flex-col justify-center">
              <div className="text-sm font-medium text-gray-700 dark:text-gray-300 font-mono">
                ₱{row.minAmount.toLocaleString()} - ₱
                {row.maxAmount.toLocaleString()}
              </div>
            </div>
          );
        },
      }),
      col.accessor('feeFixed', {
        header: 'Fees',
        size: 150,
        cell: (info) => {
          const row = info.row.original;
          if (row.type === 1)
            return <span className="text-gray-400 text-xs italic">No Fee</span>;
          const isFree = row.feeFixed === 0 && row.feeRate === 0;
          if (isFree)
            return (
              <span className="text-green-600 font-bold text-xs bg-green-50 px-2 py-1 rounded-full">
                FREE
              </span>
            );
          return (
            <div className="flex items-center gap-1 text-xs">
              {row.feeFixed > 0 && (
                <span className="bg-gray-100 text-gray-700 px-1.5 py-0.5 rounded border border-gray-200 font-medium">
                  ₱{row.feeFixed}
                </span>
              )}
              {row.feeFixed > 0 && row.feeRate > 0 && (
                <span className="text-gray-400">+</span>
              )}
              {row.feeRate > 0 && (
                <span className="bg-gray-100 text-gray-700 px-1.5 py-0.5 rounded border border-gray-200 font-medium">
                  {(row.feeRate * 100).toFixed(1)}%
                </span>
              )}
            </div>
          );
        },
      }),
      col.accessor('sortOrder', {
        header: 'Sort',
        size: 80,
        cell: (info) => (
          <span className="font-mono text-gray-500 text-xs">
            #{info.getValue()}
          </span>
        ),
      }),
      col.accessor('status', {
        header: 'Status',
        size: 100,
        cell: (info) => <StatusBadge status={info.getValue()} />,
      }),
      col.display({
        id: 'actions',
        header: 'Action',
        size: 100,
        cell: (info) => {
          const row = info.row.original;
          return (
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                className="text-gray-500 hover:text-primary-600 hover:bg-primary-50"
                onClick={() => handleEdit(row)}
                title="Edit Configuration"
              >
                <Edit size={16} />
              </Button>
              {row.status !== 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-gray-400 hover:text-red-600 hover:bg-red-50"
                  onClick={() => handleDelete(row.id)}
                  title="Disable Channel"
                >
                  <Power size={16} />
                </Button>
              )}
            </div>
          );
        },
      }),
    ] as ColumnDef<PaymentChannel>[];
  }, [handleEdit, handleDelete]);

  const searchSchema: FormSchema[] = useMemo(
    () => [
      {
        type: 'input',
        key: 'name',
        label: 'Channel Name',
        placeholder: 'Search name...',
      },
      {
        type: 'select',
        key: 'type',
        label: 'Type',
        defaultValue: 'ALL',
        options: [
          { label: 'All', value: 'ALL' },
          { label: 'Money In (Recharge)', value: '1' },
          { label: 'Money Out (Withdraw)', value: '2' },
        ],
      },
      {
        type: 'select',
        key: 'status',
        label: 'Status',
        defaultValue: 'ALL',
        options: [
          { label: 'All', value: 'ALL' },
          { label: 'Active', value: '1' },
          { label: 'Maintenance', value: '2' },
          { label: 'Disabled', value: '0' },
        ],
      },
    ],
    [],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Payment Channels"
        description="Configure payment gateways, limits, and fees for money in/out."
        buttonText="Add Channel"
        buttonOnClick={() => handleEdit()}
      />

      <Card className="border-none shadow-sm">
        <div className="p-0">
          <div className="p-4 mb-2">
            <SchemaSearchForm<PaymentChannelSearchForm>
              schema={searchSchema}
              initialValues={{
                name: filters.name,
                type: filters.type,
                status: filters.status,
              }}
              onSearch={handleSearch}
              onReset={handleReset}
            />
          </div>
          <BaseTable
            data={dataSource}
            rowKey="id"
            columns={columns}
            loading={channelsLoading}
            pagination={{
              current: pagination.page,
              pageSize: pagination.pageSize,
              total: channelsData?.total || 0,
              onChange: (page: number, pageSize: number) => {
                setPagination({ page, pageSize });
              },
            }}
          />
        </div>
      </Card>
    </div>
  );
};
