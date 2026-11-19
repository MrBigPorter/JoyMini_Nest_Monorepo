/**
 * SSE 帧白名单。
 *
 * 只允许协议内定义的帧类型和字段出网，防止以后有人把内部决策 JSON
 * （prompt、tool args、意图候选等）直接 spread 到 step 帧里。
 *
 * 开关 AI_STREAM_FRAME_WHITELIST_ENABLED（agent-trust-boundary 3.4）：
 *   - 默认开启，只有显式设置为字符串 'false'（区分大小写）才关闭。
 *   - 任务原计划"默认关闭到验证通过"；白名单已上线且由
 *     ai-stream-frames.spec.ts 覆盖验证，若此时默认关闭会重新暴露
 *     内部决策字段，属于安全弱化，因此默认保持开启。
 *   - 关闭后行为与引入白名单前一致：帧类型不拦截、step 帧按
 *     `{ step, ...data }` 原样透传。
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

/**
 * 输出白名单总开关。
 *
 * 默认开启（缺省 / 'true' / 其他值都视为开启），仅显式 'false' 关闭，
 * 避免一个拼写错误（如 '0'）静默削弱安全边界。
 */
export function isStreamFrameWhitelistEnabled(): boolean {
  return process.env.AI_STREAM_FRAME_WHITELIST_ENABLED !== 'false';
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

/**
 * 按开关决定 step 帧的出网形态：
 *   - 开关开启：走 sanitizeStepFrame，只保留白名单字段；
 *   - 开关关闭：恢复白名单引入前的 `{ step, ...data }` 原样透传。
 */
export function buildStepFrame(
  step: string,
  data?: Record<string, any>,
): Record<string, any> {
  if (!isStreamFrameWhitelistEnabled()) {
    return { step, ...(data ?? {}) };
  }
  return sanitizeStepFrame(step, data);
}
