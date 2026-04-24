/**
 * Vitest mock for @sentry/nextjs.
 *
 * Prevents the real @sentry/nextjs → @sentry/node → @opentelemetry/instrumentation
 * dependency chain from being loaded in the test environment.
 *
 * Only exports the APIs used by test-reachable code (sentry-span.ts).
 * instrumentation.ts and instrumentation-client.ts are Next.js special files
 * that only run during build/server, not in Vitest.
 */

import { vi } from 'vitest';

export const startSpan = vi.fn();
