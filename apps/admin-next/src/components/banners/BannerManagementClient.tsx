'use client';

import React, { useCallback, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRequest } from 'ahooks';
import { bannerApi } from '@/api';
import { Button, ModalManager } from '@repo/ui';
import { createColumnHelper, ColumnDef } from '@tanstack/react-table';
import {
  Edit3,
  Trash2,
  GripVertical,
  ExternalLink,
  Box,
  Ban,
  CheckCircle,
} from 'lucide-react';
import { Badge, Card } from '@/components/UIComponents';
import { useToastStore } from '@/store/useToastStore';
import { BannerFormModal } from '@/views/banner/BannerFormModal';
import { JUMP_CATE } from '@lucky/shared';
import { Banner } from '@/type/types';
import { SchemaSearchForm } from '@/components/scaffold/SchemaSearchForm';
import { BaseTable } from '@/components/scaffold/BaseTable';
import { PageHeader } from '@/components/scaffold/PageHeader';
import { SmartImage } from '@/components/ui/SmartImage';
import {
  bannersListQueryKey,
  buildBannersListParams,
  parseBannersSearchParams,
} from '@/lib/cache/banners-cache';

type BannerSearchForm = {
  title: string;
  bannerCate: string;
};

interface BannerManagementProps {
  initialFormParams?: Record<string, unknown>;
  onParamsChange?: (params: Record<string, unknown>) => void;
}

export const BannerManagement: React.FC<BannerManagementProps> = ({
  initialFormParams,
  onParamsChange,
}) => {
  const addToast = useToastStore((s) => s.addToast);
  const normalizedInitialQuery = useMemo(() => {
    const input = initialFormParams ?? {};
    return parseBannersSearchParams({
      page: typeof input.page === 'string' ? input.page : undefined,
      pageSize: typeof input.pageSize === 'string' ? input.pageSize : undefined,
      title: typeof input.title === 'string' ? input.title : undefined,
      bannerCate:
        typeof input.bannerCate === 'string' ? input.bannerCate : undefined,
    });
  }, [initialFormParams]);

  const [pagination, setPagination] = useState({
    page: normalizedInitialQuery.page,
    pageSize: normalizedInitialQuery.pageSize,
  });
  const [filters, setFilters] = useState<BannerSearchForm>({
    title: normalizedInitialQuery.title ?? '',
    bannerCate:
      normalizedInitialQuery.bannerCate !== undefined
        ? String(normalizedInitialQuery.bannerCate)
        : 'ALL',
  });

  const bannersQueryInput = useMemo(
    () =>
      parseBannersSearchParams({
        page: String(pagination.page),
        pageSize: String(pagination.pageSize),
        title: filters.title,
        bannerCate: filters.bannerCate,
      }),
    [filters.bannerCate, filters.title, pagination.page, pagination.pageSize],
  );

  const {
    data: bannersData,
    isFetching: bannersLoading,
    refetch: refresh,
  } = useQuery({
    queryKey: bannersListQueryKey(bannersQueryInput),
    queryFn: () => bannerApi.getList(buildBannersListParams(bannersQueryInput)),
    staleTime: 30_000,
  });

  // 搜索回调：直接拿到所有值
  const handleSearch = (values: BannerSearchForm) => {
    setFilters(values);
    setPagination((prev) => ({ ...prev, page: 1 }));
    onParamsChange?.(values);
  };

  const handleReset = () => {
    setFilters({ title: '', bannerCate: 'ALL' });
    setPagination((prev) => ({ ...prev, page: 1 }));
    onParamsChange?.({ title: '', bannerCate: 'ALL' });
  };

  const dataSource = useMemo(
    () => bannersData?.list || [],
    [bannersData?.list],
  );
  // --- Actions ---
  const { run: deleteBanner } = useRequest(bannerApi.delete, {
    manual: true,
    onSuccess: () => {
      addToast('success', 'Deleted');
      void refresh();
    },
  });

  const { run: updateStatus } = useRequest(bannerApi.updateState, {
    manual: true,
    onSuccess: () => {
      addToast('success', 'Status updated');
      void refresh();
    },
    onError: () => {
      // Revert on error
      void refresh();
    },
  });

  // --- Handlers ---
  const handleOpenModal = useCallback(
    (record?: Banner) => {
      ModalManager.open({
        title: record ? 'Edit Banner' : 'Create Banner',
        renderChildren: ({ close, confirm }) => (
          <BannerFormModal
            key={record ? `edit-${record.id}` : 'create-banner'}
            close={close}
            confirm={() => {
              confirm();
              void refresh();
            }}
            editingData={record}
          />
        ),
      });
    },
    [refresh],
  );

  const handleDelete = useCallback(
    (record: Banner) => {
      ModalManager.open({
        title: 'Delete Banner?',
        content: 'This action cannot be undone.',
        confirmText: 'Delete',
        onConfirm: () => deleteBanner(record.id),
      });
    },
    [deleteBanner],
  );

  const columns = useMemo(() => {
    const columnHelper = createColumnHelper<Banner>();
    return [
      columnHelper.display({
        id: 'dragHandle',
        header: '',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        cell: ({ listeners }: any) => (
          <div
            {...listeners}
            className="cursor-move text-gray-400 hover:text-blue-500"
          >
            <GripVertical size={16} />
          </div>
        ),
        size: 40,
      }),
      columnHelper.accessor('bannerImgUrl', {
        header: 'Visual',
        cell: (info) => (
          <div className="w-32 h-16 bg-gray-100 rounded-md overflow-hidden  relative group">
            <SmartImage
              src={info.getValue()}
              width={128}
              height={64}
              className="w-full h-full object-cover"
              alt=""
            />
            {info.row.original.fileType === 2 && (
              <div className="absolute inset-0 bg-black/30 flex items-center justify-center text-white text-xs">
                Video
              </div>
            )}
          </div>
        ),
      }),
      columnHelper.accessor('title', {
        header: 'Info',
        cell: (info) => (
          <div>
            <div className="font-medium">{info.getValue()}</div>
            <div className="text-xs text-gray-500 mt-1">
              {/* 智能排期展示 */}
              {info.row.original.activityAtStart
                ? `${new Date(info.row.original.activityAtStart).toLocaleDateString()} - ${new Date(info.row.original.activityAtEnd).toLocaleDateString()}`
                : 'Permanent (No expiry)'}
            </div>
          </div>
        ),
      }),
      columnHelper.accessor('jumpCate', {
        header: 'Target',
        cell: (info) => {
          const type = info.getValue();
          if (type === JUMP_CATE.EXTERNAL)
            return (
              <div className="flex items-center gap-1 text-blue-600 text-xs">
                <ExternalLink size={12} /> Web Link
              </div>
            );
          if (type === JUMP_CATE.TREASURE)
            return (
              <div className="flex items-center gap-1 text-purple-600 text-xs">
                <Box size={12} /> Product
              </div>
            );
          return <span className="text-gray-400 text-xs">No Action</span>;
        },
      }),
      columnHelper.accessor('state', {
        header: 'Status',
        cell: (info) => (
          <Badge color={info.getValue() === 1 ? 'green' : 'gray'}>
            {info.getValue() === 1 ? 'Active' : 'Disabled'}
          </Badge>
        ),
      }),
      columnHelper.display({
        id: 'actions',
        header: 'Actions',
        cell: (info) => (
          <div className="flex  gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                updateStatus(
                  info.row.original.id,
                  info.row.original.state === 1 ? 0 : 1,
                )
              }
            >
              {info.row.original.state === 1 ? (
                <Ban size={14} />
              ) : (
                <CheckCircle size={14} />
              )}
            </Button>
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
    ] as ColumnDef<Banner>[];
  }, [handleDelete, handleOpenModal, updateStatus]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Banner Management"
        description="Manage the banners displayed in the mini shop."
        buttonText="Create Banner"
        buttonOnClick={() => handleOpenModal()}
      />

      <Card>
        <div className="space-y-3 mb-6">
          <SchemaSearchForm<BannerSearchForm>
            schema={[
              {
                type: 'input',
                key: 'title',
                label: 'Search Title',
                placeholder: 'Enter keywords...',
              },
              {
                type: 'select',
                key: 'bannerCate',
                label: 'Position',
                defaultValue: 'ALL', // 支持默认值
                options: [
                  { label: 'All', value: 'ALL' },
                  { label: 'Home', value: '1' },
                  { label: 'Product', value: '2' },
                ],
              },
            ]}
            initialValues={{
              title: filters.title,
              bannerCate: filters.bannerCate,
            }}
            onSearch={handleSearch}
            onReset={handleReset}
            loading={bannersLoading}
          />
        </div>
        <BaseTable
          data={dataSource}
          loading={bannersLoading}
          rowKey="id"
          columns={columns}
          pagination={{
            current: pagination.page,
            pageSize: pagination.pageSize,
            total: bannersData?.total ?? 0,
            onChange: (page, pageSize) => {
              setPagination({
                page,
                pageSize: pageSize || pagination.pageSize || 10,
              });
            },
          }}
        />
      </Card>
    </div>
  );
};
