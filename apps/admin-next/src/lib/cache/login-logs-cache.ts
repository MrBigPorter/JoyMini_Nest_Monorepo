export const LOGIN_LOGS_LIST_TAG = 'login-logs:list';

export interface LoginLogsListQueryInput {
  page: number;
  pageSize: number;
  userId?: string;
  loginIp?: string;
  loginMethod?: string;
  loginStatus?: number;
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

function parseOptionalInt(value: string | undefined): number | undefined {
  if (!value || value === 'ALL') return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.floor(parsed);
}

export function parseLoginLogsSearchParams(
  params: NextSearchParams,
): LoginLogsListQueryInput {
  const page = parsePositiveInt(readParam(params, 'page'), 1);
  const pageSize = parsePositiveInt(readParam(params, 'pageSize'), 20);
  const userId = readParam(params, 'userId')?.trim();
  const loginIp = readParam(params, 'loginIp')?.trim();
  const loginMethod = readParam(params, 'loginMethod')?.trim();
  const loginStatus = parseOptionalInt(readParam(params, 'loginStatus'));
  const startDate = readParam(params, 'startDate');
  const endDate = readParam(params, 'endDate');

  return {
    page,
    pageSize,
    ...(userId ? { userId } : {}),
    ...(loginIp ? { loginIp } : {}),
    ...(loginMethod ? { loginMethod } : {}),
    ...(loginStatus !== undefined ? { loginStatus } : {}),
    ...(startDate ? { startDate } : {}),
    ...(endDate ? { endDate } : {}),
  };
}

export function buildLoginLogsListParams(
  input: LoginLogsListQueryInput,
): Record<string, string | number | undefined> {
  return {
    page: input.page,
    pageSize: input.pageSize,
    ...(input.userId ? { userId: input.userId } : {}),
    ...(input.loginIp ? { loginIp: input.loginIp } : {}),
    ...(input.loginMethod ? { loginMethod: input.loginMethod } : {}),
    ...(input.loginStatus !== undefined
      ? { loginStatus: input.loginStatus }
      : {}),
    ...(input.startDate ? { startDate: input.startDate } : {}),
    ...(input.endDate ? { endDate: input.endDate } : {}),
  };
}

export function loginLogsListQueryKey(input: LoginLogsListQueryInput) {
  return [
    'login-logs',
    input.page,
    input.pageSize,
    input.userId ?? '',
    input.loginIp ?? '',
    input.loginMethod ?? '',
    input.loginStatus ?? 'all',
    input.startDate ?? '',
    input.endDate ?? '',
  ] as const;
}
