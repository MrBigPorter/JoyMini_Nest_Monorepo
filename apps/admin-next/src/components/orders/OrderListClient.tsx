'use client';

import React, { useCallback, useMemo, useState } from 'react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { useQuery } from '@tanstack/react-query';
import { useRequest } from 'ahooks';
import { ModalManager } from '@repo/ui';
import { Truck, XCircle, Trash2, Eye } from 'lucide-react';
import dayjs from 'dayjs';
import { orderApi } from '@/api';
import { BaseTable } from '@/components/scaffold/BaseTable';
import { PageHeader } from '@/components/scaffold/PageHeader';
import { SchemaSearchForm } from '@/components/scaffold/SchemaSearchForm';
import { Badge, Button, Card, Input } from '@/components/UIComponents';
import { ORDER_STATUS_COLORS } from '@/consts';
import { useToastStore } from '@/store/useToastStore';
import type { FormSchema } from '@/type/search';
import type { Order, OrderSearchForm } from '@/type/types';
import { ORDER_STATUS, ORDER_STATUS_LABEL } from '@lucky/shared';
import {
  buildOrdersListParams,
  ordersListQueryKey,
  parseOrdersSearchParams,
} from '@/lib/cache/orders-cache';

interface OrderListClientProps {
  initialFormParams?: Record<string, unknown>;
  onParamsChange?: (params: Record<string, unknown>) => void;
}

export function OrderListClient({
  initialFormParams,
  onParamsChange,
}: OrderListClientProps) {
  const addToast = useToastStore((state) => state.addToast);

  const normalizedInitialQuery = useMemo(() => {
    const input = initialFormParams ?? {};
    return parseOrdersSearchParams({
      page: typeof input.page === 'string' ? input.page : undefined,
      pageSize: typeof input.pageSize === 'string' ? input.pageSize : undefined,
      keyword: typeof input.keyword === 'string' ? input.keyword : undefined,
      orderStatus:
        typeof input.orderStatus === 'string' ? input.orderStatus : undefined,
    });
  }, [initialFormParams]);

  const [pagination, setPagination] = useState({
    page: normalizedInitialQuery.page,
    pageSize: normalizedInitialQuery.pageSize,
  });
  const [filters, setFilters] = useState<OrderSearchForm>({
    keyword: normalizedInitialQuery.keyword ?? '',
    orderStatus:
      normalizedInitialQuery.orderStatus !== undefined
        ? String(normalizedInitialQuery.orderStatus)
        : 'ALL',
  });

  const ordersQueryInput = useMemo(
    () =>
      parseOrdersSearchParams({
        page: String(pagination.page),
        pageSize: String(pagination.pageSize),
        keyword: filters.keyword,
        orderStatus: filters.orderStatus,
      }),
    [
      filters.keyword,
      filters.orderStatus,
      pagination.page,
      pagination.pageSize,
    ],
  );

  const {
    data: ordersData,
    isFetching,
    refetch,
  } = useQuery({
    queryKey: ordersListQueryKey(ordersQueryInput),
    queryFn: async () => {
      const res = await orderApi.getList(
        buildOrdersListParams(ordersQueryInput),
      );
      return { list: res.list, total: res.total };
    },
    staleTime: 30_000,
  });

  const orders = ordersData?.list ?? [];
  const total = ordersData?.total ?? 0;

  const refresh = useCallback(async () => {
    await refetch();
  }, [refetch]);

  const { runAsync: updateStatusApi } = useRequest(orderApi.updateState, {
    manual: true,
  });
  const { runAsync: deleteOrderApi } = useRequest(orderApi.delete, {
    manual: true,
  });

  const invalidateOrdersCache = useCallback(async () => {
    const { revalidateOrdersList } =
      await import('@/lib/actions/orders-revalidate');
    await revalidateOrdersList();
  }, []);

  const handleUpdateStatus = useCallback(
    async (orderId: string, status: number) => {
      try {
        await updateStatusApi(orderId, status);
        addToast(
          'success',
          `Order status updated to ${ORDER_STATUS_LABEL[status]}`,
        );
        await refresh();
        void invalidateOrdersCache();
      } catch {
        addToast('error', 'Failed to update status');
      }
    },
    [addToast, updateStatusApi, refresh, invalidateOrdersCache],
  );

  const handleDelete = useCallback(
    async (orderId: string) => {
      ModalManager.open({
        title: 'Confirm Deletion',
        renderChildren: ({ close }) => (
          <div className="space-y-4">
            <p>
              Are you sure you want to delete this order? This action cannot be
              undone.
            </p>
            <div className="flex justify-end gap-2 mt-4">
              <Button variant="ghost" onClick={close}>
                Cancel
              </Button>
              <Button
                onClick={async () => {
                  try {
                    await deleteOrderApi(orderId);
                    addToast('success', 'Order deleted successfully');
                    await refresh();
                    void invalidateOrdersCache();
                    close();
                  } catch {
                    addToast('error', 'Failed to delete order');
                  }
                }}
              >
                Delete
              </Button>
            </div>
          </div>
        ),
      });
    },
    [addToast, deleteOrderApi, refresh, invalidateOrdersCache],
  );

  const openShippingModal = useCallback(
    (orderId: string) => {
      let trackingNumber = '';
      let courierName = '';

      ModalManager.open({
        title: 'Ship Order',
        renderChildren: ({ close }) => (
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">Courier Name</label>
              <Input
                onChange={(e) => {
                  courierName = e.target.value;
                }}
                placeholder="e.g. J&T, Lalamove"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Tracking Number</label>
              <Input
                onChange={(e) => {
                  trackingNumber = e.target.value;
                }}
                placeholder="e.g. 982173..."
              />
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <Button variant="ghost" onClick={close}>
                Cancel
              </Button>
              <Button
                onClick={() => {
                  void courierName;
                  void trackingNumber;
                  void handleUpdateStatus(orderId, ORDER_STATUS.SHIPPED);
                  close();
                }}
              >
                Confirm Shipment
              </Button>
            </div>
          </div>
        ),
      });
    },
    [handleUpdateStatus],
  );

  const handleOrderDetails = useCallback(
    (data: Order) => {
      ModalManager.open({
        title: `Order Details: ${data.orderNo}`,
        size: 'lg',
        renderChildren: ({ close }) => (
          <div className="space-y-6">
            <div>
              <h3 className="font-bold text-lg flex items-center gap-2">
                Status: {ORDER_STATUS_LABEL[data.orderStatus]}
              </h3>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <h4 className="font-semibold text-gray-500">Customer Info</h4>
                <p>Name: {data.user.nickname}</p>
                <p>Phone: {data.user.phone}</p>
              </div>
              <div className="space-y-2">
                <h4 className="font-semibold text-gray-500">Order Info</h4>
                <p>Product: {data.treasure.treasureName}</p>
                <p>Qty: {data.buyQuantity}</p>
                <p>Total: ₱{data.originalAmount.toLocaleString()}</p>
                <p>
                  Date: {dayjs(data.createdAt).format('MMM DD, YYYY HH:mm')}
                </p>
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-4 border-t border-gray-100 dark:border-white/5">
              <Button variant="ghost" onClick={close}>
                Close
              </Button>

              {/* Ship 按钮: Paid(3) 或 Ready to Ship(7) 均可发货 */}
              {[ORDER_STATUS.PAID, ORDER_STATUS.WAIT_DELIVERY].includes(
                data.orderStatus,
              ) && (
                <Button
                  onClick={() => {
                    close();
                    openShippingModal(data.orderId);
                  }}
                >
                  <Truck size={16} className="mr-2" /> Ship Order
                </Button>
              )}

              {/* 标记已完成: Shipped(8) 后可确认收货 */}
              {data.orderStatus === ORDER_STATUS.SHIPPED && (
                <Button
                  onClick={() =>
                    handleUpdateStatus(data.orderId, ORDER_STATUS.COMPLETED)
                  }
                >
                  Mark Completed
                </Button>
              )}

              {[
                ORDER_STATUS.PENDING_PAYMENT,
                ORDER_STATUS.PAID,
                ORDER_STATUS.WAIT_GROUP,
                ORDER_STATUS.WAIT_DELIVERY,
              ].includes(data.orderStatus) && (
                <Button
                  onClick={() =>
                    handleUpdateStatus(data.orderId, ORDER_STATUS.CANCELED)
                  }
                >
                  <XCircle size={16} className="mr-2" /> Cancel Order
                </Button>
              )}
            </div>
          </div>
        ),
      });
    },
    [handleUpdateStatus, openShippingModal],
  );

  const columns: ColumnDef<Order>[] = useMemo(() => {
    const columnsHelper = createColumnHelper<Order>();
    return [
      columnsHelper.accessor('orderNo', {
        header: 'Order No.',
        cell: (info) => <span className="font-medium">{info.getValue()}</span>,
      }),
      columnsHelper.accessor('createdAt', {
        header: 'Date',
        cell: (info) => (
          <span className="text-gray-500 text-xs">
            {dayjs(info.getValue()).format('YYYY-MM-DD HH:mm')}
          </span>
        ),
      }),
      columnsHelper.accessor('user.nickname', {
        header: 'Customer',
        cell: (info) => (
          <div className="flex flex-col">
            <span>{info.getValue()}</span>
            <span className="text-xs text-gray-400">
              {info.row.original.user.phone}
            </span>
          </div>
        ),
      }),
      columnsHelper.accessor('treasure.treasureName', {
        header: 'Product',
      }),
      columnsHelper.accessor('originalAmount', {
        header: 'Total',
        cell: (info) => (
          <span className="font-mono font-bold">
            ₱{info.getValue().toLocaleString()}
          </span>
        ),
      }),
      columnsHelper.accessor('orderStatus', {
        header: 'Status',
        cell: (info) => {
          const status = info.getValue();
          const color = ORDER_STATUS_COLORS[status] || 'gray';
          return <Badge color={color}>{ORDER_STATUS_LABEL[status]}</Badge>;
        },
      }),
      columnsHelper.display({
        id: 'actions',
        header: 'Actions',
        cell: (info) => (
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => handleOrderDetails(info.row.original)}
            >
              <Eye size={16} />
            </Button>
            {[ORDER_STATUS.CANCELED, ORDER_STATUS.REFUNDED].includes(
              info.row.original.orderStatus,
            ) && (
              <Button
                size="sm"
                variant="ghost"
                className="text-red-500 hover:bg-red-50"
                onClick={() => handleDelete(info.row.original.orderId)}
              >
                <Trash2 size={16} />
              </Button>
            )}
          </div>
        ),
      }),
    ] as ColumnDef<Order>[];
  }, [handleDelete, handleOrderDetails]);

  const searchSchema: FormSchema[] = useMemo(
    () => [
      {
        type: 'input',
        key: 'keyword',
        label: 'Search',
        placeholder: 'Order No, Nickname, Phone',
      },
      {
        type: 'select',
        key: 'orderStatus',
        label: 'Status',
        defaultValue: 'ALL',
        options: [
          { label: 'All', value: 'ALL' },
          ...Object.entries(ORDER_STATUS_LABEL).map(([key, label]) => ({
            label,
            value: key,
          })),
        ],
      },
    ],
    [],
  );

  const handleSearch = useCallback(
    (values: OrderSearchForm) => {
      setFilters(values);
      setPagination((prev) => ({ ...prev, page: 1 }));
      onParamsChange?.({
        keyword: values.keyword,
        orderStatus: values.orderStatus,
        page: 1,
        pageSize: pagination.pageSize,
      });
    },
    [onParamsChange, pagination.pageSize],
  );

  const handleReset = useCallback(() => {
    const nextFilters = { keyword: '', orderStatus: 'ALL' };
    setFilters(nextFilters);
    setPagination((prev) => ({ ...prev, page: 1 }));
    onParamsChange?.({
      ...nextFilters,
      page: 1,
      pageSize: pagination.pageSize,
    });
  }, [onParamsChange, pagination.pageSize]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Order Management"
        description="Track, update, and manage customer orders."
      />
      <Card>
        <div className="mb-6">
          <SchemaSearchForm<OrderSearchForm>
            initialValues={filters}
            schema={searchSchema}
            onSearch={handleSearch}
            onReset={handleReset}
            loading={isFetching}
          />
        </div>
        <BaseTable
          columns={columns}
          data={orders}
          loading={isFetching}
          rowKey="orderId"
          pagination={{
            current: pagination.page,
            pageSize: pagination.pageSize,
            total,
            onChange: (page, pageSize) => {
              setPagination({ page, pageSize });
              onParamsChange?.({
                keyword: filters.keyword,
                orderStatus: filters.orderStatus,
                page,
                pageSize,
              });
            },
          }}
        />
      </Card>
    </div>
  );
}
