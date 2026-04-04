export const BANNERS_LIST_TAG = 'banners:list';

export interface BannersListQueryInput {
  page: number;
  pageSize: number;
  title?: string;
  bannerCate?: number;
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

export function parseBannersSearchParams(
  params: NextSearchParams,
): BannersListQueryInput {
  const page = parsePositiveInt(readParam(params, 'page'), 1);
  const pageSize = parsePositiveInt(readParam(params, 'pageSize'), 10);
  const title = readParam(params, 'title')?.trim();
  const bannerCate = parseOptionalInt(readParam(params, 'bannerCate'));

  return {
    page,
    pageSize,
    ...(title ? { title } : {}),
    ...(bannerCate !== undefined ? { bannerCate } : {}),
  };
}

export function buildBannersListParams(
  input: BannersListQueryInput,
): Record<string, string | number | undefined> {
  return {
    page: input.page,
    pageSize: input.pageSize,
    ...(input.title ? { title: input.title } : {}),
    ...(input.bannerCate !== undefined ? { bannerCate: input.bannerCate } : {}),
  };
}

export function bannersListQueryKey(input: BannersListQueryInput) {
  return [
    'banners',
    input.page,
    input.pageSize,
    input.title ?? '',
    input.bannerCate ?? 'all',
  ] as const;
}
