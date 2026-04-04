/**
 * Sentry 客户端 Instrumentation — 浏览器端初始化入口
 * Sentry client instrumentation — browser-side init entry point
 *
 * Next.js 15 会在浏览器端自动执行这个文件（非 React 组件，纯 JS 入口）。
 * Next.js 15 auto-executes this file in the browser (not a React component, plain JS entry).
 *
 * 使用 @sentry/nextjs（而非 @sentry/browser）：
 *   - 自动适配 App Router RSC 错误边界
 *   - 支持 onRouterTransitionStart（Next.js 15 路由跳转 span）
 *   - 客户端 bundle 与 @sentry/browser 体积相当，不影响 Cloudflare 限额
 *
 * NOTE: global-error.tsx 仍然 import @sentry/browser（避免被 Next.js 追踪进 server bundle 导致体积暴涨）。
 * 两个包共享同一个 @sentry/core 单例，初始化在此处完成后 global-error.tsx 可直接调用 captureException。
 */
import * as Sentry from '@sentry/nextjs';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
const appEnv =
  process.env.NEXT_PUBLIC_APP_ENV ?? process.env.NODE_ENV ?? 'development';
const isProdRuntime = process.env.NODE_ENV === 'production';
const enableNonProd = process.env.NEXT_PUBLIC_SENTRY_ENABLE_DEV === 'true';
const sentryDebug = process.env.NEXT_PUBLIC_SENTRY_DEBUG === 'true';

const parseRate = (value: string | undefined, fallback: number) => {
  if (!value) return fallback;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : fallback;
};

const previewTraceFallback = appEnv === 'preview' ? 0.1 : 0;
const previewProfileFallback = appEnv === 'preview' ? 0.02 : 0;
const tracesSampleRate = parseRate(
  process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE,
  previewTraceFallback,
);
const profilesSampleRate = parseRate(
  process.env.NEXT_PUBLIC_SENTRY_PROFILES_SAMPLE_RATE,
  previewProfileFallback,
);

// Dev-time guard: warn when DSN is not configured so the issue is immediately visible.
// In production this means Sentry is silently disabled (no events sent to sentry.io).
// Fix: Set NEXT_PUBLIC_SENTRY_DSN in GitHub → Settings → Environments → production → Secrets.
if (!dsn && process.env.NODE_ENV !== 'production') {
  console.warn(
    '[Sentry] NEXT_PUBLIC_SENTRY_DSN is not set. ' +
      'Sentry will NOT collect errors. ' +
      'Set the secret in GitHub → Settings → Environments → production → Secrets.',
  );
}

Sentry.init({
  /**
   * DSN 通过环境变量注入，不硬编码。
   * DSN is injected via env var, not hardcoded.
   * 设置方式（二选一）：
   *   1. GitHub Secrets → NEXT_PUBLIC_SENTRY_DSN（推荐，CI/CD 自动注入）
   *   2. apps/admin-next/.env.production.local（仅本地 production build 测试用）
   */
  dsn,

  // Production defaults to enabled; non-production can be opt-in via NEXT_PUBLIC_SENTRY_ENABLE_DEV=true.
  enabled: Boolean(dsn) && (isProdRuntime || enableNonProd),

  // Tag events by deployment environment (production / preview / development).
  environment: appEnv,

  // Print SDK internal debug logs when troubleshooting test/preview environment.
  debug: sentryDebug,

  // Keep production overhead near-zero by default; preview/test can opt in with low sampling.
  tracesSampleRate,
  profilesSampleRate,

  // Browser profiling: must be explicitly registered as an integration (Sentry v8+).
  // profilesSampleRate alone is not enough — the integration activates the sampling hooks.
  integrations: [Sentry.browserProfilingIntegration()],

  // Error-only mode: do not attach user PII by default.
  sendDefaultPii: false,

  ignoreErrors: [
    'ResizeObserver loop limit exceeded',
    'ResizeObserver loop completed with undelivered notifications',
    'Network Error',
    'Failed to fetch',
    /^AbortError/,
  ],
});

/**
 * Next.js 15 App Router 路由跳转钩子。
 * Next.js 15 App Router route transition hook.
 *
 * 每次客户端导航（Link / router.push）都会触发此函数，
 * @sentry/nextjs 将其包装为一个 Sentry span，方便在 Tracing 里看到路由切换耗时。
 * Each client-side navigation fires this function;
 * @sentry/nextjs wraps it as a Sentry span so you can see route transition duration in Tracing.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- Next.js convention export consumed by the framework, not imported by user code
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
