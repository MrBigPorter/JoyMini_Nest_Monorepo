/**
 * Batch 1 — real-backend permission contract tests.
 *
 * These tests hit a live QA API (not AppModule-in-process) so the global
 * prefix/version, guards, interceptors and exception filter are all exercised
 * exactly as in production:
 *   /api/v1/admin/...
 *
 * Prerequisites (see qa/reports/batch-1.md):
 *   1. QA Postgres/Redis up and migrated
 *   2. qa/seed/batch1.ts executed
 *   3. API started with qa/.env.qa on QA_API_URL
 *
 * Run: yarn workspace @lucky/api test:e2e:ai-ops
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';

const QA_ENV_FILE = path.resolve(__dirname, '../../../../qa/.env.qa');

function loadQaEnv(): void {
  if (!fs.existsSync(QA_ENV_FILE)) return;
  const raw = fs.readFileSync(QA_ENV_FILE, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    // QA env is authoritative: apps/api/.env points DATABASE_URL at the
    // docker-compose host `db`, which must never win here.
    process.env[key] = value;
  }
}

loadQaEnv();

const prisma = new PrismaClient();

afterAll(async () => {
  await prisma.$disconnect();
});

const API_BASE = (process.env.QA_API_URL ?? 'http://127.0.0.1:4102/api').replace(
  /\/$/,
  '',
);
const ADMIN_SECRET =
  process.env.ADMIN_JWT_SECRET ?? 'qa_admin_jwt_secret_change_me_0123456789';

const ROLE_IDS: Record<string, string> = {
  VIEWER: 'qa_admin_viewer',
  EDITOR: 'qa_admin_editor',
  ADMIN: 'qa_admin_admin',
  SUPER_ADMIN: 'qa_admin_super',
};

function tokenFor(role: keyof typeof ROLE_IDS): string {
  return jwt.sign(
    {
      sub: ROLE_IDS[role],
      role,
      type: 'admin',
      username: `qa_${role.toLowerCase()}`,
    },
    ADMIN_SECRET,
    { expiresIn: '1h' },
  );
}

interface ApiResult {
  status: number;
  body: any;
  data: any;
}

async function api(
  method: string,
  endpoint: string,
  role?: keyof typeof ROLE_IDS,
  body?: unknown,
): Promise<ApiResult> {
  const headers: Record<string, string> = {};
  if (role) headers.Authorization = `Bearer ${tokenFor(role)}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const res = await fetch(`${API_BASE}${endpoint}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: any = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = { raw: text };
  }
  return { status: res.status, body: parsed, data: parsed?.data };
}

async function waitForApi(): Promise<void> {
  const deadline = Date.now() + 15_000;
  let lastError = '';
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${API_BASE}/v1/health`);
      if (res.ok) return;
      lastError = `health status ${res.status}`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(
    `QA API not reachable at ${API_BASE} (${lastError}). ` +
      'Start it with qa/.env.qa before running this suite.',
  );
}

beforeAll(async () => {
  await waitForApi();
});

describe('Batch 1 — traces', () => {
  it('VIEWER list returns 200 with input/output null', async () => {
    const res = await api('GET', '/v1/admin/ai-traces', 'VIEWER');
    expect(res.status).toBe(200);
    expect(res.body.code).toBe(10000);
    expect(res.data.list.length).toBeGreaterThan(0);
    for (const row of res.data.list) {
      expect(row.input).toBeNull();
      expect(row.output).toBeNull();
    }
  });

  it('ADMIN/SUPER_ADMIN see raw trace input/output', async () => {
    for (const role of ['ADMIN', 'SUPER_ADMIN'] as const) {
      const res = await api('GET', '/v1/admin/ai-traces', role);
      expect(res.status).toBe(200);
      const row = res.data.list.find((item: any) => item.id === 'qa_trace_1');
      expect(row).toBeDefined();
      expect(row.input).toBe('qa_trace_input_secret');
      expect(row.output).toBe('qa_trace_output_secret');
    }
  });

  it('EDITOR is denied trace access (403)', async () => {
    const res = await api('GET', '/v1/admin/ai-traces', 'EDITOR');
    expect(res.status).toBe(403);
  });

  it('VIEWER detail redacts span input/output/error', async () => {
    const res = await api('GET', '/v1/admin/ai-traces/qa_trace_1', 'VIEWER');
    expect(res.status).toBe(200);
    expect(res.data.input).toBeNull();
    expect(res.data.output).toBeNull();
    expect(res.data.spans.length).toBeGreaterThan(0);
    for (const span of res.data.spans) {
      expect(span.input).toBeNull();
      expect(span.output).toBeNull();
      expect(span.error).toBeNull();
    }
  });

  it('ADMIN detail exposes raw span values', async () => {
    const res = await api('GET', '/v1/admin/ai-traces/qa_trace_1', 'ADMIN');
    expect(res.status).toBe(200);
    expect(res.data.input).toBe('qa_trace_input_secret');
    const span = res.data.spans.find((item: any) => item.id === 'qa_span_1');
    expect(span.input).toEqual({ qa: 'span_input_secret' });
    expect(span.output).toEqual({ qa: 'span_output_secret' });
    expect(span.error).toBe('qa_span_error_secret');
  });
});

describe('Batch 1 — feedback', () => {
  it('VIEWER list returns 200 with input/answer null', async () => {
    const res = await api('GET', '/v1/admin/ai-feedback?page=1&pageSize=100', 'VIEWER');
    expect(res.status).toBe(200);
    expect(res.data.list.length).toBe(9);
    for (const row of res.data.list) {
      expect(row.input ?? null).toBeNull();
      expect(row.answer ?? null).toBeNull();
    }
  });

  it('ADMIN sees raw input/answer for the explicit feedback', async () => {
    const res = await api('GET', '/v1/admin/ai-feedback?page=1&pageSize=100', 'ADMIN');
    expect(res.status).toBe(200);
    const row = res.data.list.find((item: any) => item.id === 'qa_fb_explicit_1');
    expect(row).toBeDefined();
    expect(row.input).toBe('qa_user_question_secret_1');
    expect(row.answer).toBe('qa_ai_answer_secret_1');
  });

  it('EDITOR is denied feedback list (403)', async () => {
    const res = await api('GET', '/v1/admin/ai-feedback', 'EDITOR');
    expect(res.status).toBe(403);
  });

  it('VIEWER can read aggregate summary (no raw text in it)', async () => {
    const res = await api('GET', '/v1/admin/ai-feedback/summary', 'VIEWER');
    expect(res.status).toBe(200);
    expect(res.data.total).toBe(9);
    expect(res.data.pending).toBe(7);
  });
});

describe('Batch 1 — customer service chat', () => {
  it('VIEWER conversation list has lastMsgContent null', async () => {
    const res = await api('GET', '/v1/admin/chat/conversations', 'VIEWER');
    expect(res.status).toBe(200);
    expect(res.data.list.length).toBeGreaterThan(0);
    for (const row of res.data.list) {
      expect(row.lastMsgContent).toBeNull();
    }
  });

  it('ADMIN/EDITOR see raw lastMsgContent', async () => {
    for (const role of ['ADMIN', 'EDITOR'] as const) {
      const res = await api('GET', '/v1/admin/chat/conversations', role);
      expect(res.status).toBe(200);
      const row = res.data.list.find((item: any) => item.id === 'qa_conv_1');
      expect(row.lastMsgContent).toBe('qa_last_message_secret_1');
    }
  });

  it('VIEWER message history has content/meta null', async () => {
    const res = await api(
      'GET',
      '/v1/admin/chat/conversations/qa_conv_1/messages',
      'VIEWER',
    );
    expect(res.status).toBe(200);
    expect(res.data.list.length).toBe(2);
    for (const message of res.data.list) {
      expect(message.content).toBeNull();
      expect(message.meta).toBeNull();
    }
  });

  it('ADMIN message history exposes raw content/meta', async () => {
    const res = await api(
      'GET',
      '/v1/admin/chat/conversations/qa_conv_1/messages',
      'ADMIN',
    );
    expect(res.status).toBe(200);
    const ai = res.data.list.find((item: any) => item.id === 'qa_msg_ai_1');
    expect(ai.content).toBe('qa_ai_answer_secret_1');
    expect(ai.meta).toEqual({ qa: 'ai_meta_secret' });
  });
});

describe('Batch 1 — support SLA queue', () => {
  it('VIEWER queue has lastMessage null', async () => {
    const res = await api('GET', '/v1/admin/chat/sla/queue', 'VIEWER');
    expect(res.status).toBe(200);
    expect(res.data.items.length).toBeGreaterThan(0);
    for (const item of res.data.items) {
      expect(item.lastMessage).toBeNull();
    }
  });

  it('ADMIN sees raw lastMessage', async () => {
    const res = await api('GET', '/v1/admin/chat/sla/queue', 'ADMIN');
    expect(res.status).toBe(200);
    const item = res.data.items.find(
      (row: any) => row.conversationId === 'qa_conv_sla_waiting',
    );
    expect(item).toBeDefined();
    expect(item.lastMessage).toBe('qa_sla_last_message_secret');
  });

  it('EDITOR is denied the SLA queue (403)', async () => {
    const res = await api('GET', '/v1/admin/chat/sla/queue', 'EDITOR');
    expect(res.status).toBe(403);
  });
});

describe('Batch 1 — AI eval judge role gate', () => {
  const judgeBody = {
    question: 'qa question',
    answer: 'qa answer',
    expectTask: { mustMention: ['qa'] },
  };

  it('VIEWER is denied (403)', async () => {
    const res = await api('POST', '/v1/admin/ai-eval/judge', 'VIEWER', judgeBody);
    expect(res.status).toBe(403);
  });

  it('EDITOR is denied (403)', async () => {
    const res = await api('POST', '/v1/admin/ai-eval/judge', 'EDITOR', judgeBody);
    expect(res.status).toBe(403);
  });

  it('ADMIN/SUPER_ADMIN pass the role gate (200 from judge stub)', async () => {
    for (const role of ['ADMIN', 'SUPER_ADMIN'] as const) {
      const res = await api('POST', '/v1/admin/ai-eval/judge', role, judgeBody);
      expect(res.status).toBe(200);
      expect(res.data.verdict).toBe('solved');
      expect(res.data.vendorIndependent).toBe(true);
    }
  });
});

describe('Batch 1 — AI context debug role gate', () => {
  it('VIEWER is denied (403)', async () => {
    const res = await api('GET', '/v1/admin/ai-context/qa_conv_1', 'VIEWER');
    expect(res.status).toBe(403);
  });

  it('EDITOR is denied (403)', async () => {
    const res = await api('GET', '/v1/admin/ai-context/qa_conv_1', 'EDITOR');
    expect(res.status).toBe(403);
  });

  it('ADMIN/SUPER_ADMIN pass the role gate (200)', async () => {
    for (const role of ['ADMIN', 'SUPER_ADMIN'] as const) {
      const res = await api('GET', '/v1/admin/ai-context/qa_conv_1', role);
      expect(res.status).toBe(200);
    }
  });
});

describe('Batch 1 — data reconciliation (API card numbers vs SQL)', () => {
  it('summary counts equal direct SQL counts', async () => {
    const summaryRes = await api(
      'GET',
      '/v1/admin/ai-feedback/summary',
      'ADMIN',
    );
    expect(summaryRes.status).toBe(200);

    const [serviceError, pending, addedToEval] = await Promise.all([
      prisma.aiAnswerFeedback.count({
        where: { failureKind: 'SERVICE_ERROR' },
      }),
      prisma.aiAnswerFeedback.count({ where: { reviewStatus: 'PENDING' } }),
      prisma.aiAnswerFeedback.count({ where: { resolution: 'ADDED_TO_EVAL' } }),
    ]);

    const byFailure = (value: string) =>
      summaryRes.data.byFailureKind.find(
        (row: any) => row.failureKind === value,
      )?.count ?? 0;
    const byResolution = (value: string) =>
      summaryRes.data.byResolution.find(
        (row: any) => row.resolution === value,
      )?.count ?? 0;

    // Values asserted against the seed are also checked against live SQL.
    expect(serviceError).toBe(3);
    expect(pending).toBe(7);
    expect(addedToEval).toBe(2);
    expect(byFailure('SERVICE_ERROR')).toBe(serviceError);
    expect(summaryRes.data.pending).toBe(pending);
    expect(byResolution('ADDED_TO_EVAL')).toBe(addedToEval);
  });

  it('filtered list totals equal the same SQL counts', async () => {
    const cases: Array<[string, () => Promise<number>]> = [
      [
        'failureKind=SERVICE_ERROR',
        () =>
          prisma.aiAnswerFeedback.count({
            where: { failureKind: 'SERVICE_ERROR' },
          }),
      ],
      [
        'reviewStatus=PENDING',
        () =>
          prisma.aiAnswerFeedback.count({
            where: { reviewStatus: 'PENDING' },
          }),
      ],
      [
        'resolution=ADDED_TO_EVAL',
        () =>
          prisma.aiAnswerFeedback.count({
            where: { resolution: 'ADDED_TO_EVAL' },
          }),
      ],
    ];

    for (const [query, countFn] of cases) {
      const expected = await countFn();
      const res = await api(
        'GET',
        `/v1/admin/ai-feedback?${query}&page=1&pageSize=100`,
        'ADMIN',
      );
      expect(res.status).toBe(200);
      expect(res.data.total).toBe(expected);
      expect(res.data.list.length).toBe(expected);
    }
  });
});
