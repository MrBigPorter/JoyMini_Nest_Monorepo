export const GROUPS_LIST_TAG = 'groups:list';

export interface GroupsListQueryInput {
  page: number;
  pageSize: number;
  treasureId?: string;
  status?: number;
  includeExpired: boolean;
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

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return value === 'true';
}

export function parseGroupsSearchParams(
  params: NextSearchParams,
): GroupsListQueryInput {
  const page = parsePositiveInt(readParam(params, 'page'), 1);
  const pageSize = parsePositiveInt(readParam(params, 'pageSize'), 20);
  const treasureId = readParam(params, 'treasureId')?.trim();
  const statusRaw = readParam(params, 'status');
  const status =
    statusRaw && statusRaw !== 'ALL'
      ? parsePositiveInt(statusRaw, 0)
      : undefined;
  const includeExpired = parseBoolean(
    readParam(params, 'includeExpired'),
    false,
  );

  return {
    page,
    pageSize,
    ...(treasureId ? { treasureId } : {}),
    ...(status ? { status } : {}),
    includeExpired,
  };
}

export function buildGroupsListParams(
  input: GroupsListQueryInput,
): Record<string, string | number | boolean | undefined> {
  return {
    page: input.page,
    pageSize: input.pageSize,
    ...(input.treasureId ? { treasureId: input.treasureId } : {}),
    ...(input.status ? { status: input.status } : {}),
    includeExpired: input.includeExpired,
  };
}

export function groupsListQueryKey(input: GroupsListQueryInput) {
  return [
    'groups',
    input.page,
    input.pageSize,
    input.treasureId ?? '',
    input.status ?? 'all',
    input.includeExpired ? '1' : '0',
  ] as const;
}
