// Finance transactions cache/query contract helpers.
export const FINANCE_TRANSACTIONS_TAG = 'finance:transactions';

export interface TransactionsQueryInput {
  page: number;
  pageSize: number;
  keyword?: string;
  transactionType?: number;
  startDate?: string;
  endDate?: string;
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

export function parseTransactionsSearchParams(
  params: NextSearchParams,
): TransactionsQueryInput {
  const page = parsePositiveInt(readParam(params, 'page'), 1);
  const pageSize = parsePositiveInt(readParam(params, 'pageSize'), 10);
  const keyword = readParam(params, 'keyword')?.trim();
  // 兼容 URL 两种命名：transactionType（前端）/ type（后端）
  const transactionTypeRaw =
    readParam(params, 'transactionType') ?? readParam(params, 'type');
  const transactionType =
    transactionTypeRaw && transactionTypeRaw !== 'ALL'
      ? parsePositiveInt(transactionTypeRaw, 0)
      : undefined;
  const startDate = readParam(params, 'startDate');
  const endDate = readParam(params, 'endDate');

  return {
    page,
    pageSize,
    ...(keyword ? { keyword } : {}),
    ...(transactionType ? { transactionType } : {}),
    ...(startDate ? { startDate } : {}),
    ...(endDate ? { endDate } : {}),
  };
}

export function buildTransactionsListParams(
  input: TransactionsQueryInput,
): Record<string, string | number | undefined> {
  return {
    page: input.page,
    pageSize: input.pageSize,
    ...(input.keyword ? { keyword: input.keyword } : {}),
    ...(input.transactionType !== undefined
      ? { type: input.transactionType }
      : {}),
    ...(input.startDate ? { startDate: input.startDate } : {}),
    ...(input.endDate ? { endDate: input.endDate } : {}),
  };
}

export function transactionsListQueryKey(input: TransactionsQueryInput) {
  return [
    'finance-transactions',
    input.page,
    input.pageSize,
    input.keyword ?? '',
    input.transactionType ?? 'all',
    input.startDate ?? '',
    input.endDate ?? '',
  ] as const;
}
