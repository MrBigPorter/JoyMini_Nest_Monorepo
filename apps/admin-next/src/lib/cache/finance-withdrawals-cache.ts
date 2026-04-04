export interface WithdrawalsListQueryInput {
  page: number;
  pageSize: number;
  keyword?: string;
  status?: string;
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

export function parseWithdrawalsSearchParams(
  params: NextSearchParams,
): WithdrawalsListQueryInput {
  const page = parsePositiveInt(readParam(params, 'page'), 1);
  const pageSize = parsePositiveInt(readParam(params, 'pageSize'), 10);
  const keyword = readParam(params, 'keyword')?.trim();
  const statusRaw = readParam(params, 'status');
  const startDate = readParam(params, 'startDate');
  const endDate = readParam(params, 'endDate');

  return {
    page,
    pageSize,
    ...(keyword ? { keyword } : {}),
    ...(statusRaw && statusRaw !== 'ALL' ? { status: statusRaw } : {}),
    ...(startDate ? { startDate } : {}),
    ...(endDate ? { endDate } : {}),
  };
}

export function buildWithdrawalsListParams(
  input: WithdrawalsListQueryInput,
): Record<string, string | number | undefined> {
  return {
    page: input.page,
    pageSize: input.pageSize,
    ...(input.keyword ? { keyword: input.keyword } : {}),
    ...(input.status ? { status: input.status } : {}),
    ...(input.startDate ? { startDate: input.startDate } : {}),
    ...(input.endDate ? { endDate: input.endDate } : {}),
  };
}

export function withdrawalsListQueryKey(input: WithdrawalsListQueryInput) {
  return [
    'finance-withdrawals',
    input.page,
    input.pageSize,
    input.keyword ?? '',
    input.status ?? 'all',
    input.startDate ?? '',
    input.endDate ?? '',
  ] as const;
}
