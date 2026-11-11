import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * 请求级追踪上下文（trace context）
 *
 * ═══════════════════════════════════════════════════════════════
 * 🏷️ 生活类比：给每次请求发一张"工牌"
 * ═══════════════════════════════════════════════════════════════
 *
 * 想象一个商场：每个顾客进门时领一张工牌，上面写着流水号。
 * 顾客走到哪家店（controller → service → graph → 检索层），
 * 店员低头看工牌就知道"这单属于谁"。
 *
 * 我们不用把工牌一个个手递手传下去（那要改十几个函数签名），
 * 而是用一个"全商场共享的工牌架"——Node 的 AsyncLocalStorage。
 * 同一个异步调用链上的任何代码，随时调用 getTraceId() 都能拿到
 * 自己这次请求的流水号。
 *
 * ── 为什么必须是 AsyncLocalStorage，不能用一个全局变量？ ──
 * 全局变量被 5 个并发请求共享，A 请求刚写入 "001"，
 * B 请求立刻覆盖成 "002"，A 后面的日志就全串了。
 * AsyncLocalStorage 把值绑定在"异步上下文"上，各条调用链互不干扰。
 *
 * ── 使用方式 ──
 *   await runWithTrace(req.id, () => this.aiCustomerService.chatStream(...));
 *   // 之后链路里任何地方：
 *   const traceId = getTraceId(); // → req.id，或 undefined
 */

/** 存在异步上下文里的数据结构。后续要加 userId 等字段时在这里扩展。 */
interface TraceContext {
  traceId: string;
}

/**
 * 模块级单例：整个进程只有一个"工牌架"。
 * 注意它保存的不是某一个值，而是"当前异步上下文的映射"。
 */
const storage = new AsyncLocalStorage<TraceContext>();

/**
 * 在指定 traceId 的上下文中执行 fn
 *
 * @param traceId 请求 ID；空串 / 空白 / undefined 时视为"没有工牌"，
 *                直接执行 fn，不创建上下文（日志器会降级为 "-"）。
 * @param fn      要执行的函数，可以是同步函数，也可以是返回 Promise 的异步函数。
 * @returns       fn 的返回值（包括 Promise 本身）。
 *
 * ⚠️ 关键点：fn 内部的 await / setTimeout / Promise 链都会自动继承这个上下文。
 *    不需要在每一层手动传 traceId。
 */
export function runWithTrace<T>(traceId: string | undefined, fn: () => T): T {
  // trim() 防止客户端传来 "   " 这种看起来有值、实际是空的 ID
  const normalized = traceId?.trim();

  // 没有有效 ID → 不创建上下文。getTraceId() 后续会返回 undefined，
  // 日志器据此降级，而不是抛错。
  if (!normalized) return fn();

  return storage.run({ traceId: normalized }, fn);
}

/**
 * 读取当前异步上下文的 traceId
 *
 * @returns 当前上下文里的 traceId；不在 runWithTrace 内时返回 undefined。
 */
export function getTraceId(): string | undefined {
  return storage.getStore()?.traceId;
}
