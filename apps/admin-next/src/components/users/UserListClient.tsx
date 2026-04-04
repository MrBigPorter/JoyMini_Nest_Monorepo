'use client';

import React, { useCallback, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import { Button, ModalManager, cn } from '@repo/ui';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { useQuery } from '@tanstack/react-query';
import { User as UserIcon, Eye, Ban, CheckCircle } from 'lucide-react';
import { Badge, type BadgeVariant } from '@repo/ui';
import { KYC_STATUS } from '@lucky/shared';
import { clientUserApi } from '@/api';
import { PageHeader } from '@/components/scaffold/PageHeader';
import { SchemaSearchForm } from '@/components/scaffold/SchemaSearchForm';
import { BaseTable } from '@/components/scaffold/BaseTable';
import { Card } from '@/components/UIComponents';
import { useToastStore } from '@/store/useToastStore';
import type { FormSchema } from '@/type/search';
import type { ClientUserListItem } from '@/type/types';
import { UserDetailModal } from '@/views/user-management/UserDetailModal';
import {
  buildUsersListParams,
  parseUsersSearchParams,
  usersListQueryKey,
} from '@/lib/cache/users-cache';

interface DateRangeValue {
  from?: string;
  to?: string;
}

interface UsersSearchFormValues {
  userId: string;
  phone: string;
  status: string;
  kycStatus: string;
  dateRange?: DateRangeValue | '';
}

interface UserListClientProps {
  initialFormParams?: Record<string, unknown>;
  onParamsChange?: (params: Record<string, unknown>) => void;
}

export function UserListClient({
  initialFormParams,
  onParamsChange,
}: UserListClientProps) {
  const addToast = useToastStore((state) => state.addToast);
  const reloadRef = useRef<() => void>(() => undefined);

  const normalizedInitialQuery = useMemo(() => {
    const input = initialFormParams ?? {};
    return parseUsersSearchParams({
      page: typeof input.page === 'string' ? input.page : undefined,
      pageSize: typeof input.pageSize === 'string' ? input.pageSize : undefined,
      userId: typeof input.userId === 'string' ? input.userId : undefined,
      phone: typeof input.phone === 'string' ? input.phone : undefined,
      status: typeof input.status === 'string' ? input.status : undefined,
      kycStatus:
        typeof input.kycStatus === 'string' ? input.kycStatus : undefined,
      startTime:
        typeof input.startTime === 'string' ? input.startTime : undefined,
      endTime: typeof input.endTime === 'string' ? input.endTime : undefined,
    });
  }, [initialFormParams]);

  const [pagination, setPagination] = useState({
    page: normalizedInitialQuery.page,
    pageSize: normalizedInitialQuery.pageSize,
  });
  const [filters, setFilters] = useState<UsersSearchFormValues>({
    userId: normalizedInitialQuery.userId ?? '',
    phone: normalizedInitialQuery.phone ?? '',
    status:
      normalizedInitialQuery.status !== undefined
        ? String(normalizedInitialQuery.status)
        : 'ALL',
    kycStatus:
      normalizedInitialQuery.kycStatus !== undefined
        ? String(normalizedInitialQuery.kycStatus)
        : 'ALL',
    dateRange:
      normalizedInitialQuery.startTime || normalizedInitialQuery.endTime
        ? {
            from: normalizedInitialQuery.startTime,
            to: normalizedInitialQuery.endTime,
          }
        : '',
  });

  const usersQueryInput = useMemo(() => {
    const dateRange =
      filters.dateRange && typeof filters.dateRange === 'object'
        ? filters.dateRange
        : undefined;

    return parseUsersSearchParams({
      page: String(pagination.page),
      pageSize: String(pagination.pageSize),
      userId: filters.userId,
      phone: filters.phone,
      status: filters.status,
      kycStatus: filters.kycStatus,
      startTime: dateRange?.from,
      endTime: dateRange?.to,
    });
  }, [
    filters.dateRange,
    filters.kycStatus,
    filters.phone,
    filters.status,
    filters.userId,
    pagination.page,
    pagination.pageSize,
  ]);

  const {
    data: usersData,
    isFetching,
    refetch,
  } = useQuery({
    queryKey: usersListQueryKey(usersQueryInput),
    queryFn: async () => {
      const res = await clientUserApi.getUsers(
        buildUsersListParams(usersQueryInput),
      );
      return { data: res.list, total: res.total };
    },
    staleTime: 30_000,
  });

  const users = usersData?.data ?? [];
  const total = usersData?.total ?? 0;

  const refresh = useCallback(async () => {
    await refetch();
  }, [refetch]);

  reloadRef.current = () => {
    void refresh();
  };

  const handleView = useCallback((record: ClientUserListItem) => {
    ModalManager.open({
      title: 'User Comprehensive Profile',
      size: 'xl',
      renderChildren: ({ close }) => (
        <UserDetailModal
          userId={record.id}
          close={close}
          reload={() => reloadRef.current()}
        />
      ),
    });
  }, []);

  const handleStatusChange = useCallback(
    async (record: ClientUserListItem) => {
      const isBanning = record.status === 1;
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
                    await refresh();
                    close();
                  } catch {
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
    [addToast, refresh],
  );

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

  const columns: ColumnDef<ClientUserListItem>[] = useMemo(() => {
    const columnHelper = createColumnHelper<ClientUserListItem>();

    return [
      columnHelper.display({
        id: 'userInfo',
        header: 'User Info',
        cell: (info) => {
          const row = info.row.original;
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
      }),
      columnHelper.display({
        id: 'walletAssets',
        header: 'Wallet Assets',
        cell: (info) => {
          const row = info.row.original;
          return (
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
          );
        },
      }),
      columnHelper.display({
        id: 'kycLevel',
        header: 'KYC & Level',
        cell: (info) => {
          const row = info.row.original;
          return (
            <div className="flex flex-col gap-1.5">
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
          );
        },
      }),
      columnHelper.accessor('createdAt', {
        header: 'Register Time',
        size: 160,
        cell: (info) => {
          const date = new Date(info.getValue());
          // 使用固定格式避免服务器-客户端时区差异
          const formattedDate = date.toLocaleString('en-US', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false,
            timeZone: 'UTC',
          });
          return (
            <span className="text-[11px] font-medium text-slate-500">
              {formattedDate}
            </span>
          );
        },
      }),
      columnHelper.display({
        id: 'action',
        header: 'Action',
        size: 120,
        cell: (info) => {
          const row = info.row.original;
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
      }),
    ] as ColumnDef<ClientUserListItem>[];
  }, [handleStatusChange, handleView, kycStatusConfig]);

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
        defaultValue: 'ALL',
        options: [
          { label: 'All', value: 'ALL' },
          { label: 'Active', value: '1' },
          { label: 'Frozen', value: '0' },
        ],
      },
      {
        type: 'select',
        key: 'kycStatus',
        label: 'KYC Status',
        defaultValue: 'ALL',
        options: [
          { label: 'All', value: 'ALL' },
          ...Object.entries(kycStatusConfig).map(([key, value]) => ({
            label: value.label,
            value: key,
          })),
        ],
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

  const handleSearch = useCallback(
    (values: UsersSearchFormValues) => {
      const nextFilters: UsersSearchFormValues = {
        userId: values.userId ?? '',
        phone: values.phone ?? '',
        status: values.status ?? 'ALL',
        kycStatus: values.kycStatus ?? 'ALL',
        dateRange: values.dateRange ?? '',
      };
      setFilters(nextFilters);
      setPagination((prev) => ({ ...prev, page: 1 }));
      onParamsChange?.({
        userId: nextFilters.userId,
        phone: nextFilters.phone,
        status: nextFilters.status,
        kycStatus: nextFilters.kycStatus,
        startTime:
          nextFilters.dateRange && typeof nextFilters.dateRange === 'object'
            ? nextFilters.dateRange.from
            : undefined,
        endTime:
          nextFilters.dateRange && typeof nextFilters.dateRange === 'object'
            ? nextFilters.dateRange.to
            : undefined,
        page: 1,
        pageSize: pagination.pageSize,
      });
    },
    [onParamsChange, pagination.pageSize],
  );

  const handleReset = useCallback(() => {
    const nextFilters: UsersSearchFormValues = {
      userId: '',
      phone: '',
      status: 'ALL',
      kycStatus: 'ALL',
      dateRange: '',
    };
    setFilters(nextFilters);
    setPagination((prev) => ({ ...prev, page: 1 }));
    onParamsChange?.({ page: 1, pageSize: pagination.pageSize });
  }, [onParamsChange, pagination.pageSize]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Users"
        description="Inspect user accounts, wallet assets, KYC state, and registration activity."
      />
      <Card className="border-none shadow-md overflow-hidden rounded-xl">
        <div className="px-4 pt-4">
          <SchemaSearchForm<UsersSearchFormValues>
            schema={searchSchema}
            initialValues={filters}
            onSearch={handleSearch}
            onReset={handleReset}
            loading={isFetching}
          />
        </div>
        <div className="px-4 pb-4">
          <div className="mb-3 flex items-center gap-3 font-black text-slate-800 dark:text-slate-100 uppercase tracking-tight">
            <div className="p-1.5 bg-blue-500 rounded-lg">
              <UserIcon className="text-white" size={18} strokeWidth={3} />
            </div>
            <span>Client Database</span>
          </div>
          <BaseTable
            data={users}
            rowKey="id"
            columns={columns}
            loading={isFetching}
            pagination={{
              current: pagination.page,
              pageSize: pagination.pageSize,
              total,
              onChange: (page, pageSize) => {
                setPagination({ page, pageSize });
                onParamsChange?.({
                  userId: filters.userId,
                  phone: filters.phone,
                  status: filters.status,
                  kycStatus: filters.kycStatus,
                  startTime:
                    filters.dateRange && typeof filters.dateRange === 'object'
                      ? filters.dateRange.from
                      : undefined,
                  endTime:
                    filters.dateRange && typeof filters.dateRange === 'object'
                      ? filters.dateRange.to
                      : undefined,
                  page,
                  pageSize,
                });
              },
            }}
          />
        </div>
      </Card>
    </div>
  );
}
