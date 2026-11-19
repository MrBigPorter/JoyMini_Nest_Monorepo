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
 *   await runWithContext(
 *     { traceId: req.id, userId },
 *     () => this.aiCustomerService.chatStream(...),
 *   );
 *   // 之后链路里任何地方：
 *   const traceId = getTraceId();       // → req.id，或 undefined
 *   const userId = getRequestUserId();  // → 登录用户，或 undefined
 *
 * ── 为什么把 userId 也放在这里？ ──
 * AI 工具是启动时注册的全局单例，不能为每个用户各建一份。
 * 如果工具从模型参数里拿 userId，模型就能伪造身份；
 * 如果启动时绑定一个 userId，所有用户会共用同一个身份。
 * 把 userId 绑在异步上下文上，才能做到「工具是单例，身份按请求隔离」。
 */

/** 存在异步上下文里的数据结构。 */
interface RequestContext {
  traceId?: string;
  userId?: string;
}

/**
 * 模块级单例：整个进程只有一个"工牌架"。
 * 注意它保存的不是某一个值，而是"当前异步上下文的映射"。
 */
const storage = new AsyncLocalStorage<RequestContext>();

function normalize(value: string | undefined): string | undefined {
  // trim() 防止客户端传来 "   " 这种看起来有值、实际是空的 ID
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

/**
 * 在请求上下文中执行 fn。
 *
 * 嵌套调用时合并父上下文：内层只覆盖自己显式提供的字段。
 * 例如外层只有 traceId，内层只提供 userId，内层仍能读到外层的 traceId。
 *
 * @param context 要绑定的请求字段；空串 / 空白 / undefined 会被忽略。
 * @param fn      同步或异步函数。
 */
export function runWithContext<T>(
  context: { traceId?: string; userId?: string },
  fn: () => T,
): T {
  const parent = storage.getStore();
  const next: RequestContext = { ...parent };

  const traceId = normalize(context.traceId);
  const userId = normalize(context.userId);
  if (traceId) next.traceId = traceId;
  if (userId) next.userId = userId;

  return storage.run(next, fn);
}

/**
 * 在指定 traceId 的上下文中执行 fn（保留旧签名，兼容既有调用方）。
 *
 * 空串 / 空白 / undefined 时直接执行 fn，不创建新上下文；
 * 若调用方已在某个上下文中，则继续继承父上下文。
 */
export function runWithTrace<T>(traceId: string | undefined, fn: () => T): T {
  const normalized = normalize(traceId);
  if (!normalized) return fn();
  return runWithContext({ traceId: normalized }, fn);
}

/**
 * 读取当前异步上下文的 traceId
 *
 * @returns 当前上下文里的 traceId；不在上下文中时返回 undefined。
 */
export function getTraceId(): string | undefined {
  return storage.getStore()?.traceId;
}

/**
 * 读取当前请求的登录用户 ID。
 *
 * AI 工具用它做身份校验；业务代码仍应优先使用显式传入的 userId。
 * 没有上下文时返回 undefined，调用方必须 fail-closed（拒绝执行），
 * 不能回退到模型传参或默认用户。
 */
export function getRequestUserId(): string | undefined {
  return storage.getStore()?.userId;
}
