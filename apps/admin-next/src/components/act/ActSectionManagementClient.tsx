'use client';

import React, { useCallback, useMemo } from 'react';
import {
  Edit3,
  Trash2,
  Ban,
  CheckCircle,
  GripVertical,
  LayoutGrid,
  Image as ImageIcon,
  ArrowBigDownDash,
} from 'lucide-react';
import { Card, Badge } from '@/components/UIComponents';
import { useAntdTable, useRequest } from 'ahooks';
import { createColumnHelper, ColumnDef } from '@tanstack/react-table';

import { Button, ModalManager } from '@repo/ui';
import { useToastStore } from '@/store/useToastStore';
import { ActSectionListParams, actSectionWithProducts } from '@/type/types';
import { actSectionApi } from '@/api';
import { ActSectionBindProductModal } from '@/views/act-section/ActSectionBindProductModal';
import { ProductSelectorModal } from '@/views/act-section/ProductSelectorModal';
import { BaseTable } from '@/components/scaffold/BaseTable';
import { SchemaSearchForm } from '@/components/scaffold/SchemaSearchForm';
import { PageHeader } from '@/components/scaffold/PageHeader';
import { getActSectionTypeLabel } from '@lucky/shared';

type ActSectionSearchForm = {
  title: string;
  status: string;
};

interface ActSectionManagementProps {
  initialFormParams?: Record<string, unknown>;
  onParamsChange?: (params: Record<string, unknown>) => void;
}

// --- 主页面组件 ---
export const ActSectionManagement: React.FC<ActSectionManagementProps> = ({
  initialFormParams,
  onParamsChange,
}) => {
  const addToast = useToastStore((state) => state.addToast);

  // 获取数据 (useAntdTable 模式)
  const getTableData = async (
    {
      current,
      pageSize,
    }: {
      current: number;
      pageSize: number;
    },
    formData: {
      title: string;
      status: string;
    },
  ) => {
    const params: ActSectionListParams = {
      pageSize,
      page: current,
    };
    if (formData?.status && formData.status !== 'ALL') {
      params.status = Number(formData.status);
    }

    if (formData?.title) {
      params.title = formData.title;
    }
    const res = await actSectionApi.getList(params);
    return { list: res.list, total: res.total };
  };

  const {
    tableProps,
    run,
    refresh,
    search: { reset },
  } = useAntdTable(getTableData, {
    defaultPageSize: 10,
    defaultParams: [
      { current: 1, pageSize: 10 },
      {
        title: (initialFormParams?.title as string) || '',
        status: (initialFormParams?.status as string) || 'ALL',
      },
    ],
  });

  // 搜索回调：直接拿到所有值
  const handleSearch = (values: ActSectionSearchForm) => {
    // 自动重置到第一页，并带上所有条件
    run({ current: 1, pageSize: 10 }, values);
    onParamsChange?.(values);
  };

  const handleReset = () => {
    reset();
    onParamsChange?.({ title: '', status: 'ALL' });
  };

  const dataSource = useMemo(
    () => tableProps.dataSource as actSectionWithProducts[],
    [tableProps.dataSource],
  );

  // --- API Actions ---

  const updateStatus = useRequest(actSectionApi.update, {
    manual: true,
    onSuccess: () => {
      addToast('success', 'Section status updated');
      refresh();
    },
  });

  const deleteSection = useRequest(actSectionApi.delete, {
    manual: true,
    onSuccess: () => {
      addToast('success', 'Section deleted');
      refresh();
    },
  });

  const handleToggleStatus = useCallback(
    (record: actSectionWithProducts) => {
      updateStatus.run(record.id, { status: record.status === 1 ? 0 : 1 });
    },
    [updateStatus],
  );

  const handleDelete = useCallback(
    (record: actSectionWithProducts) => {
      ModalManager.open({
        title: 'Delete Section?',
        content: `Are you sure you want to delete "${record.title}"?`,
        confirmText: 'Delete',
        onConfirm: () => deleteSection.run(record.id),
      });
    },
    [deleteSection],
  );

  const handleEdit = useCallback(
    async (record: actSectionWithProducts) => {
      ModalManager.open({
        title: 'Edit Product Section',
        renderChildren: ({ close, confirm }) => (
          <ProductSelectorModal
            close={close}
            confirm={confirm}
            editingData={record}
          />
        ),
        onConfirm: refresh,
      });
    },
    [refresh],
  );

  const handleBindProduct = useCallback(
    async (record: actSectionWithProducts) => {
      ModalManager.open({
        title: 'Bind Products',
        renderChildren: ({ close, confirm }) => (
          <ActSectionBindProductModal
            onClose={close}
            onConfirm={confirm}
            editingData={record}
          />
        ),
        onConfirm: refresh,
      });
    },
    [refresh],
  );

  const handleCreate = () => {
    ModalManager.open({
      title: 'Create New Section',
      renderChildren: ({ close, confirm }) => (
        <ProductSelectorModal close={close} confirm={confirm} />
      ),
      onConfirm: refresh,
    });
  };

  const columns = useMemo(() => {
    // --- Table Columns ---
    const columnHelper = createColumnHelper<actSectionWithProducts>();

    return [
      // 1. 拖拽手柄列
      columnHelper.display({
        id: 'dragHandle',
        header: '',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        cell: ({ listeners }: any) => (
          <div
            {...listeners}
            className="cursor-move text-gray-400 hover:text-gray-600 flex items-center justify-center"
          >
            <GripVertical size={16} />
          </div>
        ),
        size: 40,
      }),
      columnHelper.accessor('title', {
        header: 'Section Title',
        cell: (info) => (
          <div>
            <div className="font-medium text-gray-900 dark:text-white">
              {info.getValue()}
            </div>
            <div className="text-xs text-gray-500 font-mono">
              {info.row.original.key}
            </div>
          </div>
        ),
      }),
      columnHelper.accessor('imgStyleType', {
        header: 'Style',
        cell: (info) => {
          const val = info.getValue();
          // 简单映射，你可以根据实际 UI 需求修改
          const label = getActSectionTypeLabel(val);
          const icon =
            val === 0 ? <ImageIcon size={14} /> : <LayoutGrid size={14} />;
          return (
            <div className="flex items-center gap-2 text-gray-600 dark:text-gray-400 text-sm">
              {icon} <span>{label}</span>
            </div>
          );
        },
      }),
      columnHelper.display({
        id: 'countProducts',
        header: 'Products',
        cell: (info) => (
          <Badge color="gray">
            {info.row.original.items?.length || 0} Products
          </Badge>
        ),
      }),
      columnHelper.accessor('startAt', {
        header: 'Schedule',
        cell: (info) => {
          const start = info.getValue()
            ? new Date(info.getValue()!).toLocaleDateString()
            : 'Now';
          const end = info.row.original.endAt
            ? new Date(info.row.original.endAt!).toLocaleDateString()
            : 'Forever';
          return (
            <span className="text-xs text-gray-500">
              {start} - {end}
            </span>
          );
        },
      }),
      columnHelper.accessor('status', {
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
          <div className="flex items-center gap-2 ">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleEdit(info.row.original)}
            >
              <Edit3 size={16} />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleBindProduct(info.row.original)}
            >
              <ArrowBigDownDash size={16} />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleToggleStatus(info.row.original)}
              isLoading={
                updateStatus.loading &&
                updateStatus.params[0] === info.row.original.id
              }
            >
              {info.row.original.status === 1 ? (
                <Ban size={16} className="text-red-500" />
              ) : (
                <CheckCircle size={16} className="text-green-500" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleDelete(info.row.original)}
            >
              <Trash2 size={16} />
            </Button>
          </div>
        ),
      }),
    ] as ColumnDef<actSectionWithProducts>[];
  }, [
    handleBindProduct,
    handleDelete,
    handleEdit,
    handleToggleStatus,
    updateStatus.loading,
    updateStatus.params,
  ]);

  // --- Render ---
  return (
    <div className="space-y-6">
      {/* Header */}
      <PageHeader
        title="Activity Sections"
        description="Manage homepage sections and product layout"
        buttonText="New Section"
        buttonOnClick={handleCreate}
      />

      <Card>
        {/* Filter Bar (Same logic as ProductManagement) */}
        <div className="space-y-3 mb-6">
          <SchemaSearchForm<ActSectionSearchForm>
            schema={[
              {
                type: 'input',
                key: 'title',
                label: 'Search Title',
                placeholder: 'Enter keywords...',
              },
              {
                type: 'select',
                key: 'status',
                label: 'Status',
                defaultValue: 'ALL', // 支持默认值
                options: [
                  { label: 'All Status', value: 'ALL' },
                  { label: 'Active', value: '1' },
                  { label: 'Disabled', value: '0' },
                ],
              },
            ]}
            initialValues={{
              title: (initialFormParams?.title as string) || '',
              status: (initialFormParams?.status as string) || 'ALL',
            }}
            onSearch={handleSearch}
            onReset={handleReset}
          />
        </div>

        <BaseTable
          data={dataSource}
          rowKey="id"
          columns={columns}
          pagination={{
            ...tableProps.pagination,
            onChange: (page, pageSize) => {
              tableProps.onChange?.(page, pageSize);
            },
          }}
        />
      </Card>
    </div>
  );
};
