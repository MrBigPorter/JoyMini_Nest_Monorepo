export const KYC_LIST_TAG = 'kyc:list';

export interface KycListQueryInput {
  page: number;
  pageSize: number;
  userId?: string;
  kycStatus?: number;
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

export function parseKycSearchParams(
  params: NextSearchParams,
): KycListQueryInput {
  const page = parsePositiveInt(readParam(params, 'page'), 1);
  const pageSize = parsePositiveInt(readParam(params, 'pageSize'), 10);
  const userId = readParam(params, 'userId')?.trim();
  const kycStatus = parseOptionalInt(readParam(params, 'kycStatus'));
  const startDate = readParam(params, 'startDate');
  const endDate = readParam(params, 'endDate');

  return {
    page,
    pageSize,
    ...(userId ? { userId } : {}),
    ...(kycStatus !== undefined ? { kycStatus } : {}),
    ...(startDate ? { startDate } : {}),
    ...(endDate ? { endDate } : {}),
  };
}

export function buildKycListParams(
  input: KycListQueryInput,
): Record<string, string | number | undefined> {
  return {
    page: input.page,
    pageSize: input.pageSize,
    ...(input.userId ? { userId: input.userId } : {}),
    ...(input.kycStatus !== undefined ? { kycStatus: input.kycStatus } : {}),
    ...(input.startDate ? { startDate: input.startDate } : {}),
    ...(input.endDate ? { endDate: input.endDate } : {}),
  };
}

export function kycListQueryKey(input: KycListQueryInput) {
  return [
    'kyc',
    input.page,
    input.pageSize,
    input.userId ?? '',
    input.kycStatus ?? 'all',
    input.startDate ?? '',
    input.endDate ?? '',
  ] as const;
}
