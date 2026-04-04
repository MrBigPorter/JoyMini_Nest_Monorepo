export const PRODUCTS_LIST_TAG = 'products:list';

export interface ProductsListQueryInput {
  page: number;
  pageSize: number;
  treasureName?: string;
  categoryId?: number;
  filterType?: string;
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

export function parseProductsSearchParams(
  params: NextSearchParams,
): ProductsListQueryInput {
  const page = parsePositiveInt(readParam(params, 'page'), 1);
  const pageSize = parsePositiveInt(readParam(params, 'pageSize'), 10);
  const treasureName = readParam(params, 'treasureName')?.trim();
  const categoryId = parseOptionalInt(readParam(params, 'categoryId'));
  const filterTypeRaw = readParam(params, 'filterType');
  const filterType =
    filterTypeRaw && filterTypeRaw !== 'ALL' ? filterTypeRaw : undefined;

  return {
    page,
    pageSize,
    ...(treasureName ? { treasureName } : {}),
    ...(categoryId !== undefined ? { categoryId } : {}),
    ...(filterType ? { filterType } : {}),
  };
}

export function buildProductsListParams(
  input: ProductsListQueryInput,
): Record<string, string | number | undefined> {
  return {
    page: input.page,
    pageSize: input.pageSize,
    ...(input.treasureName ? { treasureName: input.treasureName } : {}),
    ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}),
    ...(input.filterType ? { filterType: input.filterType } : {}),
  };
}

export function productsListQueryKey(input: ProductsListQueryInput) {
  return [
    'products',
    input.page,
    input.pageSize,
    input.treasureName ?? '',
    input.categoryId ?? 'all',
    input.filterType ?? 'all',
  ] as const;
}
