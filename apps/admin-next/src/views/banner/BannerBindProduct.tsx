'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAntdTable } from 'ahooks';
import { productApi } from '@/api';
import { Product } from '@/type/types';
import {
  Button,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@repo/ui';
import { Input } from '@/components/UIComponents';
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table';
import { Search } from 'lucide-react';
import { Image } from '@unpic/react';
import type { TFunc } from '@/hooks/useTranslation';

interface TableMeta {
  relatedTitleId: string | null;
  setRelatedTitleId: (id: string) => void;
}

interface Props {
  value?: string;
  onChange?: (value: string) => void;
  t: TFunc;
}

export const BannerBindProduct: React.FC<Props> = ({ value, onChange, t }) => {
  const [searchTerm, setSearchTerm] = useState('');

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
    run({ current: 1, pageSize: 5 }, { name: searchTerm });
  }, [run, searchTerm]);

  // 3. 表格列定义
  const columns = useMemo(() => {
    const columnHelper = createColumnHelper<Product>();
    return [
      columnHelper.display({
        id: 'select',
        header: t('banners_select'),
        cell: (info) => {
          const meta = info.table.options.meta as TableMeta;
          const { relatedTitleId, setRelatedTitleId } = meta;
          const id = info.row.original.treasureId;
          // 选中状态：要么在 selectedRows 里，要么是当前关联的那个
          const isChecked = relatedTitleId === id;

          return (
            // 3. 手写一个 div 模拟 Radio，样式完全复刻 Shadcn UI
            <div
              onClick={() => setRelatedTitleId(id)}
              className={`
                aspect-square h-4 w-4 rounded-full border border-primary text-primary ring-offset-background cursor-pointer flex items-center justify-center
                ${isChecked ? 'border-primary' : 'border-gray-400'} 
              `}
            >
              {/* 选中时的中心圆点 */}
              {isChecked && (
                <div className="h-2.5 w-2.5 rounded-full bg-primary" />
              )}
            </div>
          );
        },
      }),
      columnHelper.accessor('treasureName', {
        header: t('banners_productInfo'),
        cell: (info) => (
          <div className="flex items-center gap-3">
            <Image
              cdn="cloudflare"
              src={info.row.original.treasureCoverImg}
              width={40}
              height={40}
              layout="constrained"
              className="w-10 h-10 rounded object-cover bg-gray-100"
              alt=""
              loading="lazy"
            />
            <div className="text-sm font-medium line-clamp-1">
              {info.getValue()}
            </div>
          </div>
        ),
      }),
      columnHelper.accessor('unitAmount', {
        header: t('banners_price'),
        cell: (info) => (
          <span className="font-mono text-xs">₱{info.getValue()}</span>
        ),
      }),
    ];
  }, [t]);

  const table = useReactTable({
    data: (tableProps.dataSource || []) as Product[],
    columns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (row) => row.treasureId,
    // 核心修改 3: 把动态数据通过 meta 传进去
    // 当 selectedRows 变化时，meta 更新，但 Table 不会彻底销毁重来
    meta: {
      relatedTitleId: value || null,
      setRelatedTitleId: (id: string) => onChange?.(id),
    } as TableMeta,
  });

  return (
    <div className="rounded-xl shadow-2xl w-[600px] max-w-[90vw] flex flex-col max-h-[85vh]">
      <div className="p-4 flex-1 overflow-y-auto space-y-4">
        <div className="flex gap-2">
          <Input
            placeholder={t('banners_searchProductPlaceholder')}
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

        <div className="overflow-x-auto rounded-xl border border-gray-100 dark:border-white/5">
          <Table>
            <TableHeader className="bg-gray-50/60 dark:bg-white/5">
              {table.getHeaderGroups().map((hg) => (
                <TableRow className="border-0" key={hg.id}>
                  {hg.headers.map((h) => (
                    <TableHead
                      key={h.id}
                      className="border-b border-gray-100 dark:border-white/5 text-gray-500 dark:text-gray-400 text-xs font-semibold uppercase tracking-wider"
                    >
                      {flexRender(h.column.columnDef.header, h.getContext())}
                    </TableHead>
                  ))}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody className="divide-y divide-gray-100 dark:divide-white/5 bg-white dark:bg-black/20">
              {table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  className="group hover:bg-gray-50 dark:hover:bg-white/5 transition-colors duration-150"
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id} className="py-2 px-4">
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext(),
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        {/* Pagination (Simplified) */}
        <div className="flex justify-between items-center text-xs text-gray-500">
          <span>
            {t('banners_total')}
            {tableProps.pagination.total}
          </span>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={tableProps.pagination.current === 1}
              onClick={() =>
                tableProps.pagination.onChange(
                  tableProps.pagination.current - 1,
                  5,
                )
              }
            >
              {t('banners_prev')}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={
                tableProps.pagination.current * 5 >= tableProps.pagination.total
              }
              onClick={() =>
                tableProps.pagination.onChange(
                  tableProps.pagination.current + 1,
                  5,
                )
              }
            >
              {t('banners_next')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
