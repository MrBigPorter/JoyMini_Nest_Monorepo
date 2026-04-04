/**
 * vitest mock for `server-only`
 * 在测试环境中，server-only 的运行时检查不适用（测试本身就不是浏览器）。
 * 这里导出一个空模块，让 vitest 不报错，同时保持生产环境的真实保护不变。
 */
export {};
