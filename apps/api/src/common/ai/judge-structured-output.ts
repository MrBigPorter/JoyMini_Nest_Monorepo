/**
 * 判官结构化输出的共享约束（eval-ingestion-hardening D4）。
 *
 * 2026-11-26 真实调用确认（apps/api/scripts/probe-judge-structured-output.ts）：
 * - DeepSeek 只接受 jsonMode，jsonSchema 返回 400；
 * - Groq 两种都可用，但只对账号可访问的模型成立。
 * 因此取法固定 jsonMode，schema 保持宽容，解析失败回退既有文本解析。
 */
import { z } from 'zod';

/**
 * 结构化输出开关：默认开启，只有显式 false 才关闭。
 * provider 不支持时改环境变量即可整体退回纯文本，不必回滚代码。
 */
export function structuredOutputEnabled(value: unknown): boolean {
  if (value === undefined || value === null || value === '') return true;
  return String(value).trim().toLowerCase() !== 'false';
}

/**
 * 结构化调用返回的 `raw` 可能是消息对象（jsonMode 走消息），也可能是纯文本。
 * 留痕要的是正文，不能对对象直接 String()。
 */
export function rawOutputText(raw: unknown): string {
  if (typeof raw === 'string') return raw;
  const content = (raw as { content?: unknown })?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        const text = (part as { text?: unknown })?.text;
        return typeof text === 'string' ? text : '';
      })
      .join('');
  }
  return typeof raw === 'undefined' || raw === null ? '' : String(raw);
}

/**
 * 答案忠实度判官的结构化 schema。
 *
 * 保持宽容：分值允许数字或字符串（由后处理夹到 0..1），理由与声明列表可缺省，
 * 不开严格模式拒绝未知字段。裁剪与兜底仍由后处理完成，schema 不改变业务语义。
 */
export const FAITHFULNESS_JUDGE_SCHEMA = z.object({
  faithful: z.boolean(),
  score: z.union([z.number(), z.string()]).optional(),
  reason: z.string().optional(),
  unsupportedClaims: z.array(z.string()).optional(),
});

/**
 * 任务完成度判官（内部评测）的结构化 schema。
 * 同样宽容：三态是硬约束，分值与理由可缺省，越界/非数字在后处理收敛。
 */
export const TASK_JUDGE_SCHEMA = z.object({
  verdict: z.enum(['solved', 'partial', 'unsolved']),
  score: z.union([z.number(), z.string()]).optional(),
  reason: z.string().optional(),
});
