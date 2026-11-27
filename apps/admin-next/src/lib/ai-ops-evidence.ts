/**
 * 质检卡片证据选择：把「按消息标识找链路」的规则从组件里拆出来。
 *
 * 规则（quality-console-trust D6）：
 * - 有消息标识且命中 `aiMessageId` / `triggerMessageId` → 精确
 * - 只有会话链路、没有对应消息 → 回退最新，但必须标近似
 * - 一条链路都没有 → 没有证据，由调用方渲染「证据已过期」
 *
 * 不做按时间窗猜测：错配的证据比没有证据更危险。
 */

export type TraceMatch = 'exact' | 'approx' | 'none';

export interface TraceCandidate {
  id: string;
  aiMessageId?: string | null;
  triggerMessageId?: string | null;
}

export interface TracePick<T extends TraceCandidate> {
  trace: T | null;
  match: TraceMatch;
}

export function pickTraceForMessage<T extends TraceCandidate>(
  traces: T[],
  messageId: string | null | undefined,
): TracePick<T> {
  if (traces.length === 0) return { trace: null, match: 'none' };
  if (messageId) {
    const exact = traces.find(
      (trace) =>
        trace.aiMessageId === messageId || trace.triggerMessageId === messageId,
    );
    if (exact) return { trace: exact, match: 'exact' };
  }
  return { trace: traces[0], match: 'approx' };
}

export interface FailedSpanLike {
  type?: string | null;
  status?: string | null;
  error?: string | null;
}

/** 失败步骤：带 error，或 status 明确不是 OK/SUCCESS。 */
export function selectFailedSpans<T extends FailedSpanLike>(spans: T[]): T[] {
  return spans.filter((span) => {
    if (span.error) return true;
    const status = (span.status ?? '').toUpperCase();
    return status !== '' && status !== 'OK' && status !== 'SUCCESS';
  });
}

const SPAN_TYPE_ATTRIBUTION: Record<string, string> = {
  llm: '模型生成',
  rag: '知识检索',
  tool: '工具调用',
  intent: '意图识别',
};

/**
 * 从第一个失败 span 推断归因；只认已登记的 type，其余返回 null，
 * 由界面保持「未给出建议」而不是编一个。
 */
export function suggestAttribution(
  failed: Array<{ type?: string | null }>,
): string | null {
  const type = failed[0]?.type;
  if (!type) return null;
  return SPAN_TYPE_ATTRIBUTION[type] ?? null;
}
