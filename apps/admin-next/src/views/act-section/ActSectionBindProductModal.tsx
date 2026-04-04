'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAntdTable, useRequest } from 'ahooks';
import { actSectionApi, productApi } from '@/api';
import { actSectionWithProducts, Product } from '@/type/types';
import { Button, ModalManager } from '@repo/ui';
import { Input } from '@/components/UIComponents';
import type { ColumnDef } from '@tanstack/react-table';
import { Link, Link2Off, Search } from 'lucide-react';
import { useToastStore } from '@/store/useToastStore';
import { BaseTable } from '@/components/scaffold/BaseTable';
import { SmartImage } from '@/components/ui/SmartImage';

interface Props {
  onClose: () => void;
  onConfirm: () => void;
  editingData: actSectionWithProducts;
}

export const ActSectionBindProductModal: React.FC<Props> = ({
  onClose,
  onConfirm,
  editingData,
}) => {
  const [selectedRows, setSelectedRows] = useState<Product[]>([]);
  const [existingIds, setExistingSelectedRows] = useState<string[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const addToast = useToastStore((s) => s.addToast);

  const getTableData1 = useCallback(
    async (
      { current, pageSize }: { current: number; pageSize: number },
      formData: { name: string },
    ) => {
      const res = await productApi.getProducts({
        page: current,
        pageSize,
        treasureName: formData.name,
      });
      return { list: res.list ?? [], total: res.total ?? 0 };
    },
    [],
  );

  const { tableProps, run } = useAntdTable(getTableData1, {
    manual: true,
    defaultPageSize: 5, // 弹窗里显示少一点
    defaultParams: [{ current: 1, pageSize: 5 }, { name: '' }],
  });

  const { run: getDetail } = useRequest(actSectionApi.getDetail, {
    manual: true,
    onSuccess: (data) => {
      if (data?.items) {
        const ids = data.items.map((item) => item.treasureId);
        setExistingSelectedRows(ids as string[]);
      }
    },
  });

  const { run: bindProduct, loading } = useRequest(actSectionApi.bindProduct, {
    manual: true,
    onSuccess: () => {
      addToast('success', 'Products added to activity section successfully');
      onConfirm();
    },
  });

  const { run: bindProductByColum, loading: bindProductByColumLoading } =
    useRequest(actSectionApi.bindProduct, {
      manual: true,
      onSuccess: () => {
        addToast('success', 'Products added to activity section successfully');
        getDetail(editingData.id);
      },
    });

  const { run: unbindProduct, loading: unbindLoading } = useRequest(
    actSectionApi.unbindProduct,
    {
      manual: true,
      onSuccess: () => {
        addToast('success', 'Product unbound successfully');
        getDetail(editingData.id);
      },
    },
  );

  useEffect(() => {
    getDetail(editingData.id);
    run({ current: 1, pageSize: 5 }, { name: '' });
  }, [editingData.id, getDetail, run]);

  const confirm = () => {
    const products = Object.values(selectedRows).map(
      (product) => product.treasureId,
    );
    if (products.length === 0) {
      addToast('error', 'Please select at least one product');
      return;
    }
    bindProduct(editingData.id, { treasureIds: products });
  };

  const unbind = useCallback(
    (product: Product) => {
      ModalManager.open({
        title: 'Confirm Unbind',
        content: `Are you sure you want to unbind "${product.treasureName}" from this activity section?`,
        confirmText: 'Unbind',
        cancelText: 'Cancel',
        onConfirm: () => {
          if (unbindLoading) return;
          unbindProduct(editingData.id, product.treasureId);
        },
      });
    },
    [editingData.id, unbindLoading, unbindProduct],
  );

  // baseTable 检测到选中了行或者onSelectionChange:handleSelectionChange发生变化，会调用onSelectionChange
  // 父组件通过handleSelectionChange获取选中的行数据，用setState保存,父组件re-render
  //如果handleSelectionChange不做处理，会创建一个新的handleSelectionChange引用
  // baseTable 会收到一个新的props onSelectionChange，认为onSelectionChange变化了
  // baseTable 依赖onSelectionChange变化，重新渲染，形成死循环
  const handleSelectionChange = useCallback((data: Product[]) => {
    setSelectedRows(data);
  }, []);

  // 3. 表格列定义
  const columns = useMemo<ColumnDef<Product, unknown>[]>(() => {
    return [
      {
        accessorKey: 'treasureName',
        header: 'Product Info',
        cell: ({ row }) => (
          <div className="flex items-center gap-3">
            <SmartImage
              width={40}
              height={40}
              layout="constrained"
              src={row.original.treasureCoverImg}
              className="min-w-[40px] h-10 rounded object-cover bg-gray-100"
              alt=""
              loading="lazy"
            />
            <div className="text-sm font-medium line-clamp-1">
              {row.original.treasureName}
            </div>
          </div>
        ),
      },
      {
        accessorKey: 'unitAmount',
        header: 'Price',
        cell: ({ row }) => (
          <span className="font-mono text-xs">₱{row.original.unitAmount}</span>
        ),
      },
      {
        id: 'actions',
        header: 'Actions',
        enableSorting: false,
        cell: ({ row }) => {
          const isBinding = existingIds.includes(row.original.treasureId);
          return isBinding ? (
            <Button
              isLoading={unbindLoading}
              variant="ghost"
              size="sm"
              onClick={() => unbind(row.original)}
            >
              <Link2Off size={16} />
            </Button>
          ) : (
            <Button
              isLoading={bindProductByColumLoading}
              variant="ghost"
              size="sm"
              onClick={() =>
                bindProductByColum(editingData.id, {
                  treasureIds: [row.original.treasureId],
                })
              }
            >
              <Link size={16} />
            </Button>
          );
        },
      },
    ];
  }, [
    bindProductByColum,
    bindProductByColumLoading,
    editingData.id,
    existingIds,
    unbindLoading,
    unbind,
  ]);

  return (
    <div className="rounded-xl shadow-2xl w-[600px] max-w-[90vw] flex flex-col max-h-[85vh]">
      <div className="p-4 flex-1 overflow-y-auto space-y-4">
        <div className="flex gap-2">
          <Input
            placeholder="Search product name..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            onKeyDown={(e) =>
              e.key === 'Enter' &&
              run({ current: 1, pageSize: 5 }, { name: searchTerm })
            }
          />
          <Button
            onClick={() =>
              run({ current: 1, pageSize: 5 }, { name: searchTerm })
            }
          >
            <Search size={16} />
          </Button>
        </div>

        <BaseTable
          rowKey="treasureId"
          data={tableProps.dataSource}
          columns={columns}
          selectable={true}
          defaultSelectedRowKeys={existingIds}
          disabledRowKeys={existingIds}
          onSelectionChange={handleSelectionChange}
          pagination={{
            ...tableProps.pagination,
            onChange: (page, pageSize) => {
              tableProps.onChange?.({
                current: page,
                pageSize: pageSize || tableProps.pagination?.pageSize || 10,
              });
            },
          }}
        />
      </div>

      <div className="p-4  flex justify-end gap-3 ">
        <div className="flex-1 content-center text-sm text-gray-500">
          <span className="font-bold text-blue-600">{selectedRows.length}</span>
          items
        </div>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button isLoading={loading} onClick={confirm}>
          Confirm Add
        </Button>
      </div>
    </div>
  );
};
