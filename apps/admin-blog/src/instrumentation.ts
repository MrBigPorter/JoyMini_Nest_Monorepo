/**
 * Sentry instrumentation for admin-blog
 * Uses dynamic import pattern to avoid bloating the bundle
 */

const parseRate = (value: string | undefined, fallback: number) => {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export async function register() {
  // Only register Sentry in production or when explicitly enabled
  if (
    process.env.NEXT_RUNTIME === 'nodejs' &&
    (process.env.NEXT_PUBLIC_SENTRY_ENABLE_DEV === 'true' ||
      process.env.NODE_ENV === 'production')
  ) {
    try {
      const Sentry = await import('@sentry/nextjs');

      Sentry.init({
        dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
        tracesSampleRate: parseRate(
          process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE,
          0.1,
        ),
        environment: process.env.NODE_ENV,
        enabled: process.env.NODE_ENV === 'production',
        // Only instrument what matters
        integrations: [],
        // Reduce overhead
        attachStacktrace: false,
        autoSessionTracking: true,
      });
    } catch (e) {
      console.warn('[Sentry] Failed to initialize:', e);
    }
  }

  if (
    process.env.NEXT_RUNTIME === 'edge' &&
    (process.env.NEXT_PUBLIC_SENTRY_ENABLE_DEV === 'true' ||
      process.env.NODE_ENV === 'production')
  ) {
    try {
      const Sentry = await import('@sentry/nextjs');

      Sentry.init({
        dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
        tracesSampleRate: parseRate(
          process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE,
          0.1,
        ),
        environment: process.env.NODE_ENV,
        enabled: process.env.NODE_ENV === 'production',
        integrations: [],
        attachStacktrace: false,
        autoSessionTracking: true,
      });
    } catch (e) {
      console.warn('[Sentry] Failed to initialize:', e);
    }
  }
}

export async function onRequestError(
  error: { message: string; name: string; stack?: string; cause?: unknown },
  request: { url: string; method?: string; headers?: Record<string, string> },
) {
  try {
    const { captureRequestError } = await import('@sentry/nextjs');
    await captureRequestError(error, request);
  } catch {
    // Silently fail - Sentry is optional
  }
}
