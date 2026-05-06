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
import { useTranslation } from '@/hooks/useTranslation';
import type { FormSchema } from '@/type/search';
import type { Order, OrderSearchForm } from '@/type/types';
import { ORDER_STATUS } from '@lucky/shared';
import {
  buildOrdersListParams,
  ordersListQueryKey,
  parseOrdersSearchParams,
} from '@/lib/cache/orders-cache';

interface OrderListClientProps {
  initialFormParams?: Record<string, unknown>;
  onParamsChange?: (params: Record<string, unknown>) => void;
}

const ORDER_STATUS_I18N_KEY: Record<number, string> = {
  [ORDER_STATUS.PENDING_PAYMENT]: 'orders.statusPending',
  [ORDER_STATUS.PROCESSING_PAYMENT]: 'orders.statusProcessing',
  [ORDER_STATUS.PAID]: 'orders.statusPaid',
  [ORDER_STATUS.CANCELED]: 'orders.statusCancelled',
  [ORDER_STATUS.REFUNDED]: 'orders.statusRefunded',
  [ORDER_STATUS.WAIT_GROUP]: 'orders.statusWaitGroup',
  [ORDER_STATUS.WAIT_DELIVERY]: 'orders.statusWaitDelivery',
  [ORDER_STATUS.SHIPPED]: 'orders.statusShipped',
  [ORDER_STATUS.COMPLETED]: 'orders.statusCompleted',
};

export function OrderListClient({
  initialFormParams,
  onParamsChange,
}: OrderListClientProps) {
  const { t } = useTranslation();
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
          t('orders.toastStatusUpdated', {
            status: t(ORDER_STATUS_I18N_KEY[status]),
          }),
        );
        await refresh();
        void invalidateOrdersCache();
      } catch {
        addToast('error', t('orders.toastStatusFailed'));
      }
    },
    [addToast, t, updateStatusApi, refresh, invalidateOrdersCache],
  );

  const handleDelete = useCallback(
    async (orderId: string) => {
      ModalManager.open({
        title: t('orders.deleteTitle'),
        renderChildren: ({ close }) => (
          <div className="space-y-4">
            <p>{t('orders.deleteContent')}</p>
            <div className="flex justify-end gap-2 mt-4">
              <Button variant="ghost" onClick={close}>
                {t('orders.deleteCancel')}
              </Button>
              <Button
                onClick={async () => {
                  try {
                    await deleteOrderApi(orderId);
                    addToast('success', t('orders.toastDeleted'));
                    await refresh();
                    void invalidateOrdersCache();
                    close();
                  } catch {
                    addToast('error', t('orders.toastDeleteFailed'));
                  }
                }}
              >
                {t('orders.deleteConfirm')}
              </Button>
            </div>
          </div>
        ),
      });
    },
    [addToast, t, deleteOrderApi, refresh, invalidateOrdersCache],
  );

  const openShippingModal = useCallback(
    (orderId: string) => {
      let trackingNumber = '';
      let courierName = '';

      ModalManager.open({
        title: t('orders.shipTitle'),
        renderChildren: ({ close }) => (
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">
                {t('orders.shipCourierLabel')}
              </label>
              <Input
                onChange={(e) => {
                  courierName = e.target.value;
                }}
                placeholder={t('orders.shipCourierPlaceholder')}
              />
            </div>
            <div>
              <label className="text-sm font-medium">
                {t('orders.shipTrackingLabel')}
              </label>
              <Input
                onChange={(e) => {
                  trackingNumber = e.target.value;
                }}
                placeholder={t('orders.shipTrackingPlaceholder')}
              />
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <Button variant="ghost" onClick={close}>
                {t('orders.shipCancel')}
              </Button>
              <Button
                onClick={() => {
                  void courierName;
                  void trackingNumber;
                  void handleUpdateStatus(orderId, ORDER_STATUS.SHIPPED);
                  close();
                }}
              >
                {t('orders.shipConfirm')}
              </Button>
            </div>
          </div>
        ),
      });
    },
    [t, handleUpdateStatus],
  );

  const handleOrderDetails = useCallback(
    (data: Order) => {
      ModalManager.open({
        title: t('orders.detailTitle', { orderNo: data.orderNo }),
        size: 'lg',
        renderChildren: ({ close }) => (
          <div className="space-y-6">
            <div>
              <h3 className="font-bold text-lg flex items-center gap-2">
                {t('orders.detailStatus', {
                  status: t(ORDER_STATUS_I18N_KEY[data.orderStatus]),
                })}
              </h3>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <h4 className="font-semibold text-gray-500">
                  {t('orders.detailCustomerInfo')}
                </h4>
                <p>{t('orders.detailName', { name: data.user.nickname })}</p>
                <p>{t('orders.detailPhone', { phone: data.user.phone })}</p>
              </div>
              <div className="space-y-2">
                <h4 className="font-semibold text-gray-500">
                  {t('orders.detailOrderInfo')}
                </h4>
                <p>
                  {t('orders.detailProduct', {
                    name: data.treasure.treasureName,
                  })}
                </p>
                <p>{t('orders.detailQty', { qty: data.buyQuantity })}</p>
                <p>
                  {t('orders.detailTotal', {
                    amount: `₱${data.originalAmount.toLocaleString()}`,
                  })}
                </p>
                <p>
                  {t('orders.detailDate', {
                    date: dayjs(data.createdAt).format('MMM DD, YYYY HH:mm'),
                  })}
                </p>
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-4 border-t border-gray-100 dark:border-white/5">
              <Button variant="ghost" onClick={close}>
                {t('orders.detailClose')}
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
                  <Truck size={16} className="mr-2" />{' '}
                  {t('orders.detailShipOrder')}
                </Button>
              )}

              {/* 标记已完成: Shipped(8) 后可确认收货 */}
              {data.orderStatus === ORDER_STATUS.SHIPPED && (
                <Button
                  onClick={() =>
                    handleUpdateStatus(data.orderId, ORDER_STATUS.COMPLETED)
                  }
                >
                  {t('orders.detailMarkCompleted')}
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
                  <XCircle size={16} className="mr-2" />{' '}
                  {t('orders.detailCancelOrder')}
                </Button>
              )}
            </div>
          </div>
        ),
      });
    },
    [t, handleUpdateStatus, openShippingModal],
  );

  const columns: ColumnDef<Order>[] = useMemo(() => {
    const columnsHelper = createColumnHelper<Order>();
    return [
      columnsHelper.accessor('orderNo', {
        header: t('orders.columnOrderNo'),
        cell: (info) => <span className="font-medium">{info.getValue()}</span>,
      }),
      columnsHelper.accessor('createdAt', {
        header: t('orders.columnDate'),
        cell: (info) => (
          <span className="text-gray-500 text-xs">
            {dayjs(info.getValue()).format('YYYY-MM-DD HH:mm')}
          </span>
        ),
      }),
      columnsHelper.accessor('user.nickname', {
        header: t('orders.columnCustomer'),
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
        header: t('orders.columnProduct'),
      }),
      columnsHelper.accessor('originalAmount', {
        header: t('orders.columnTotal'),
        cell: (info) => (
          <span className="font-mono font-bold">
            ₱{info.getValue().toLocaleString()}
          </span>
        ),
      }),
      columnsHelper.accessor('orderStatus', {
        header: t('orders.columnStatus'),
        cell: (info) => {
          const status = info.getValue();
          const color = ORDER_STATUS_COLORS[status] || 'gray';
          return (
            <Badge color={color}>{t(ORDER_STATUS_I18N_KEY[status])}</Badge>
          );
        },
      }),
      columnsHelper.display({
        id: 'actions',
        header: t('orders.columnActions'),
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
  }, [t, handleDelete, handleOrderDetails]);

  const searchSchema: FormSchema[] = useMemo(
    () => [
      {
        type: 'input',
        key: 'keyword',
        label: t('orders.searchKeyword'),
        placeholder: t('orders.searchKeywordPlaceholder'),
      },
      {
        type: 'select',
        key: 'orderStatus',
        label: t('orders.searchStatus'),
        defaultValue: 'ALL',
        options: [
          { label: t('orders.searchStatusAll'), value: 'ALL' },
          ...Object.keys(ORDER_STATUS_I18N_KEY).map((key) => ({
            label: t(ORDER_STATUS_I18N_KEY[Number(key)]),
            value: key,
          })),
        ],
      },
    ],
    [t],
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
        title={t('orders.pageTitle')}
        description={t('orders.pageDescription')}
      />
      <Card>
        <div className="mb-6">
          <SchemaSearchForm<OrderSearchForm>
            initialValues={filters}
            schema={searchSchema}
            onSearchAction={handleSearch}
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
