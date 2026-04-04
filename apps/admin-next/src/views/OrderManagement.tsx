'use client';

import React, { useCallback, useMemo } from 'react';
import { Truck, XCircle, Trash2, Eye } from 'lucide-react';
import { Card, Button, Badge, Input } from '@/components/UIComponents'; // Assuming Input exists
import { useToastStore } from '@/store/useToastStore';
import { Order, OrderListParams, OrderSearchForm } from '@/type/types';
import { PageHeader } from '@/components/scaffold/PageHeader';
import { SchemaSearchForm } from '@/components/scaffold/SchemaSearchForm';
import { useAntdTable, useRequest } from 'ahooks';
import { orderApi } from '@/api';
import { createColumnHelper, ColumnDef } from '@tanstack/react-table';
import { ORDER_STATUS, ORDER_STATUS_LABEL } from '@lucky/shared';
import { BaseTable } from '@/components/scaffold/BaseTable';
import { ModalManager } from '@repo/ui';
import dayjs from 'dayjs';
import { ORDER_STATUS_COLORS } from '@/consts'; // Recommended for date formatting

export const OrderManagement: React.FC = () => {
  const addToast = useToastStore((state) => state.addToast);

  // 6. Data Fetching
  const getTableData = async (
    { current, pageSize }: { current: number; pageSize: number },
    formData: OrderSearchForm,
  ) => {
    const params: OrderListParams = { page: current, pageSize };
    if (formData?.keyword) params.keyword = formData.keyword;
    if (formData?.orderStatus && formData?.orderStatus !== 'All')
      params.orderStatus = Number(formData.orderStatus);

    const res = await orderApi.getList(params);
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
      { keyword: '', orderStatus: 'All' },
    ],
  });

  // 1. API Hooks for Actions
  const { runAsync: updateStatusApi } = useRequest(orderApi.updateState, {
    manual: true,
  });
  const { runAsync: deleteOrderApi } = useRequest(orderApi.delete, {
    manual: true,
  });

  // 2. Logic: Handle Status Updates
  const handleUpdateStatus = useCallback(
    async (orderId: string, status: number) => {
      try {
        await updateStatusApi(orderId, status);
        addToast(
          'success',
          `Order status updated to ${ORDER_STATUS_LABEL[status]}`,
        );
        refresh(); // Refresh table
      } catch (error) {
        addToast('error', 'Failed to update status');
      }
    },
    [addToast, updateStatusApi, refresh],
  );

  // 3. Logic: Handle Delete
  const handleDelete = useCallback(
    (orderId: string) => {
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
                    refresh();
                    close();
                  } catch (error) {
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
    [addToast, deleteOrderApi, refresh],
  );

  // 4. Interaction: Open Shipping Modal
  const openShippingModal = useCallback(
    (orderId: string) => {
      ModalManager.open({
        title: 'Ship Order',
        renderChildren: ({ close }) => (
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">Courier Name</label>
              <Input disabled placeholder="e.g. J&T, Lalamove" />
            </div>
            <div>
              <label className="text-sm font-medium">Tracking Number</label>
              <Input disabled placeholder="e.g. 982173..." />
            </div>
            <p className="text-xs text-gray-500">
              Shipping detail editing is not wired yet. Confirm will mark the
              order as shipped.
            </p>
            <div className="flex justify-end gap-2 mt-4">
              <Button variant="ghost" onClick={close}>
                Cancel
              </Button>
              <Button
                onClick={() => {
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

  // 5. Interaction: Order Details View
  const handleOrderDetails = useCallback(
    (data: Order) => {
      ModalManager.open({
        title: `Order Details: ${data.orderNo}`,
        size: 'lg', // Assuming your modal supports sizes
        renderChildren: ({ close }) => (
          <div className="space-y-6">
            {/* Section: Status Banner */}
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
                {/*<p>Address: {data.deliveryAddress || 'N/A'}</p>*/}
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

            {/* Section: Action Buttons (Conditional) */}
            <div className="flex justify-end gap-3 pt-4 border-t border-gray-100 dark:border-white/5">
              <Button variant="ghost" onClick={close}>
                Close
              </Button>

              {/* Logic: Only show Ship button if Paid */}
              {data.orderStatus === ORDER_STATUS.PAID && (
                <Button
                  onClick={() => {
                    close();
                    openShippingModal(data.orderId);
                  }}
                >
                  <Truck size={16} className="mr-2" /> Ship Order
                </Button>
              )}

              {/* Logic: Only show Deliver button if Shipped */}
              {/*{data.orderStatus === ORDER_STATUS.SHIPPED && (
                <Button
                  onClick={() =>
                    handleUpdateStatus(data.orderId, ORDER_STATUS.RECEIVED)
                  }
                >
                  <CheckCircle size={16} className="mr-2" /> Mark Delivered
                </Button>
              )}*/}

              {/* Logic: Allow Cancel only if Pending or Paid */}
              {[ORDER_STATUS.PENDING_PAYMENT, ORDER_STATUS.PAID].includes(
                data.orderStatus,
              ) && (
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

  // 7. Table Configuration
  const columns = useMemo(() => {
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
            {/* Show Delete only for Canceled/Refunded orders to keep history clean */}
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
    ];
  }, [handleDelete, handleOrderDetails]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Order Management"
        description="Track, update, and manage customer orders."
      />
      <Card>
        <div className="mb-6">
          <SchemaSearchForm<OrderSearchForm>
            schema={[
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
                defaultValue: 'All',
                options: [
                  { label: 'All', value: 'All' },
                  ...Object.entries(ORDER_STATUS_LABEL).map(([k, v]) => ({
                    label: v,
                    value: k,
                  })),
                ],
              },
            ]}
            onSearch={(v) => run({ current: 1, pageSize: 10 }, v)}
            onReset={reset}
          />
        </div>
        <BaseTable
          columns={columns as ColumnDef<Order, unknown>[]}
          data={tableProps.dataSource || []}
          rowKey="orderId"
          pagination={{
            ...tableProps.pagination,
            onChange: (p, s) =>
              tableProps.onChange?.({ current: p, pageSize: s }),
          }}
        />
      </Card>
    </div>
  );
};
