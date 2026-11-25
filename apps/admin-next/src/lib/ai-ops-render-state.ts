/**
 * AI 质量台的统一渲染状态。
 *
 * 页面必须区分「加载中 / 已禁用 / 请求失败 / 无数据 / 可渲染」，
 * 否则运营会把失败读成空数据、把未知读成 0。所有区块用同一个推导函数，
 * 避免每个区块各自判断导致漏判。
 */
export type RenderState =
  | { kind: 'loading' }
  | { kind: 'disabled'; reason: string }
  | { kind: 'error'; message: string }
  | { kind: 'empty' }
  | { kind: 'ready' };

export const UNKNOWN_LABEL = '未知';

/** 把任意错误转成可读文案；没有 message 时用通用文案，不把对象塞进 UI。 */
export function errorMessage(error: unknown): string {
  if (typeof error === 'string' && error.trim()) return error;
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) return message;
  }
  return '请求失败';
}

/**
 * 状态优先级：禁用 > 加载中 > 请求失败 > 空态 > 可渲染。
 * 禁用的区块不加载数据，所以即使 loading/error 也在，优先告诉用户原因。
 */
export function resolveRenderState(input: {
  loading?: boolean;
  disabledReason?: string | null;
  error?: unknown;
  isEmpty?: boolean;
}): RenderState {
  if (input.disabledReason) {
    return { kind: 'disabled', reason: input.disabledReason };
  }
  if (input.loading) {
    return { kind: 'loading' };
  }
  if (input.error) {
    return { kind: 'error', message: errorMessage(input.error) };
  }
  if (input.isEmpty) {
    return { kind: 'empty' };
  }
  return { kind: 'ready' };
}

/**
 * 计数字段：有数就显示数（真实的 0 要保留），没数显示「未知」，
 * 加载中显示「加载中…」，绝不把未知渲染成 0。
 */
export function formatKnownCount(
  value: number | null | undefined,
  state?: RenderState,
): string {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  if (state?.kind === 'loading') return '加载中…';
  return UNKNOWN_LABEL;
}
