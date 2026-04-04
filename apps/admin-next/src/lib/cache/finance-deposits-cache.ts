export interface DepositsListQueryInput {
  page: number;
  pageSize: number;
  keyword?: string;
  status?: string;
  channel?: string;
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

export function parseDepositsSearchParams(
  params: NextSearchParams,
): DepositsListQueryInput {
  const page = parsePositiveInt(readParam(params, 'page'), 1);
  const pageSize = parsePositiveInt(readParam(params, 'pageSize'), 10);
  const keyword = readParam(params, 'keyword')?.trim();
  const statusRaw = readParam(params, 'status');
  const channelRaw = readParam(params, 'channel');
  const startDate = readParam(params, 'startDate');
  const endDate = readParam(params, 'endDate');

  return {
    page,
    pageSize,
    ...(keyword ? { keyword } : {}),
    ...(statusRaw && statusRaw !== 'ALL' ? { status: statusRaw } : {}),
    ...(channelRaw && channelRaw !== 'ALL' ? { channel: channelRaw } : {}),
    ...(startDate ? { startDate } : {}),
    ...(endDate ? { endDate } : {}),
  };
}

export function buildDepositsListParams(
  input: DepositsListQueryInput,
): Record<string, string | number | undefined> {
  return {
    page: input.page,
    pageSize: input.pageSize,
    ...(input.keyword ? { keyword: input.keyword } : {}),
    ...(input.status ? { status: input.status } : {}),
    ...(input.channel ? { channel: input.channel } : {}),
    ...(input.startDate ? { startDate: input.startDate } : {}),
    ...(input.endDate ? { endDate: input.endDate } : {}),
  };
}

export function depositsListQueryKey(input: DepositsListQueryInput) {
  return [
    'finance-deposits',
    input.page,
    input.pageSize,
    input.keyword ?? '',
    input.status ?? 'all',
    input.channel ?? 'all',
    input.startDate ?? '',
    input.endDate ?? '',
  ] as const;
}
