'use client';

import React, { useMemo, useState, useEffect } from 'react';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  Checkbox,
} from '@repo/ui';
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  Row,
  SortingState,
  getSortedRowModel,
  getExpandedRowModel,
  RowSelectionState,
  ColumnDef,
} from '@tanstack/react-table';
import {
  DndContext,
  closestCenter,
  useSensor,
  useSensors,
  PointerSensor,
  KeyboardSensor,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable';
import { Pagination } from '@/components/scaffold/Pagination';
import { Loader2, ArrowUpDown, ChevronRight, ChevronDown } from 'lucide-react';
import { cn } from '@repo/ui';

// ----------------------------------------------------------------------------
// 1. 内部组件：SortableRowWrapper
// ----------------------------------------------------------------------------
interface SortableRowWrapperProps {
  rowId: string;
  children: React.ReactNode;
  onClick?: () => void;
}

const SortableRowWrapper = ({
  rowId,
  children,
  onClick,
}: SortableRowWrapperProps) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: rowId });

  const style: React.CSSProperties = {
    transform: transform
      ? `translate3d(${transform.x}px, ${transform.y}px, 0)`
      : undefined,
    transition,
    opacity: isDragging ? 0.8 : 1,
    position: 'relative',
    zIndex: isDragging ? 10 : 1,
  };

  return (
    <tr
      ref={setNodeRef}
      style={style}
      className={cn(
        'bg-white dark:bg-gray-950 transition-colors',
        isDragging && 'shadow-xl',
      )}
      onClick={onClick}
      {...attributes}
    >
      {React.Children.map(children, (child) => {
        //  修复：移除 any，使用 ReactElement 类型断言
        if (React.isValidElement(child)) {
          const props = child.props as { 'data-drag-handle'?: boolean };
          // eslint-disable-next-line react/prop-types
          if (props['data-drag-handle']) {
            return React.cloneElement(child, { ...listeners });
          }
        }
        return child;
      })}
    </tr>
  );
};

// ----------------------------------------------------------------------------
// 2. 内部组件：TableRowImpl
// ----------------------------------------------------------------------------
interface TableRowImplProps<TData> {
  row: Row<TData>;
  enableDrag: boolean;
  onClick?: () => void;
  renderSubComponent?: (props: { row: Row<TData> }) => React.ReactNode;
  isSelected: boolean;
  isExpanded: boolean;
}

const TableRowImpl = <TData,>({
  row,
  enableDrag,
  onClick,
  renderSubComponent,
  isSelected,
  isExpanded,
}: TableRowImplProps<TData>) => {
  const cells = row.getVisibleCells().map((cell) => {
    const content = flexRender(cell.column.columnDef.cell, cell.getContext());
    const isDragHandle = cell.column.id === 'dragHandle';

    return (
      <TableCell
        key={cell.id}
        style={{ width: cell.column.getSize() }}
        className="border-b border-gray-100 dark:border-white/5 py-3"
        // ✅ 修复：类型安全的属性传递
        {...(isDragHandle ? { 'data-drag-handle': true } : {})}
      >
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        {content as any}
      </TableCell>
    );
  });

  const rowContent = enableDrag ? (
    <SortableRowWrapper rowId={row.id} onClick={onClick}>
      {cells}
    </SortableRowWrapper>
  ) : (
    <TableRow
      className={cn(
        'group hover:bg-gray-50 dark:hover:bg-white/5 cursor-pointer transition-colors',
        isSelected && 'bg-blue-50/50 dark:bg-blue-900/10',
      )}
      onClick={onClick}
    >
      {cells}
    </TableRow>
  );

  return (
    <>
      {rowContent}
      {isExpanded && renderSubComponent && (
        <TableRow className="bg-gray-50/50">
          <TableCell
            colSpan={row.getVisibleCells().length}
            className="p-0 border-b"
          >
            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
            {renderSubComponent({ row }) as any}
          </TableCell>
        </TableRow>
      )}
    </>
  );
};

// ✅ 修复：使用泛型 Memo 组件，解决类型丢失问题
const MemoizedTableRow = React.memo(TableRowImpl, (prev, next) => {
  return (
    prev.row.original === next.row.original &&
    prev.isSelected === next.isSelected &&
    prev.isExpanded === next.isExpanded &&
    prev.enableDrag === next.enableDrag
  );
}) as typeof TableRowImpl;

// ----------------------------------------------------------------------------
// 3. 主组件：BaseTable
// ----------------------------------------------------------------------------
interface BaseTableProps<TData> {
  data: TData[];
  // ✅ 修复：columns 类型不再是 any
  columns: ColumnDef<TData, unknown>[];
  loading?: boolean;
  rowKey?: keyof TData;
  pagination?: {
    current: number;
    pageSize: number;
    total: number;
    onChange: (page: number, pageSize: number) => void;
  };
  enableDrag?: boolean;
  onDragEnd?: (event: DragEndEvent) => void;
  selectable?: boolean;
  onSelectionChange?: (selectedRows: TData[]) => void;
  expandable?: boolean;
  renderSubComponent?: (props: { row: Row<TData> }) => React.ReactNode;
  onRowClick?: (row: TData) => void;
  defaultSelectedRowKeys?: string[];
  disabledRowKeys?: string[];
}

// ✅ 修复：使用泛型 TData 替代 Record<string, any>
export const BaseTable = <TData,>({
  data,
  columns: propColumns,
  loading,
  rowKey = 'id' as keyof TData,
  pagination,
  enableDrag = false,
  onDragEnd,
  selectable = false,
  onSelectionChange,
  expandable = false,
  renderSubComponent,
  onRowClick,
  defaultSelectedRowKeys = [],
  disabledRowKeys = [],
}: BaseTableProps<TData>) => {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});

  // --- 初始化默认选中 ---
  useEffect(() => {
    if (defaultSelectedRowKeys.length > 0) {
      const initial: RowSelectionState = {};
      defaultSelectedRowKeys.forEach((key) => {
        initial[key] = true;
      });
      setRowSelection(initial);
    }
  }, [defaultSelectedRowKeys]);

  // --- 构造列定义 ---
  const columns = useMemo(() => {
    const cols = [...propColumns];
    if (selectable) {
      cols.unshift({
        id: 'select',
        header: ({ table }) => (
          <div
            onClick={(e) => e.stopPropagation()}
            className="flex items-center justify-center"
          >
            <Checkbox
              checked={
                table.getIsAllPageRowsSelected() ||
                (table.getIsSomePageRowsSelected() && 'indeterminate')
              }
              onCheckedChange={(value) =>
                table.toggleAllPageRowsSelected(!!value)
              }
              aria-label="Select all"
            />
          </div>
        ),
        cell: ({ row }) => (
          <div
            onClick={(e) => e.stopPropagation()}
            className="flex items-center justify-center"
          >
            <Checkbox
              checked={row.getIsSelected()}
              disabled={!row.getCanSelect()}
              onCheckedChange={(value) => row.toggleSelected(!!value)}
              aria-label="Select row"
            />
          </div>
        ),
        size: 40,
        enableSorting: false,
      });
    }

    if (expandable) {
      cols.unshift({
        id: 'expander',
        header: () => null,
        cell: ({ row }) =>
          row.getCanExpand() ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                row.toggleExpanded();
              }}
              className="p-1 hover:bg-gray-100 rounded text-gray-500 transition-colors"
            >
              {row.getIsExpanded() ? (
                <ChevronDown size={16} />
              ) : (
                <ChevronRight size={16} />
              )}
            </button>
          ) : null,
        size: 30,
      });
    }
    return cols;
  }, [propColumns, selectable, expandable]);

  // --- 初始化 Table 实例 ---
  const table = useReactTable({
    data,
    columns,
    state: { sorting, rowSelection },
    onSortingChange: setSorting,
    onRowSelectionChange: setRowSelection,

    //  修复：getRowId 类型安全
    getRowId: (row) => {
      // 安全地尝试获取 ID
      const id =
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (row as any)[rowKey] ?? (row as any).id ?? (row as any).treasureId;
      if (id === undefined) {
        // 避免使用 Math.random() 防止 Hydration 错误，使用确定的 UUID 或空字符串
        return `missing-id-${JSON.stringify(row).length}`;
      }
      return String(id);
    },

    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
    enableRowSelection: (row) => {
      const id = row.id;
      return !(disabledRowKeys && disabledRowKeys.includes(id));
    },
  });

  // --- 选中回调 ---
  useEffect(() => {
    if (onSelectionChange) {
      onSelectionChange(
        table.getSelectedRowModel().rows.map((r) => r.original),
      );
    }
  }, [rowSelection, onSelectionChange, table]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const rowIds = useMemo(
    () => table.getRowModel().rows.map((r) => r.id),
    [table],
  );

  // --- 渲染表体内容 ---
  const renderTableContent = () => {
    if (loading && data.length === 0) {
      return (
        <TableRow>
          <TableCell colSpan={columns.length} className="h-40 text-center">
            <Loader2 className="animate-spin inline-block w-6 h-6 text-gray-400" />
          </TableCell>
        </TableRow>
      );
    }
    if (data.length === 0) {
      return (
        <TableRow>
          <TableCell
            colSpan={columns.length}
            className="h-40 text-center text-gray-500 dark:text-gray-400"
          >
            No data available.
          </TableCell>
        </TableRow>
      );
    }

    const rows = table
      .getRowModel()
      .rows.map((row) => (
        <MemoizedTableRow
          key={row.id}
          row={row}
          enableDrag={enableDrag}
          isSelected={row.getIsSelected()}
          isExpanded={row.getIsExpanded()}
          renderSubComponent={renderSubComponent}
          onClick={() => onRowClick?.(row.original)}
        />
      ));

    if (enableDrag) {
      return (
        <SortableContext items={rowIds} strategy={verticalListSortingStrategy}>
          {rows}
        </SortableContext>
      );
    }
    return rows;
  };

  const tableNode = (
    <div className="overflow-x-auto rounded-xl border border-gray-100 dark:border-white/10">
      <Table className="w-full border-separate border-spacing-0">
        <TableHeader className="bg-gray-50/80 dark:bg-white/5">
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id} className="border-0">
              {headerGroup.headers.map((header) => (
                <TableHead
                  key={header.id}
                  style={{ width: header.getSize() }}
                  className="h-11 px-4 text-gray-500 dark:text-gray-300"
                >
                  {header.isPlaceholder ? null : (
                    <div
                      className={cn(
                        'flex items-center gap-2',
                        header.column.getCanSort() &&
                          'cursor-pointer select-none hover:text-gray-900 dark:hover:text-gray-100',
                      )}
                      onClick={header.column.getToggleSortingHandler()}
                    >
                      {flexRender(
                        header.column.columnDef.header,
                        header.getContext(),
                      )}
                      {header.column.getCanSort() && <ArrowUpDown size={12} />}
                    </div>
                  )}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody className="dark:divide-white/5 bg-white dark:bg-gray-900 [&_tr:last-child_td]:border-b-0">
          {renderTableContent()}
        </TableBody>
      </Table>
    </div>
  );

  return (
    <div className="space-y-4">
      {enableDrag && onDragEnd ? (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={onDragEnd}
        >
          {tableNode}
        </DndContext>
      ) : (
        tableNode
      )}
      {pagination && (
        <div className="py-2">
          <Pagination {...pagination} />
        </div>
      )}
    </div>
  );
};
