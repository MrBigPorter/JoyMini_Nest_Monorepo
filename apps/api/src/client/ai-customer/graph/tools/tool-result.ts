/**
 * Tool 统一返回格式
 *
 * ── 是什么？ ──
 * Union Type（联合类型）—— TypeScript 的核心概念。
 * ToolResult<T> 要么是成功 { ok: true, data: T }，要么是失败 { ok: false, error: string }。
 * 所有 21 个 AI tool 必须返回此格式的 JSON 字符串。
 *
 * ── 为什么需要统一格式？ ──
 * 21 个工具（查余额、查订单、领优惠券等）各自返回不同形状的数据。
 * 统一格式让以下代码可以统一处理所有工具的结果：
 *   const parsed = JSON.parse(raw);
 *   if parsed.ok → use parsed.data (成功)
 *   else → show parsed.error (失败)
 *
 * ── 生活类比 ──
 * 就像快递包裹统一使用标准纸箱。不管里面装的是手机（小）还是电视（大），
 * 外箱上都统一贴一个标签：上面打钩（ok=true）表示货物完好，打叉（ok=false）表示破损。
 * 快递员（system）不需要拆开每个箱子检查，看标签就知道货物状态。
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
export function parseToolResult<T extends Record<string, any>>(
  json: string,
): ToolResult<T> {
  return JSON.parse(json) as ToolResult<T>;
}

/**
 * stripToolResult — 剥掉 { ok, data } 包装
 *
 * ── 是什么？ ──
 * Tool 函数使用 toolSuccess()/toolFailure() 返回 JSON 字符串，
 * 但 { ok, data } 包装是给 TypeScript 运行时用的（区分成功/失败），
 * LLM 不需要看到这个包装。此函数在创建 ToolMessage 前调用。
 *
 * ── 为什么需要剥离？ ──
 * LLM 看到的是 ToolMessage 的 content。如果 content 是
 * {"ok":true,"data":{"balance":"1500.00"}}，LLM 可能会困惑"ok 是什么意思？"。
 * 剥离后 LLM 看到的是 {"balance":"1500.00"}，自然就能理解。
 *
 * ── 生活类比 ──
 * 就像快递外箱上的标签是给快递员（TypeScript 运行时）看的。
 * 拆开箱子后，里面的商品是给收件人（LLM）看的。
 * stripToolResult 就是拆箱子的过程——去掉外包装，只给 LLM 看内容。
 *
 * ── 剥离规则 ──
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
