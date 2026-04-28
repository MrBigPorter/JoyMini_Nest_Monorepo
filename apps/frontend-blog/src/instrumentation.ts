/**
 * Next.js Instrumentation — 服务端初始化钩子
 * Next.js Instrumentation — server-side lifecycle hook
 *
 * 这个文件是 Next.js 15 的标准钩子，在服务器启动时执行一次。
 * 用于初始化需要在第一次请求前就准备好的服务（如监控 SDK）。
 *
 * This file is a standard Next.js 15 hook, executed once on server startup.
 * Used to initialize services that must be ready before the first request (e.g. monitoring SDKs).
 *
 * Cloudflare Workers 部署说明：
 *   frontend-blog 部署到 Cloudflare Workers，所有 SSR 运行在 edge runtime（非 nodejs）。
 *   动态 import 确保 Sentry edge bundle 按需加载，避免冷启动 bundle 膨胀。
 */

const parseRate = (value: string | undefined, fallback: number) => {
  if (!value) return fallback;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : fallback;
};

export async function register() {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

  // Skip entirely when DSN is absent — avoids loading Sentry at all in CI / local dev.
  if (!dsn) return;

  const isProdRuntime = process.env.NODE_ENV === 'production';
  const enableNonProd = process.env.NEXT_PUBLIC_SENTRY_ENABLE_DEV === 'true';
  const enabled = Boolean(dsn) && (isProdRuntime || enableNonProd);

  const appEnv =
    process.env.NEXT_PUBLIC_APP_ENV ?? process.env.NODE_ENV ?? 'development';
  const sentryDebug = process.env.NEXT_PUBLIC_SENTRY_DEBUG === 'true';

  const previewTraceFallback = appEnv === 'preview' ? 0.1 : 0;
  const tracesSampleRate = parseRate(
    process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE,
    previewTraceFallback,
  );

  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Standard Node.js runtime (local dev + self-hosted Docker).
    const { init } = await import('@sentry/nextjs');

    init({
      dsn,
      enabled,
      environment: appEnv,
      debug: sentryDebug,
      tracesSampleRate,
      sendDefaultPii: false,
    });
    return;
  }

  if (process.env.NEXT_RUNTIME === 'edge') {
    // Cloudflare Workers edge runtime.
    const { init } = await import('@sentry/nextjs');
    init({
      dsn,
      enabled,
      environment: appEnv,
      debug: sentryDebug,
      tracesSampleRate,
      sendDefaultPii: false,
    });
  }
}

/**
 * SSR 错误捕获钩子 — Next.js 15 专属。
 * SSR error capture hook — Next.js 15 exclusive.
 *
 * Next.js 在 Server Component / Route Handler / Middleware 抛错时自动调用此函数，
 * 无需额外包裹 try/catch。对应 client 侧的 global-error.tsx。
 *
 * Next.js calls this automatically when a Server Component / Route Handler / Middleware throws.
 * No extra try/catch needed. Counterpart to global-error.tsx on the client side.
 */
export { captureRequestError as onRequestError } from '@sentry/nextjs';
