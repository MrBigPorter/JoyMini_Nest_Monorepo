/**
 * Tool 统一返回格式
 *
 * 所有 AI tool 必须返回此格式的 JSON 字符串。
 * LLM 通过检查 `ok` 字段判断调用结果。
 */

export type ToolResult<T extends Record<string, any> = Record<string, any>> =
  | { ok: true; data: T }
  | { ok: false; error: string };

interface ToolSuccess<T extends Record<string, any>> {
  ok: true;
  data: T;
}

/** 构建成功响应 */
export function toolSuccess<T extends Record<string, any>>(data: T): string {
  return JSON.stringify({ ok: true, data } satisfies ToolSuccess<T>, null, 2);
}

/** 构建失败响应 */
export function toolFailure(error: string): string {
  return JSON.stringify({ ok: false, error: error }, null, 2);
}

/**
 * 将 JSON 字符串解析回 ToolResult
 * 用于 agent node 中解析 tool 返回值
 */

export function parseToolResul<T extends Record<string, any>>(
  json: string,
): ToolResult<T> {
  return JSON.parse(json) as ToolResult<T>;
}

/**
 * 剥掉 { ok, data } 包装，只返回 LLM 需要看的内容
 *
 * Tool 函数使用 toolSuccess()/toolFailure() 返回 JSON 字符串，
 * 但 { ok, data } 包装是给 TypeScript 运行时用的（区分成功/失败），
 * LLM 不需要看到这个包装。此函数在创建 ToolMessage 前调用。
 *
 * - 成功 (ok: true) → 只返回 data 部分的 JSON
 * - 失败 (ok: false) → 返回 "Error: ..." 文本
 * - 无法解析 → 原样返回
 */
export function stripToolResult(raw: string): string {
  try {
    const parsed = JSON.parse(raw);
    if (parsed.ok === true && parsed.data !== undefined) {
      return JSON.stringify(parsed.data);
    }
    if (parsed.ok === false) {
      return `Error: ${parsed.error}`;
    }
  } catch {
    // 非 JSON 格式，原样返回
  }
  return raw;
}
