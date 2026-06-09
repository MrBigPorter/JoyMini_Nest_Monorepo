/**
 * Next.js Instrumentation — 服务端初始化钩子
 * Next.js Instrumentation — server-side lifecycle hook
 *
 * 这个文件是 Next.js 15 的标准钩子，在服务器启动时执行一次。
 * 用于初始化需要在第一次请求前就准备好的服务（如监控 SDK）。
 */

export async function register() {
  // No server-side monitoring services to initialize.
}

export async function onRequestError(
  _error: unknown,
  _request: {
    path: string;
    method: string;
    headers: Record<string, string | string[] | undefined>;
  },
  _context: { routerKind: string; routePath: string; routeType: string },
) {
  // No error reporting service configured.
}
