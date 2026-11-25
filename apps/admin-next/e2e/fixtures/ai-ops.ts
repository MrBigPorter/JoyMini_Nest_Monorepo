/**
 * AI Ops E2E fixtures.
 *
 * Design goals:
 *   1. Deterministic: every /api request is fulfilled locally, no backend.
 *   2. No secrets: the session is a structurally valid *fake* JWT only used to
 *      pass the middleware's exp check. No real credentials are involved.
 *   3. Test-only: lives under apps/admin-next/e2e, never imported by app code.
 *
 * The middleware (src/middleware.ts) only decodes the JWT payload and checks
 * `exp`; it does not verify the signature. That lets us mint a throwaway token
 * without any signing key.
 */
import { test as base, expect, type Page } from '@playwright/test';

export { expect };

const DEFAULT_ORIGIN = 'http://127.0.0.1:4001';

/** Build a fake, unsigned JWT that passes middleware exp validation. */
function makeFakeJwt(role: string): string {
  const encode = (value: object) =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
  return [
    encode({ alg: 'none', typ: 'JWT' }),
    encode({
      sub: 'e2e-admin',
      role,
      exp: Math.floor(Date.now() / 1000) + 60 * 60,
    }),
    'e2e-signature-not-verified',
  ].join('.');
}

const NOW = '2026-11-21T10:00:00.000Z';

const ADMIN_USER = {
  id: 'admin-e2e',
  username: 'e2e-admin',
  roleId: 'role-admin',
  roleName: 'ADMIN',
  role: 'ADMIN',
  status: 1,
  lastLogin: NOW,
  lastLoginIp: '127.0.0.1',
};

const QUEUES = [
  {
    name: 'ai-processing',
    waiting: 2,
    active: 1,
    completed: 10,
    failed: 1,
    delayed: 0,
    paused: 0,
    total: 14,
    isPaused: false,
  },
  {
    name: 'rag-embedding',
    waiting: 0,
    active: 0,
    completed: 5,
    failed: 0,
    delayed: 0,
    paused: 0,
    total: 5,
    isPaused: false,
  },
];

const FAILED_JOBS = [
  {
    messageId: 'msg-failed-1',
    conversationId: 'conv-failed-1',
    attemptsMade: 3,
    failedReason: 'model timeout',
    failedAt: NOW,
  },
];

const OUTBOX = [
  {
    id: 'outbox-1',
    messageId: 'msg-outbox-1',
    conversationId: 'conv-outbox-1',
    userId: 'user-1',
    status: 'FAILED',
    attempts: 2,
    lastError: 'queue unavailable',
    nextAttemptAt: NOW,
    sentAt: null,
    createdAt: NOW,
  },
];

const USAGE_SUMMARY = {
  range: { from: '2026-11-21', to: '2026-11-21', timezone: 'UTC' },
  coverage: { scope: 'global', note: 'mocked' },
  totals: {
    promptTokens: 1200,
    completionTokens: 800,
    totalTokens: 2000,
    requests: 4,
    users: 2,
  },
  pricing: {
    inputPer1M: 0.5,
    outputPer1M: 1,
    currency: 'USD',
    configured: true,
  },
  cost: {
    inputCost: 0.0006,
    outputCost: 0.0008,
    totalCost: 0.0014,
    currency: 'USD',
    configured: true,
  },
  quota: {
    dailyTokenLimit: 100000,
    sessionTokenLimit: 10000,
    dailyCostLimit: 5,
  },
  daily: [],
};

const FEEDBACK_SUMMARY = {
  total: 3,
  pending: 1,
  byFailureKind: [
    { failureKind: 'MODEL_ERROR', count: 1 },
    { failureKind: 'SERVICE_ERROR', count: 1 },
    { failureKind: 'UNEXPECTED_TRANSFER', count: 0 },
  ],
  byResolution: [{ resolution: 'ADDED_TO_EVAL', count: 1 }],
};

const FEATURES = {
  feedbackUiEnabled: true,
  evalEnabled: true,
};

const FEEDBACK_LIST = {
  list: [
    {
      id: 'feedback-1',
      conversationId: 'conv-quality-1',
      input: 'What is the refund policy?',
      answer: 'Refunds are available within 7 days.',
      messageId: 'msg-quality-1',
      userId: 'user-quality-1',
      source: 'explicit',
      verdict: 'incorrect',
      errorType: 'wrong_answer',
      signal: 'thumbs_down',
      note: 'Answer missed the 7-day window detail.',
      adminId: null,
      reviewStatus: 'PENDING',
      failureKind: 'MODEL_ERROR',
      resolution: null,
      createdAt: NOW,
    },
    {
      id: 'feedback-2',
      conversationId: 'conv-quality-2',
      input: 'Where is my order?',
      answer: 'Please wait while I check.',
      messageId: 'msg-quality-2',
      userId: 'user-quality-2',
      source: 'implicit',
      verdict: null,
      errorType: null,
      signal: 'transferred',
      note: null,
      adminId: null,
      reviewStatus: 'PENDING',
      failureKind: 'UNEXPECTED_TRANSFER',
      resolution: null,
      createdAt: NOW,
    },
  ],
  total: 2,
};

const SLA_QUEUE = {
  thresholdMinutes: 15,
  items: [
    {
      conversationId: 'conv-sla-1',
      transferredAt: NOW,
      transferReason: 'customer_request',
      lastMessage: 'I need a human agent',
      lastMessageAt: NOW,
      waitingSeconds: 900,
      breached: true,
    },
  ],
};

const SLA_HISTORY = {
  windowHours: 24,
  thresholdMinutes: 15,
  latest: {
    id: 'sla-1',
    waiting: 1,
    breached: 1,
    longestWait: 900,
    createdAt: NOW,
  },
  snapshots: [
    {
      id: 'sla-1',
      waiting: 1,
      breached: 1,
      longestWait: 900,
      createdAt: NOW,
    },
  ],
};

const SECURITY_SUMMARY = {
  total: 3,
  byType: [
    { type: 'prompt_override', count: 2 },
    { type: 'internal_probe', count: 1 },
  ],
  byMode: [
    { mode: 'log', count: 2 },
    { mode: 'enforce', count: 1 },
  ],
  byStatus: [
    { status: 'NEW', count: 2 },
    { status: 'CONFIRMED', count: 1 },
  ],
  latestAt: NOW,
  mode: 'log',
};

const SECURITY_EVENTS = {
  list: [
    {
      id: 'security-1',
      type: 'prompt_override',
      mode: 'log',
      length: 42,
      userIdHash: 'abcdef1234567890',
      conversationId: 'conv-security-1',
      status: 'NEW',
      createdAt: NOW,
    },
  ],
  total: 1,
  page: 1,
  pageSize: 20,
};

const RAG_QUALITY_STATS = {
  total: 0,
  needReview: 0,
  byScore: { excellent: 0, good: 0, fair: 0, suspicious: 0 },
  recentFlags: [],
};

const CONTEXT_SNAPSHOT = {
  conversationId: 'conv-context-1',
  threadId: 'thread-context-1',
  checkpointId: 'checkpoint-context-1',
  flowState: {
    flow: 'order_flow',
    flowType: 'ORDER',
    step: 'confirm',
    status: 'active',
    slots: { sku: 'SKU-1' },
  },
  contextState: {
    activeEntity: 'Order #1001',
    slots: { size: 'M', color: 'blue' },
    corrections: [{ from: 'red', to: 'blue', at: NOW }],
    unresolved: ['coupon code'],
  },
  pendingConfirm: {
    action: 'create_order',
    summary: 'Create order for SKU-1',
    params: { sku: 'SKU-1', qty: 1 },
  },
  previousIntent: 'order_create',
  messages: [
    { type: 'human', content: 'I want to order a blue shirt' },
    { type: 'ai', content: 'Sure, which size?' },
  ],
  checkpoints: [],
};

export interface RecordedRequest {
  method: string;
  path: string;
  search: URLSearchParams;
}

export interface ApiRecorder {
  requests: RecordedRequest[];
  /** All requests captured for a given API path (ignores query string). */
  forPath: (path: string) => RecordedRequest[];
}

function ok(data: unknown) {
  return JSON.stringify({ code: 10000, message: 'ok', data });
}

function installApiMocks(
  page: Page,
  origin: string,
  role: string,
): ApiRecorder {
  const requests: RecordedRequest[] = [];
  const recorder: ApiRecorder = {
    requests,
    forPath: (path) => requests.filter((r) => r.path === path),
  };

  // 1. Hermetic guard: never let the browser talk to anything but the local app.
  void page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.origin === origin) {
      return route.continue();
    }
    return route.abort();
  });

  // 2. Mock the whole admin API surface used by AI Ops pages.
  void page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const path = url.pathname.replace(/^\/api/, '');
    requests.push({ method, path, search: url.searchParams });

    const fulfill = (data: unknown) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: ok(data),
      });

    // Mutable actions — mocked success, no real side effects.
    if (
      method === 'POST' &&
      /^\/v1\/admin\/chat\/conversations\/[^/]+\/claim$/.test(path)
    ) {
      const conversationId = path.split('/')[5];
      return fulfill({ success: true, conversationId, handlerId: 'admin-e2e' });
    }
    if (
      method === 'PATCH' &&
      /^\/v1\/admin\/chat\/conversations\/[^/]+\/close$/.test(path)
    ) {
      const conversationId = path.split('/')[5];
      return fulfill({ success: true, conversationId });
    }
    if (
      method === 'PATCH' &&
      path.startsWith('/v1/admin/ai-security/events/')
    ) {
      return fulfill({ id: path.split('/').pop(), status: 'CONFIRMED' });
    }
    if (method === 'PATCH' && path.startsWith('/v1/admin/ai-feedback/')) {
      return fulfill({ id: path.split('/').pop(), reviewStatus: 'REVIEWED' });
    }

    // Reads.
    switch (path) {
      case '/v1/auth/admin/me':
        return fulfill({ ...ADMIN_USER, role, roleName: role });
      case '/v1/admin/queues':
        return fulfill(QUEUES);
      case '/v1/admin/ai-ops/features':
        // 写入口由服务端开关决定；冒烟测试需要覆盖可写与禁用两种状态。
        return fulfill(FEATURES);
      case '/v1/admin/queues/ai/failed':
        return fulfill(FAILED_JOBS);
      case '/v1/admin/queues/ai/outbox':
        return fulfill(OUTBOX);
      case '/v1/admin/ai-usage/summary':
        return fulfill(USAGE_SUMMARY);
      case '/v1/admin/ai-feedback/summary':
        return fulfill(FEEDBACK_SUMMARY);
      case '/v1/admin/ai-feedback':
        return fulfill(FEEDBACK_LIST);
      case '/v1/admin/ai-eval/datasets':
        return fulfill([]);
      case '/v1/admin/chat/sla/queue':
        return fulfill(SLA_QUEUE);
      case '/v1/admin/chat/sla':
        return fulfill(SLA_HISTORY);
      case '/v1/admin/ai-security/summary':
        return fulfill(SECURITY_SUMMARY);
      case '/v1/admin/ai-security/events':
        return fulfill(SECURITY_EVENTS);
      case '/v1/admin/rag/documents/quality-stats':
        return fulfill(RAG_QUALITY_STATS);
      default:
        break;
    }

    if (method === 'GET' && path.startsWith('/v1/admin/ai-context/')) {
      const conversationId = decodeURIComponent(
        path.slice('/v1/admin/ai-context/'.length),
      );
      return fulfill({ ...CONTEXT_SNAPSHOT, conversationId });
    }

    // Unknown read: return an empty success so polling never errors out.
    return fulfill(null);
  });

  return recorder;
}

/** Remove the Next.js dev overlay so it cannot intercept clicks. */
export async function dismissDevOverlay(page: Page): Promise<void> {
  await page
    .evaluate(() => {
      document
        .querySelectorAll('nextjs-portal, [data-nextjs-dev-overlay]')
        .forEach((el) => el.remove());
    })
    .catch(() => {});
}

export const test = base.extend<{
  authenticated: boolean;
  role: string;
  api: ApiRecorder;
}>({
  /** Set `test.use({ authenticated: false })` for login/redirect specs. */
  authenticated: [true, { option: true }],
  /** Set `test.use({ role: 'VIEWER' })` to exercise the read-only shell. */
  role: ['ADMIN', { option: true }],

  api: [
    async ({ page, context, baseURL, authenticated, role }, use) => {
      const origin = new URL(baseURL ?? DEFAULT_ORIGIN).origin;

      if (authenticated) {
        // middleware reads the cookie; the dashboard fetchMe reads localStorage.
        await context.addCookies([
          { name: 'auth_token', value: makeFakeJwt(role), url: origin },
        ]);
        await context.addInitScript(() => {
          try {
            localStorage.setItem('auth_token', 'e2e-fake-session');
          } catch {
            // localStorage may be unavailable in some contexts; ignore.
          }
        });
      }

      const recorder = installApiMocks(page, origin, role);
      await use(recorder);
    },
    { auto: true },
  ],
});
