export const OPERATION_LOGS_LIST_TAG = 'operation-logs:list';

export interface OperationLogsListQueryInput {
  page: number;
  pageSize: number;
  adminId?: string;
  action?: string;
  keyword?: string;
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

export function parseOperationLogsSearchParams(
  params: NextSearchParams,
): OperationLogsListQueryInput {
  const page = parsePositiveInt(readParam(params, 'page'), 1);
  const pageSize = parsePositiveInt(readParam(params, 'pageSize'), 10);
  const adminId = readParam(params, 'adminId')?.trim();
  const keyword = readParam(params, 'keyword')?.trim();
  const actionRaw = readParam(params, 'action');
  const startDate = readParam(params, 'startDate');
  const endDate = readParam(params, 'endDate');

  return {
    page,
    pageSize,
    ...(adminId ? { adminId } : {}),
    ...(keyword ? { keyword } : {}),
    ...(actionRaw && actionRaw !== 'ALL' && actionRaw !== 'All'
      ? { action: actionRaw }
      : {}),
    ...(startDate ? { startDate } : {}),
    ...(endDate ? { endDate } : {}),
  };
}

export function buildOperationLogsListParams(
  input: OperationLogsListQueryInput,
): Record<string, string | number | undefined> {
  return {
    page: input.page,
    pageSize: input.pageSize,
    ...(input.adminId ? { adminId: input.adminId } : {}),
    ...(input.action ? { action: input.action } : {}),
    ...(input.keyword ? { keyword: input.keyword } : {}),
    ...(input.startDate ? { startDate: input.startDate } : {}),
    ...(input.endDate ? { endDate: input.endDate } : {}),
  };
}

export function operationLogsListQueryKey(input: OperationLogsListQueryInput) {
  return [
    'operation-logs',
    input.page,
    input.pageSize,
    input.adminId ?? '',
    input.action ?? 'all',
    input.keyword ?? '',
    input.startDate ?? '',
    input.endDate ?? '',
  ] as const;
}
