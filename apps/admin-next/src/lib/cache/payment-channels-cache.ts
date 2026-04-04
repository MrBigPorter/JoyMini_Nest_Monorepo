/**
 * Payment Channels Cache Contract — 读侧缓存契约
 * Phase 6 P0：单页面缓存优化（可回退）
 *
 * 职责：
 * ① URL searchParams → 缓存 key 的双向转换（parse / build）
 * ② React Query queryKey 生成（确保 cache 相同参数正确命中）
 * ③ 服务端预取参数标准化（Server 和 Client 用同一规范）
 */

export const PAYMENT_CHANNELS_LIST_TAG = 'payment-channels:list';

export interface PaymentChannelsListQueryInput {
  page: number;
  pageSize: number;
  name?: string;
  type?: number;
  status?: number;
}

export type NextSearchParams = Record<string, string | string[] | undefined>;

/**
 * 读取 searchParams 中的单个参数
 * 处理 Next.js 的 searchParams 可能是数组的情况
 */
function readParam(params: NextSearchParams, key: string): string | undefined {
  const value = params[key];
  if (Array.isArray(value)) return value[0];
  return value;
}

/**
 * 解析并验证正整数
 * @param value 原始字符串值
 * @param fallback 无效时的默认值
 */
function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

/**
 * 解析可选的整数
 * 空字符串、'ALL' 返回 undefined（用于条件字段）
 */
function parseOptionalInt(value: string | undefined): number | undefined {
  if (!value || value === 'ALL') return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.floor(parsed);
}

/**
 * 从 Next.js searchParams 解析出缓存查询参数
 *
 * 规范：
 * - page, pageSize 来自 URL，默认 page=1, pageSize=10
 * - 条件字段（name, type, status）为可选，不存在或值为 'ALL' 时省略
 */
export function parsePaymentChannelsSearchParams(
  params: NextSearchParams,
): PaymentChannelsListQueryInput {
  const page = parsePositiveInt(readParam(params, 'page'), 1);
  const pageSize = parsePositiveInt(readParam(params, 'pageSize'), 10);
  const name = readParam(params, 'name')?.trim();
  const type = parseOptionalInt(readParam(params, 'type'));
  const status = parseOptionalInt(readParam(params, 'status'));

  return {
    page,
    pageSize,
    ...(name ? { name } : {}),
    ...(type !== undefined ? { type } : {}),
    ...(status !== undefined ? { status } : {}),
  };
}

/**
 * 从缓存查询参数构建后端请求参数
 *
 * 规范：
 * - 直接映射到后端 API 参数（paymentChannelApi.getList）
 */
export function buildPaymentChannelsListParams(
  input: PaymentChannelsListQueryInput,
): Record<string, string | number | undefined> {
  return {
    page: input.page,
    pageSize: input.pageSize,
    ...(input.name ? { name: input.name } : {}),
    ...(input.type !== undefined ? { type: input.type } : {}),
    ...(input.status !== undefined ? { status: input.status } : {}),
  };
}

/**
 * 生成 React Query queryKey
 *
 * 规范（与 banners-cache.ts 对齐）：
 * - 第一维固定为 'payment-channels'
 * - 后续为拍平参数（分页 → 数字，条件字段 → 数字或 '' / 'all'）
 * - 确保 useQuery({ queryKey }) 能正确去重和缓存命中
 */
export function paymentChannelsListQueryKey(
  input: PaymentChannelsListQueryInput,
) {
  return [
    'payment-channels',
    input.page,
    input.pageSize,
    input.name ?? '',
    input.type ?? 'all',
    input.status ?? 'all',
  ] as const;
}
