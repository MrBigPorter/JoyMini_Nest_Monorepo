import type { OrderListParams } from '@/type/types';

export const ORDERS_LIST_TAG = 'orders:list';

export interface OrdersListQueryInput {
  page: number;
  pageSize: number;
  keyword?: string;
  orderStatus?: number;
}

export type NextSearchParams = Record<string, string | string[] | undefined>;

function readParam(params: NextSearchParams, key: string): string | undefined {
  const value = params[key];
  if (Array.isArray(value)) return value[0];
  return value;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function parseOptionalInt(value: string | undefined): number | undefined {
  if (!value || value === 'ALL' || value === 'All') return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.floor(parsed);
}

export function parseOrdersSearchParams(
  params: NextSearchParams,
): OrdersListQueryInput {
  const page = parsePositiveInt(readParam(params, 'page'), 1);
  const pageSize = parsePositiveInt(readParam(params, 'pageSize'), 10);
  const keyword = readParam(params, 'keyword')?.trim();
  const orderStatus = parseOptionalInt(readParam(params, 'orderStatus'));

  return {
    page,
    pageSize,
    ...(keyword ? { keyword } : {}),
    ...(orderStatus !== undefined ? { orderStatus } : {}),
  };
}

export function buildOrdersListParams(
  input: OrdersListQueryInput,
): OrderListParams {
  return {
    page: input.page,
    pageSize: input.pageSize,
    ...(input.keyword ? { keyword: input.keyword } : {}),
    ...(input.orderStatus !== undefined
      ? { orderStatus: input.orderStatus }
      : {}),
  };
}

export function ordersListQueryKey(input: OrdersListQueryInput) {
  return [
    'orders',
    input.page,
    input.pageSize,
    input.keyword ?? '',
    input.orderStatus ?? 'all',
  ] as const;
}
