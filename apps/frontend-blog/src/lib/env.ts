/**
 * 🔍 多模式环境检测工具
 *
 * 正确识别三种运行环境:
 * - SSR: 服务端渲染 (Node.js 运行时)
 * - SSG: 静态生成 (构建时 Next.js 运行时)
 * - CSR: 客户端渲染 (浏览器运行时)
 *
 * 所有检测都是单例，只执行一次
 */

type RuntimeEnvironment = 'ssr' | 'ssg' | 'csr';

let cachedEnv: RuntimeEnvironment | null = null;

/**
 * 检测当前运行环境
 */
export function detectEnvironment(): RuntimeEnvironment {
  if (cachedEnv) return cachedEnv;

  // 浏览器客户端环境
  if (typeof window !== 'undefined') {
    cachedEnv = 'csr';
    return cachedEnv;
  }

  // 检测是否是构建阶段 (SSG)
  if (
    process.env.NEXT_PHASE === 'phase-production-build' ||
    process.env.NEXT_BUILD === 'true' ||
    globalThis.process?.argv.some((arg) => arg.includes('build'))
  ) {
    cachedEnv = 'ssg';
    return cachedEnv;
  }

  // 否则是服务端运行时 (SSR)
  cachedEnv = 'ssr';
  return cachedEnv;
}

/**
 * 是否在服务端环境 (SSR 或 SSG)
 */
export function isServer(): boolean {
  return detectEnvironment() !== 'csr';
}

/**
 * 是否在浏览器客户端环境
 */
export function isClient(): boolean {
  return detectEnvironment() === 'csr';
}

/**
 * 是否是构建时静态生成
 */
export function isBuildTime(): boolean {
  return detectEnvironment() === 'ssg';
}

/**
 * 是否是实时服务端渲染
 */
export function isRuntimeServer(): boolean {
  return detectEnvironment() === 'ssr';
}

/**
 * 获取环境名称用于调试
 */
export function getEnvironmentName(): string {
  const env = detectEnvironment();
  return {
    ssr: 'SSR',
    ssg: ' SSG',
    csr: 'CSR',
  }[env];
}
