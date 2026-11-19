/**
 * SSE 帧白名单。
 *
 * 只允许协议内定义的帧类型和字段出网，防止以后有人把内部决策 JSON
 * （prompt、tool args、意图候选等）直接 spread 到 step 帧里。
 */

export const ALLOWED_SSE_EVENT_TYPES = new Set([
  'token',
  'step',
  'done',
  'error',
  'transfer',
]);

export function isAllowedSseType(type: string): boolean {
  return ALLOWED_SSE_EVENT_TYPES.has(type);
}

const ALLOWED_STEP_FIELDS = ['content', 'tool'] as const;

/**
 * 只保留 step 帧允许的字段：
 *   - step: 帧子类型（thinking / tool_start / tool_end）
 *   - content: 展示文本
 *   - tool: 工具展示名
 * 其余字段（args、decision、prompt、scores…）一律丢弃。
 */
export function sanitizeStepFrame(
  step: string,
  data?: Record<string, any>,
): Record<string, string> {
  const safe: Record<string, string> = { step };
  if (!data) return safe;

  for (const key of ALLOWED_STEP_FIELDS) {
    const value = data[key];
    if (typeof value === 'string' && value.length > 0) {
      safe[key] = value;
    }
  }
  return safe;
}
