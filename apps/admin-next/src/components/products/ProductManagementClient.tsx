'use client';

import React, { useCallback, useRef, useMemo } from 'react';
import {
  Edit3,
  Trash2,
  Ban,
  CheckCircle,
  RotateCcw,
  Truck,
  Package,
  Users,
  Gift,
  Clock,
  Calendar,
  Bot,
} from 'lucide-react';
import {
  SmartTable,
  ProColumns,
  ActionType,
} from '@/components/scaffold/SmartTable';
import { productApi, categoryApi } from '@/api';
import type { Product, BonusConfig, ProductListParams } from '@/type/types';
import {
  Button,
  ModalManager,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  Badge,
} from '@repo/ui';
import { CreateProductFormModal } from '@/views/product/CreateProductFormModal';
import { EditProductFormModal } from '@/views/product/EditProductFormModal';
import { TREASURE_STATE, TreasureFilterType } from '@lucky/shared';
import { useToastStore } from '@/store/useToastStore';
import { SmartImage } from '@/components/ui/SmartImage';
import { format, formatDistanceToNow } from 'date-fns';
import { Card } from '@/components/UIComponents';
import { useRequest } from 'ahooks';
import { PageHeader } from '@/components/scaffold/PageHeader';
import { FormSchema } from '@/type/search';
import {
  buildProductsListParams,
  parseProductsSearchParams,
  productsListQueryKey,
} from '@/lib/cache/products-cache';

// -----------------------------------------------------------------------------
// 辅助函数
// -----------------------------------------------------------------------------
const getOperationStatus = (product: Product) => {
  if (product.state !== TREASURE_STATE.ACTIVE) {
    return { label: 'Offline', color: 'gray', icon: <Ban size={12} /> };
  }
  const now = Date.now();
  const start = product.salesStartAt || 0;
  const end = product.salesEndAt || 0;
  const isSoldOut = product.buyQuantityRate >= 100;

  if (isSoldOut)
    return { label: 'Sold Out', color: 'red', icon: <Package size={12} /> };
  if (end > 0 && now > end)
    return { label: 'Ended', color: 'gray', icon: <Calendar size={12} /> };
  if (start > 0 && now < start)
    return { label: 'Pre-sale', color: 'blue', icon: <Clock size={12} /> };
  return { label: 'On Sale', color: 'green', icon: <CheckCircle size={12} /> };
};

const BonusTag = ({ config }: { config?: BonusConfig }) => {
  if (!config) return null;
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-purple-50 text-purple-700 border border-purple-200 cursor-help transition-colors hover:bg-purple-100">
            <Gift size={10} />
            Bonus
          </span>
        </TooltipTrigger>
        <TooltipContent>
          <div className="text-xs">
            <div className="font-bold mb-1 text-purple-700">Gift Config:</div>
            <div>Name: {config.bonusItemName}</div>
            <div>Winners: {config.winnerCount}</div>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

const DateRangeDisplay = ({ start, end }: { start?: number; end?: number }) => {
  if (!start && !end) return <span className="text-gray-300">-</span>;
  return (
    <div className="flex flex-col text-[10px] text-gray-500 font-mono leading-tight gap-0.5">
      {start && (
        <div className="flex items-center gap-1" title="Sales Start">
          <span className="text-green-600 font-bold w-2">S</span>
          {format(new Date(start), 'MM-dd HH:mm')}
        </div>
      )}
      {end && (
        <div className="flex items-center gap-1" title="Sales End">
          <span className="text-red-600 font-bold w-2">E</span>
          {format(new Date(end), 'MM-dd HH:mm')}
        </div>
      )}
    </div>
  );
};

// -----------------------------------------------------------------------------
// 主组件
// -----------------------------------------------------------------------------
interface ProductManagementProps {
  // Phase 3: URL searchParams 驱动 filter
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  initialFormParams?: Record<string, any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onParamsChange?: (params: Record<string, any>) => void;
}

export const ProductManagement: React.FC<ProductManagementProps> = ({
  initialFormParams,
  onParamsChange,
}) => {
  const actionRef = useRef<ActionType>(null);
  const addToast = useToastStore((state) => state.addToast);

  const normalizedInitialFormParams = useMemo(() => {
    const input = initialFormParams ?? {};
    return parseProductsSearchParams({
      page: typeof input.page === 'string' ? input.page : undefined,
      pageSize: typeof input.pageSize === 'string' ? input.pageSize : undefined,
      treasureName:
        typeof input.treasureName === 'string' ? input.treasureName : undefined,
      categoryId:
        typeof input.categoryId === 'string' ? input.categoryId : undefined,
      filterType:
        typeof input.filterType === 'string' ? input.filterType : undefined,
    });
  }, [initialFormParams]);

  const hydrationQueryKey = useMemo(
    () => productsListQueryKey(normalizedInitialFormParams),
    [normalizedInitialFormParams],
  );

  // 1. 数据请求
  const { data: categories = [] } = useRequest(categoryApi.getCategories);

  const { runAsync: deleteProductRun } = useRequest(productApi.deleteProduct, {
    manual: true,
  });
  const { runAsync: updateStateRun } = useRequest(
    productApi.updateProductState,
    { manual: true },
  );
  const { runAsync: purgeCacheRun, loading: purgeLoading } = useRequest(
    productApi.pureHomeCache,
    { manual: true },
  );

  const handlePurgeCache = useCallback(async () => {
    await purgeCacheRun();
    addToast('success', 'Home cache purged successfully.');
  }, [purgeCacheRun, addToast]);

  const handleCreate = useCallback(() => {
    ModalManager.open({
      title: 'Create Product',
      size: 'xl',
      onConfirm: () => actionRef.current?.reload(),
      renderChildren: ({ confirm }) => (
        <CreateProductFormModal categories={categories} confirm={confirm} />
      ),
    });
  }, [categories]);

  const handleEdit = useCallback(
    (record: Product) => {
      ModalManager.open({
        title: 'Edit Product',
        size: 'xl',
        onConfirm: () => actionRef.current?.reload(),
        renderChildren: ({ confirm }) => (
          <EditProductFormModal
            categories={categories}
            confirm={confirm}
            product={record}
          />
        ),
      });
    },
    [categories],
  );

  const handleDelete = useCallback(
    (record: Product) => {
      ModalManager.open({
        title: 'Are you sure?',
        content: `Delete product "${record.treasureName}"? This cannot be undone.`,
        onConfirm: async () => {
          await deleteProductRun(record.treasureId);
          addToast('success', 'Product deleted');
          actionRef.current?.reload();
        },
      });
    },
    [deleteProductRun, addToast],
  );

  const handleToggleState = useCallback(
    (record: Product) => {
      const isOnline = record.state === TREASURE_STATE.ACTIVE;
      ModalManager.open({
        title: isOnline ? 'Take Offline?' : 'Put Online?',
        content: isOnline
          ? 'Users will not see this product anymore.'
          : 'Users will be able to buy this product immediately.',
        onConfirm: async () => {
          const newState = isOnline
            ? TREASURE_STATE.INACTIVE
            : TREASURE_STATE.ACTIVE;
          await updateStateRun(record.treasureId, newState);
          addToast(
            'success',
            `Product is now ${isOnline ? 'offline' : 'online'}`,
          );
          actionRef.current?.reload();
        },
      });
    },
    [updateStateRun, addToast],
  );

  // 3. Columns 定义 (已更新价格结构和机器人图标)
  const columns: ProColumns<Product>[] = useMemo(
    () => [
      {
        title: 'Product Info',
        dataIndex: 'treasureName',
        width: 280,
        render: (_, row) => {
          const isGroup = (row.groupSize || 0) > 1;
          const isReal = row.shippingType === 1;
          return (
            <div className="flex items-start gap-3 group">
              <div className="relative w-12 h-12 min-w-[48px] rounded-lg bg-gray-100 dark:bg-gray-800 overflow-hidden border border-gray-200 dark:border-gray-700">
                <SmartImage
                  src={row.treasureCoverImg}
                  width={48}
                  height={48}
                  className="w-full h-full object-cover"
                />
                <div className="absolute top-0 left-0 flex flex-col gap-0.5 p-0.5 pointer-events-none">
                  {isGroup && (
                    <div className="bg-orange-500/90 text-white p-[2px] rounded-[3px] shadow-sm backdrop-blur-sm">
                      <Users size={10} strokeWidth={3} />
                    </div>
                  )}
                  {isReal && (
                    <div className="bg-blue-500/90 text-white p-[2px] rounded-[3px] shadow-sm backdrop-blur-sm">
                      <Truck size={10} strokeWidth={3} />
                    </div>
                  )}
                </div>
              </div>
              <div className="flex flex-col gap-1 min-w-0 flex-1">
                <div
                  className="font-medium text-gray-900 dark:text-gray-100 text-sm line-clamp-1 group-hover:text-blue-600 transition-colors cursor-default"
                  title={row.treasureName}
                >
                  {row.treasureName}
                </div>
                <div className="flex flex-wrap gap-2 items-center">
                  <span className="text-[10px] text-gray-400 font-mono select-all">
                    ID: {row.treasureId.slice(-6)}
                  </span>
                  <BonusTag config={row.bonusConfig} />
                  {isGroup && (
                    <Badge
                      variant="outline"
                      className="text-[10px] px-1 py-0 h-auto border-orange-200 text-orange-700 bg-orange-50"
                    >
                      {row.groupSize}P Group
                    </Badge>
                  )}
                  {/*  机器人状态标签 */}
                  {row.enableRobot && (
                    <Badge
                      variant="outline"
                      className="text-[10px] px-1 py-0 h-auto border-cyan-200 text-cyan-700 bg-cyan-50 gap-1"
                      title="Robot Auto-fill Enabled"
                    >
                      <Bot size={10} /> Auto
                    </Badge>
                  )}
                </div>
              </div>
            </div>
          );
        },
      },
      {
        title: 'Progress',
        dataIndex: 'buyQuantityRate',
        width: 140,
        render: (val, row) => {
          const value = Number(val);
          return (
            <div className="w-full max-w-[120px]">
              <div className="flex justify-between text-xs mb-1">
                <span
                  className={`font-bold ${value >= 100 ? 'text-red-500' : 'text-gray-900 dark:text-gray-100'}`}
                >
                  {val}%
                </span>
                <span className="text-gray-400 text-[10px] font-mono">
                  {row.seqBuyQuantity}/{row.seqShelvesQuantity}
                </span>
              </div>
              <div className="h-1.5 w-full bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ease-out ${
                    value >= 100 ? 'bg-red-500' : 'bg-orange-500'
                  }`}
                  style={{ width: `${Math.min(value, 100)}%` }}
                />
              </div>
            </div>
          );
        },
      },
      {
        title: 'Price Structure', // 更新了列标题
        dataIndex: 'unitAmount',
        width: 150, // 更新了宽度
        render: (val, row) => (
          <div className="flex flex-col gap-0.5">
            {/* 1. 核心拼团价 */}
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-gray-500 uppercase">Group</span>
              <span className="font-mono text-sm font-bold text-red-600">
                ₱{val}
              </span>
            </div>

            {/* 2. 单独购买价 (如果有) */}
            {row.soloAmount !== undefined && row.soloAmount !== null && (
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-gray-400">Solo</span>
                <span className="font-mono text-xs text-gray-700 dark:text-gray-300">
                  ₱{row.soloAmount}
                </span>
              </div>
            )}

            {/* 3. 市场划线价 (如果有) */}
            {row.marketAmount !== undefined && row.marketAmount !== null && (
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-gray-400">MSRP</span>
                <span className="font-mono text-[10px] text-gray-400 line-through">
                  ₱{row.marketAmount}
                </span>
              </div>
            )}

            {/* 4. 成本价 (虚线分隔) */}
            <div className="mt-1 pt-1 border-t border-dashed border-gray-200 dark:border-gray-700 flex items-center justify-between opacity-50 hover:opacity-100 transition-opacity">
              <span className="text-[10px] text-gray-400">Cost</span>
              <span className="text-[10px] font-mono text-gray-400">
                ₱{row.costAmount}
              </span>
            </div>
          </div>
        ),
      },
      {
        title: 'Status / Time',
        width: 180,
        render: (_, row) => {
          const status = getOperationStatus(row);
          return (
            <div className="flex flex-col gap-1.5 items-start">
              <Badge
                variant="secondary"
                className={`flex items-center gap-1.5 pl-1.5 pr-2 py-0.5 bg-${status.color}-100 text-${status.color}-700 border-${status.color}-200`}
              >
                {status.icon}
                <span className="uppercase tracking-wide text-[10px] font-bold">
                  {status.label}
                </span>
              </Badge>
              <DateRangeDisplay start={row.salesStartAt} end={row.salesEndAt} />
              {status.label === 'Pre-sale' && row.salesStartAt && (
                <span className="text-[10px] text-blue-600 bg-blue-50 px-1 rounded font-medium">
                  Starts{' '}
                  {formatDistanceToNow(row.salesStartAt, { addSuffix: true })}
                </span>
              )}
            </div>
          );
        },
      },
      {
        title: 'Actions',
        width: 120,
        valueType: 'option',
        render: (_, row) => (
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0 text-gray-400 hover:text-blue-600 hover:bg-blue-50"
              onClick={() => handleEdit(row)}
            >
              <Edit3 size={16} />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className={`h-8 w-8 p-0 ${
                row.state === TREASURE_STATE.ACTIVE
                  ? 'text-gray-400 hover:text-orange-600 hover:bg-orange-50'
                  : 'text-gray-400 hover:text-green-600 hover:bg-green-50'
              }`}
              onClick={() => handleToggleState(row)}
            >
              {row.state === TREASURE_STATE.ACTIVE ? (
                <Ban size={16} />
              ) : (
                <CheckCircle size={16} />
              )}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0 text-gray-400 hover:text-red-600 hover:bg-red-50"
              onClick={() => handleDelete(row)}
            >
              <Trash2 size={16} />
            </Button>
          </div>
        ),
      },
    ],
    [handleEdit, handleDelete, handleToggleState],
  );

  // 4. 配置搜索表单
  const searchSchema: FormSchema[] = useMemo(
    () => [
      {
        type: 'input',
        key: 'treasureName',
        label: 'Product Name',
        placeholder: 'Search name or ID...',
      },
      {
        type: 'select',
        key: 'categoryId',
        label: 'Category',
        defaultValue: 'ALL',
        options: [
          { label: 'All Categories', value: 'ALL' },
          ...categories.map((c) => ({ label: c.name, value: String(c.id) })),
        ],
      },
      {
        type: 'select',
        key: 'filterType',
        label: 'Filter Type',
        defaultValue: 'ALL',
        options: [
          ...Object.keys(TreasureFilterType)
            .filter((k) => isNaN(Number(k)))
            .map((type) => ({ label: type.replace(/_/g, ' '), value: type })),
        ],
      },
    ],
    [categories],
  );

  const requestProducts = useCallback(async (params: ProductListParams) => {
    const input = params as unknown as Record<string, unknown>;
    const queryInput = parseProductsSearchParams({
      page: String(params.page ?? 1),
      pageSize: String(params.pageSize ?? 10),
      treasureName:
        typeof input.treasureName === 'string' ? input.treasureName : undefined,
      categoryId:
        typeof input.categoryId === 'string' ||
        typeof input.categoryId === 'number'
          ? String(input.categoryId)
          : undefined,
      filterType:
        typeof input.filterType === 'string' ? input.filterType : undefined,
    });

    try {
      const res = await productApi.getProducts(
        buildProductsListParams(queryInput) as ProductListParams,
      );
      return {
        data: res.list,
        total: res.total,
        success: true,
      };
    } catch (e) {
      return { data: [], total: 0, success: false };
    }
  }, []);

  const toolBarRender = useCallback(
    () => [
      <Button
        key="purge"
        variant="outline"
        isLoading={purgeLoading}
        onClick={handlePurgeCache}
      >
        <RotateCcw size={14} className="mr-2" />
        Purge Cache
      </Button>,
      <Button key="add" onClick={handleCreate}>
        + Add Product
      </Button>,
    ],
    [purgeLoading, handlePurgeCache, handleCreate],
  );

  return (
    <div className="p-4">
      <PageHeader
        title="Product Management"
        description="Manage your products available in the mini shop."
        action={toolBarRender()}
      />
      <Card>
        <SmartTable<Product>
          ref={actionRef}
          rowKey="treasureId"
          headerTitle={
            <div className="flex items-center justify-between w-full">
              <div className="flex items-center gap-2">
                <Package className="text-primary-500" size={20} />
                <span className="font-semibold text-lg">Products</span>
              </div>
            </div>
          }
          columns={columns}
          request={requestProducts}
          searchSchema={searchSchema}
          initialFormParams={normalizedInitialFormParams}
          onParamsChange={onParamsChange}
          enableHydration={true}
          hydrationQueryKey={hydrationQueryKey}
        />
      </Card>
    </div>
  );
};
