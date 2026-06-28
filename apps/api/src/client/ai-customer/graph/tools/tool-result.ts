/**
 * Tool 统一返回格式
 *
 * 所有 AI tool 必须返回此格式的 JSON 字符串。
 * LLM 通过检查 `ok` 字段判断调用结果。
 */

export type ToolResult<T extends Record<string, any> = Record<string, any>> =
  | { ok: true; data: T }
  | { ok: false; error: string };

/** 构建成功响应 */
export function toolSuccess<T extends Record<string, any>>(data: T): string {
  return JSON.stringify({ ok: true, data }, null, 2);
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
