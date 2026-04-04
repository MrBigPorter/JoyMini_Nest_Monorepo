export const ADDRESS_LIST_TAG = 'address:list';

export interface AddressListQueryInput {
  page: number;
  pageSize: number;
  keyword?: string;
  userId?: string;
  province?: string;
  phone?: string;
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

export function parseAddressSearchParams(
  params: NextSearchParams,
): AddressListQueryInput {
  const page = parsePositiveInt(readParam(params, 'page'), 1);
  const pageSize = parsePositiveInt(readParam(params, 'pageSize'), 10);
  const keyword = readParam(params, 'keyword')?.trim();
  const userId = readParam(params, 'userId')?.trim();
  const province = readParam(params, 'province')?.trim();
  const phone = readParam(params, 'phone')?.trim();

  return {
    page,
    pageSize,
    ...(keyword ? { keyword } : {}),
    ...(userId ? { userId } : {}),
    ...(province ? { province } : {}),
    ...(phone ? { phone } : {}),
  };
}

export function buildAddressListParams(
  input: AddressListQueryInput,
): Record<string, string | number | undefined> {
  return {
    page: input.page,
    pageSize: input.pageSize,
    ...(input.keyword ? { keyword: input.keyword } : {}),
    ...(input.userId ? { userId: input.userId } : {}),
    ...(input.province ? { province: input.province } : {}),
    ...(input.phone ? { phone: input.phone } : {}),
  };
}

export function addressListQueryKey(input: AddressListQueryInput) {
  return [
    'address',
    input.page,
    input.pageSize,
    input.keyword ?? '',
    input.userId ?? '',
    input.province ?? '',
    input.phone ?? '',
  ] as const;
}
