'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAntdTable, useRequest } from 'ahooks';
import { flashSaleApi, productApi } from '@/api';
import { Product } from '@/type/types';
import { Button } from '@repo/ui';
import { Input } from '@/components/UIComponents';
import { createColumnHelper, ColumnDef } from '@tanstack/react-table';
import { Link, Link2Off, Search } from 'lucide-react';
import { useToastStore } from '@/store/useToastStore';
import { BaseTable } from '@/components/scaffold/BaseTable';
import { SmartImage } from '@/components/ui/SmartImage';

interface Props {
  sessionId: string;
  onClose: () => void;
  onSaved: () => void;
}

/** Product with bound flash-sale info */
interface BoundIdSet {
  treasureId: string;
}

export const FlashSaleBindProductModal: React.FC<Props> = ({
  sessionId,
  onClose,
  onSaved,
}) => {
  const addToast = useToastStore((s) => s.addToast);

  // 已绑定的 treasureId 集合
  const [boundIds, setBoundIds] = useState<string[]>([]);
  // 当前「待确认绑定」的商品
  const [pending, setPending] = useState<Product | null>(null);
  // flash 参数 (inline form)
  const [flashPrice, setFlashPrice] = useState('');
  const [flashStock, setFlashStock] = useState('0');
  const [searchTerm, setSearchTerm] = useState('');

  // ── 拉取已绑定列表 ──────────────────────────────────────────────────────────
  const { run: fetchBound } = useRequest(
    () => flashSaleApi.getSessionProducts(sessionId),
    {
      onSuccess: (data) => {
        const ids = (data?.list ?? []).map((p: BoundIdSet) => p.treasureId);
        setBoundIds(ids);
      },
    },
  );

  // ── 商品分页表格 ────────────────────────────────────────────────────────────
  const getTableData = useCallback(
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

  const { tableProps, run } = useAntdTable(getTableData, {
    manual: true,
    defaultPageSize: 5,
    defaultParams: [{ current: 1, pageSize: 5 }, { name: '' }],
  });

  useEffect(() => {
    run({ current: 1, pageSize: 5 }, { name: '' });
  }, [run]);

  // ── 绑定 API ────────────────────────────────────────────────────────────────
  const { run: doBind, loading: bindLoading } = useRequest(
    flashSaleApi.bindProduct,
    {
      manual: true,
      onSuccess: () => {
        addToast('success', 'Product bound to flash sale successfully');
        setPending(null);
        setFlashPrice('');
        setFlashStock('0');
        fetchBound();
        onSaved();
      },
    },
  );

  // ── 解绑 API ────────────────────────────────────────────────────────────────
  const { run: doUnbind, loading: unbindLoading } = useRequest(
    async (treasureId: string) => {
      // find the flash-sale product record id
      const data = await flashSaleApi.getSessionProducts(sessionId);
      const record = (data?.list ?? []).find(
        (p) => p.treasureId === treasureId,
      );
      if (record) await flashSaleApi.removeProduct(record.id);
    },
    {
      manual: true,
      onSuccess: () => {
        addToast('success', 'Product unbound successfully');
        fetchBound();
        onSaved();
      },
    },
  );

  // ── 确认绑定 ────────────────────────────────────────────────────────────────
  const handleConfirmBind = () => {
    if (!pending) return;
    const price = flashPrice.trim();
    if (!price || isNaN(Number(price))) {
      addToast('error', 'Please enter a valid flash price');
      return;
    }
    doBind(sessionId, {
      treasureId: pending.treasureId,
      flashPrice: price,
      flashStock: parseInt(flashStock, 10) || 0,
    });
  };

  // ── 列定义 ──────────────────────────────────────────────────────────────────
  const handleSelectionChange = useCallback(() => {}, []);

  const columns = useMemo(() => {
    const col = createColumnHelper<Product>();
    return [
      col.accessor('treasureName', {
        header: 'Product',
        cell: (info) => (
          <div className="flex items-center gap-3">
            <SmartImage
              width={40}
              height={40}
              layout="constrained"
              src={info.row.original.treasureCoverImg}
              className="min-w-[40px] h-10 rounded object-cover bg-gray-100"
              alt=""
              loading="lazy"
            />
            <div className="text-sm font-medium line-clamp-2">
              {info.getValue()}
            </div>
          </div>
        ),
      }),
      col.accessor('unitAmount', {
        header: 'Original Price',
        cell: (info) => (
          <span className="font-mono text-xs text-gray-500">
            ₱{info.getValue()}
          </span>
        ),
      }),
      col.accessor((row) => boundIds.includes(row.treasureId), {
        id: 'actions',
        header: 'Action',
        enableSorting: false,
        cell: (info) => {
          const isBound = boundIds.includes(info.row.original.treasureId);
          const isSelected =
            pending?.treasureId === info.row.original.treasureId;
          return isBound ? (
            <Button
              isLoading={unbindLoading}
              variant="ghost"
              size="sm"
              onClick={() => doUnbind(info.row.original.treasureId)}
            >
              <Link2Off size={16} />
            </Button>
          ) : (
            <Button
              variant={isSelected ? 'primary' : 'ghost'}
              size="sm"
              onClick={() => {
                setPending(info.row.original);
                setFlashPrice('');
                setFlashStock('0');
              }}
            >
              <Link size={16} />
            </Button>
          );
        },
      }),
    ] as ColumnDef<Product>[];
  }, [boundIds, doUnbind, pending?.treasureId, unbindLoading]);

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="rounded-xl shadow-2xl w-[640px] max-w-[92vw] flex flex-col max-h-[88vh]">
      {/* Search + Table */}
      <div className="p-4 flex-1 overflow-y-auto space-y-3">
        <div className="flex gap-2">
          <Input
            placeholder="Search product name…"
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
          selectable={false}
          onSelectionChange={handleSelectionChange}
          pagination={{
            ...tableProps.pagination,
            onChange: (page, pageSize) => {
              tableProps.onChange?.({
                current: page,
                pageSize: pageSize || tableProps.pagination?.pageSize || 5,
              });
            },
          }}
        />
      </div>

      {/* Flash params panel — appears when a product is selected */}
      {pending && (
        <div className="border-t border-gray-100 dark:border-white/10 p-4 bg-teal-50/40 dark:bg-teal-500/5 space-y-3">
          <p className="text-sm font-medium text-gray-800 dark:text-gray-200 line-clamp-1">
            <span className="text-teal-500">Binding:</span>{' '}
            {pending.treasureName}
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500">
                Flash Price (PHP) *
              </label>
              <Input
                placeholder="e.g. 99.00"
                value={flashPrice}
                onChange={(e) => setFlashPrice(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500">Flash Stock</label>
              <Input
                type="number"
                min="0"
                value={flashStock}
                onChange={(e) => setFlashStock(e.target.value)}
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setPending(null)}>
              Cancel
            </Button>
            <Button
              size="sm"
              isLoading={bindLoading}
              onClick={handleConfirmBind}
            >
              Confirm Bind
            </Button>
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="p-4 border-t border-gray-100 dark:border-white/10 flex justify-end">
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
      </div>
    </div>
  );
};
