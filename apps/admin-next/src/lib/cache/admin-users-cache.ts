export const ADMIN_USERS_LIST_TAG = 'admin-users:list';

export interface AdminUsersListQueryInput {
  page: number;
  pageSize: number;
  username?: string;
  realName?: string;
  role?: string;
  status?: number;
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

export function parseAdminUsersSearchParams(
  params: NextSearchParams,
): AdminUsersListQueryInput {
  const page = parsePositiveInt(readParam(params, 'page'), 1);
  const pageSize = parsePositiveInt(readParam(params, 'pageSize'), 10);
  const username = readParam(params, 'username')?.trim();
  const realName = readParam(params, 'realName')?.trim();
  const roleRaw = readParam(params, 'role');
  const role = roleRaw && roleRaw !== 'ALL' ? roleRaw : undefined;
  const status = parseOptionalInt(readParam(params, 'status'));

  return {
    page,
    pageSize,
    ...(username ? { username } : {}),
    ...(realName ? { realName } : {}),
    ...(role ? { role } : {}),
    ...(status !== undefined ? { status } : {}),
  };
}

export function buildAdminUsersListParams(
  input: AdminUsersListQueryInput,
): Record<string, string | number | undefined> {
  return {
    page: input.page,
    pageSize: input.pageSize,
    ...(input.username ? { username: input.username } : {}),
    ...(input.realName ? { realName: input.realName } : {}),
    ...(input.role ? { role: input.role } : {}),
    ...(input.status !== undefined ? { status: input.status } : {}),
  };
}

export function adminUsersListQueryKey(input: AdminUsersListQueryInput) {
  return [
    'admin-users',
    input.page,
    input.pageSize,
    input.username ?? '',
    input.realName ?? '',
    input.role ?? 'all',
    input.status ?? 'all',
  ] as const;
}
