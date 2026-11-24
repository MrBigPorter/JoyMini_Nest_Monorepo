/**
 * 有界等待：给「并行预取」设一个上限，超时就先走。
 *
 * ── 为什么需要 ──
 * 强制检索的预取与 Agent 并行发出，收尾时要 `await` 它的结果参与合成。
 * 设计假设是「并行能掩盖检索耗时」，但 2026-11-24 enforce 全量验收发现
 * 工具类问题（Agent 2s 级）时，检索 + 中文问句改写（最多 3s 的 chat 调用）
 * 比 Agent 慢，收尾就变成串行等待：p95 9667 → 11543ms（+19.4%），
 * 超过 design 的 15% 预算。
 *
 * ── 口径 ──
 * 超时不是失败：预取结果直接丢弃，本轮按「检索了但 0 候选」继续，由发布门禁
 * 兜底；后台 promise 仍会跑完，其 rejection 已经在调用方 `.catch` 里消化，
 * 不会产生未处理的 rejection。
 *
 * 等待上限默认 2500ms，可用 `AI_GROUNDING_PREFETCH_WAIT_MS` 覆盖（用于联调和测试），
 * 非法值回落默认——宁可恢复一个确定的预算，也不要因为拼写错误变成无限等待。
 */

export const DEFAULT_PREFETCH_WAIT_MS = 2500;

export function readPrefetchWaitMs(
  raw: string | undefined = process.env.AI_GROUNDING_PREFETCH_WAIT_MS,
): number {
  const parsed = Number(String(raw ?? '').trim());
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) {
    return DEFAULT_PREFETCH_WAIT_MS;
  }
  return parsed;
}

export interface BoundedAwaitResult<T> {
  value: T;
  timedOut: boolean;
}

export async function awaitWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  fallback: T,
): Promise<BoundedAwaitResult<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<BoundedAwaitResult<T>>((resolve) => {
    timer = setTimeout(() => resolve({ value: fallback, timedOut: true }), timeoutMs);
    // 不要让上限计时器把进程挂住（测试与脚本退出更快）
    (timer as unknown as { unref?: () => void })?.unref?.();
  });

  try {
    return await Promise.race([
      promise.then((value) => ({ value, timedOut: false })),
      timeout,
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
