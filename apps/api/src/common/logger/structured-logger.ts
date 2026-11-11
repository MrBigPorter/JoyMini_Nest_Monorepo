import { getTraceId } from './trace-context';

/**
 * 结构化日志器（structured logger）
 *
 * ═══════════════════════════════════════════════════════════════
 * 🏷️ 生活类比：给每件快递贴一张标准面单
 * ═══════════════════════════════════════════════════════════════
 *
 * 以前的日志像快递员随手写在纸箱上的字：
 *   [chatStream] message="怎么退货..."
 *   [orchestrator] processing labels: order:0.87
 * 每个中转站写法都不一样，机器没法读，只能人眼看。
 *
 * 这个模块做的事就是"统一面单"：每条日志都是一个 JSON 对象，
 * 固定带 ts / level / traceId / stage，其余字段按需追加。
 * Loki 的 `| json` 解析器可以直接取字段做统计。
 *
 * ── 为什么不经过 Nest Logger？ ──
 * Nest Logger 会在每行前面加 `[Nest] pid - 时间 LOG [Context]`
 * 并且自动加 ANSI 颜色码，整行就不是合法 JSON 了，Loki 解析失败。
 * 所以这里直接写 stdout：一行一个 JSON 对象，干净、可解析。
 *
 * ── 三条硬性约束 ──
 * 1. 不记录内容：用户消息、AI 回答、密码、token 等字段一律丢弃。
 * 2. 绝不抛错：序列化失败、stdout 写失败都只降级，不能影响业务。
 * 3. 单行：不含换行，保证 Loki 一条日志一个对象。
 */

/** 允许的事件类型。新增阶段必须加到这里，防止日志里出现拼写不一致的 stage。 */
export type Stage =
  | 'chat.start'
  | 'intent'
  | 'retrieval'
  | 'llm.usage'
  | 'tool.start'
  | 'tool.end'
  | 'transfer'
  | 'chat.done'
  | 'chat.error'
  | 'logger.error';

export type LogLevel = 'info' | 'warn' | 'error';

/**
 * 禁止输出的字段名（小写比较）。
 *
 * 为什么用黑名单而不是白名单？
 * 每个 stage 的字段不同（intent 有 labels，retrieval 有 layers），
 * 白名单会逼着每次加字段都改日志器。黑名单只拦"绝对不能出现"的，
 * 覆盖用户内容、凭据和常见 PII。
 */
const FORBIDDEN_KEYS = new Set([
  // 对话内容
  'message',
  'msg',
  'content',
  'answer',
  'text',
  'prompt',
  'query',
  // 凭据
  'password',
  'token',
  'accesstoken',
  'refreshtoken',
  'authorization',
  'cookie',
  'apikey',
  'secret',
  // 联系方式
  'phone',
  'email',
  'address',
]);

/**
 * 输出一行结构化日志
 *
 * @param stage  事件阶段（枚举，防止拼写漂移）
 * @param fields 该阶段的业务字段；禁止字段会自动丢弃
 * @param level  日志级别，默认 info；会被 Promtail 提升为 Loki label
 *
 * 用法：
 *   emitStage('intent', { intent: 'order', labels, latencyMs });
 *   emitStage('chat.error', { errorName, errorMessage }, 'error');
 */
export function emitStage(
  stage: Stage,
  fields: Record<string, unknown> = {},
  level: LogLevel = 'info',
): void {
  try {
    const event: Record<string, unknown> = {
      ts: new Date().toISOString(),
      level,
      app: 'api',
      env: process.env.NODE_ENV ?? 'development',
      // 没有 trace 上下文时用 '-'，保证字段永远存在、查询不会因为缺字段而漏行
      traceId: getTraceId() ?? '-',
      stage,
      ...sanitizeFields(fields),
    };

    process.stdout.write(JSON.stringify(event) + '\n');
  } catch {
    // 埋点失败不能影响业务：再尝试写一条最小降级日志，仍然失败就彻底静默。
    try {
      process.stdout.write(
        JSON.stringify({
          ts: new Date().toISOString(),
          level: 'warn',
          app: 'api',
          env: process.env.NODE_ENV ?? 'development',
          traceId: getTraceId() ?? '-',
          stage: 'logger.error',
          reason: 'serialize_failed',
          originalStage: stage,
        }) + '\n',
      );
    } catch {
      // stdout 都写不了（例如 EPIPE）时，没有更安全的动作了。
    }
  }
}

/**
 * 过滤字段：丢弃禁止键、函数、undefined、symbol，并把 Error 转成普通对象。
 *
 * 只处理顶层字段。业务字段都应该是扁平的标量/数组/简单对象；
 * 如果传进来递归引用，JSON.stringify 会抛错，由 emitStage 兜底降级。
 */
function sanitizeFields(
  fields: Record<string, unknown>,
): Record<string, unknown> {
  const cleaned: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(fields)) {
    if (FORBIDDEN_KEYS.has(key.toLowerCase())) continue;

    if (value === undefined || typeof value === 'function') continue;
    if (typeof value === 'symbol') continue;

    if (value instanceof Error) {
      cleaned[key] = { name: value.name, message: value.message };
      continue;
    }

    if (typeof value === 'bigint') {
      cleaned[key] = value.toString();
      continue;
    }

    cleaned[key] = value;
  }

  return cleaned;
}
