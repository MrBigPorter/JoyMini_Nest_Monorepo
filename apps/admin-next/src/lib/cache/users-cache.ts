import type { QueryClientUserParams } from '@/type/types';

export const USERS_LIST_TAG = 'users:list';

export interface UsersListQueryInput {
  page: number;
  pageSize: number;
  userId?: string;
  phone?: string;
  status?: number;
  kycStatus?: number;
  startTime?: string;
  endTime?: string;
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

export function parseUsersSearchParams(
  params: NextSearchParams,
): UsersListQueryInput {
  const page = parsePositiveInt(readParam(params, 'page'), 1);
  const pageSize = parsePositiveInt(readParam(params, 'pageSize'), 10);
  const userId = readParam(params, 'userId')?.trim();
  const phone = readParam(params, 'phone')?.trim();
  const status = parseOptionalInt(readParam(params, 'status'));
  const kycStatus = parseOptionalInt(readParam(params, 'kycStatus'));
  const startTime = readParam(params, 'startTime');
  const endTime = readParam(params, 'endTime');

  return {
    page,
    pageSize,
    ...(userId ? { userId } : {}),
    ...(phone ? { phone } : {}),
    ...(status !== undefined ? { status } : {}),
    ...(kycStatus !== undefined ? { kycStatus } : {}),
    ...(startTime ? { startTime } : {}),
    ...(endTime ? { endTime } : {}),
  };
}

export function buildUsersListParams(
  input: UsersListQueryInput,
): QueryClientUserParams {
  return {
    page: input.page,
    pageSize: input.pageSize,
    ...(input.userId ? { userId: input.userId } : {}),
    ...(input.phone ? { phone: input.phone } : {}),
    ...(input.status !== undefined ? { status: input.status } : {}),
    ...(input.kycStatus !== undefined ? { kycStatus: input.kycStatus } : {}),
    ...(input.startTime ? { startTime: input.startTime } : {}),
    ...(input.endTime ? { endTime: input.endTime } : {}),
  };
}

export function usersListQueryKey(input: UsersListQueryInput) {
  return [
    'users',
    input.page,
    input.pageSize,
    input.userId ?? '',
    input.phone ?? '',
    input.status ?? 'all',
    input.kycStatus ?? 'all',
    input.startTime ?? '',
    input.endTime ?? '',
  ] as const;
}
