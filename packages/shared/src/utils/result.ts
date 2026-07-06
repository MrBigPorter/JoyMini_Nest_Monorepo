/**
 * result.ts — Result 类型工具
 *
 * 提供类型安全的错误处理模式，替代 try-catch 的隐式类型丢失问题。
 *
 * ── 用法 ──
 *
 * 方案 A（推荐）：Result 判别联合类型
 * ```ts
 * import { toResult } from '@lucky/shared';
 *
 * const result = await toResult(someAsyncFunction());
 * if (result.success) {
 *   console.log(result.data); // 类型安全
 * } else {
 *   console.error(result.error.message);
 * }
 * ```
 *
 * 方案 B：链式调用风格（保留原始 API）
 * ```ts
 * import { toResultChain } from '@lucky/shared';
 *
 * await toResultChain(someAsyncFunction())
 *   .then((data) => console.log(data))
 *   .catch((err) => console.error(err.message));
 * ```
 */

// ============================================================
// 方案 A — Result 判别联合类型
// ============================================================

/**
 * Result 类型 — 显式成功/失败分支
 *
 * 相比 try-catch，Result 类型的好处：
 * - 类型安全：data 和 error 都有完整类型推导
 * - 显式处理：调用方必须处理 success/failure 两种可能
 * - 可组合：多个 Result 可以链式组合
 *
 * @example
 * type ApiResult = Result<User[], AppError>;
 * const r: ApiResult = { success: true, data: users };
 * const e: ApiResult = { success: false, error: new AppError('not_found') };
 */
export type Result<T, E = Error> =
  | { success: true; data: T }
  | { success: false; error: E };

/**
 * 将 Promise 包装为 Result 类型
 *
 * 自动捕获 reject/throw，统一返回 { success, data | error } 结构。
 * 调用方通过解构或 .success 判断分支，TypeScript 自动推导 data/error 类型。
 *
 * @param promise - 任意 Promise
 * @returns Promise<Result<T, Error>>
 *
 * @example
 * const { success, data, error } = await toResult(fetchUser(id));
 * if (!success) throw error;
 * console.log(data.name); // 类型安全
 */
export async function toResult<T>(
  promise: Promise<T>,
): Promise<Result<T, Error>> {
  try {
    const data = await promise;
    return { success: true, data };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}

/**
 * toResult 的同步版本 — 包装可能 throw 的同步函数
 *
 * @param fn - 可能 throw 的同步函数
 * @returns Result<T, Error>
 *
 * @example
 * const result = toResultSync(() => JSON.parse(rawJson));
 * if (!result.success) return fallback;
 * return result.data;
 */
export function toResultSync<T>(fn: () => T): Result<T, Error> {
  try {
    return { success: true, data: fn() };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}

// ============================================================
// 方案 B — 链式调用风格（toResultChain）
// ============================================================

/**
 * 链式 Result 包装器
 *
 * 保留原始 Promise 链式风格，提供 .then().catch() 连续调用。
 * 类型安全的泛型版本，修复了硬编码 string 的问题。
 *
 * @example
 * await toResultChain(fetchData())
 *   .then((data) => transform(data))
 *   .catch((err) => fallback);
 *
 * // 也可直接 .catch（无 .then）
 * await toResultChain(fetchData())
 *   .catch((err) => 'default');
 */
export function toResultChain<T, E = Error>(promise: Promise<T>) {
  return {
    then: <R>(onFulfilled: (value: T) => R) => ({
      catch: <F>(onRejected: (err: E) => F): Promise<R | F> =>
        promise.then(onFulfilled).catch(onRejected as (reason: unknown) => F),
    }),
    catch: <F>(onRejected: (err: E) => F): Promise<T | F> =>
      promise.catch(onRejected as (reason: unknown) => F),
  };
}
