/**
 * Prisma 错误判定
 *
 * ── 为什么不用 `instanceof PrismaClientKnownRequestError`？ ──
 * Prisma 在 `@prisma/client/runtime/library`、`runtime/edge` 等
 * 多份 runtime 里各生成一份错误类。import 的那个类和运行时真正抛出的
 * 实例可能不是同一个构造函数，`instanceof` 会静默返回 false。
 *
 * 线上真实案例：删除不存在的地址时 `userAddress.delete()` 抛 P2025，
 * `instanceof` 判定失败 → 被当成未知异常 → `/confirm` 返回 500。
 * 只认错误码没有这个问题。
 */
export function isPrismaNotFoundError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 'P2025'
  );
}

/**
 * P2002：唯一约束冲突。用于把并发写入翻译成 409，
 * 而不是依赖应用层"先查后写"（两次请求都读到 null 时仍会撞库）。
 */
export function isPrismaUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 'P2002'
  );
}
