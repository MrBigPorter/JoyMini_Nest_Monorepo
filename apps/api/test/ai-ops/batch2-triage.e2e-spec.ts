/**
 * Batch 2 — triage derivation, actionable/signal queues, today windows,
 * updateTriage atomicity and HUMAN score writes.
 *
 * Runs against the live QA API (4102) + QA Postgres, and uses the real
 * AiFeedbackService for implicit ingestion (there is no HTTP endpoint for it).
 *
 * Run:
 *   npx jest --config test/jest-e2e.json --runInBand --forceExit \
 *     test/ai-ops/batch2-triage.e2e-spec.ts
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
import { AiFeedbackService } from '@api/common/ai/ai-feedback.service';
import { PrismaService } from '@api/common/prisma/prisma.service';

const QA_ENV_FILE = path.resolve(__dirname, '../../../../qa/.env.qa');
function loadQaEnv(): void {
  if (!fs.existsSync(QA_ENV_FILE)) return;
  for (const line of fs.readFileSync(QA_ENV_FILE, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    process.env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
}
loadQaEnv();

const API_BASE = (process.env.QA_API_URL ?? 'http://127.0.0.1:4102/api').replace(
  /\/$/,
  '',
);
const ADMIN_SECRET =
  process.env.ADMIN_JWT_SECRET ?? 'qa_admin_jwt_secret_change_me_0123456789';
const ADMIN_TOKEN = jwt.sign(
  { sub: 'qa_admin_admin', role: 'ADMIN', type: 'admin', username: 'qa_admin' },
  ADMIN_SECRET,
  { expiresIn: '1h' },
);
const QA = 'qa_b2a_';

const prisma = new PrismaService();
const feedbackService = new AiFeedbackService(prisma);

// The 113 §9.1 definitions, expressed directly against the QA database.
const actionableWhere = {
  resolution: 'OPEN',
  OR: [
    { source: 'explicit', verdict: 'incorrect' },
    { failureKind: 'SERVICE_ERROR' },
    { ownerAdminId: { not: null } },
  ],
} as const;
const signalWhere = {
  source: 'implicit',
  resolution: { notIn: ['EXCLUDED', 'NO_ISSUE'] },
  failureKind: { not: 'SERVICE_ERROR' },
  ownerAdminId: null,
} as const;

const TODAY = new Date().toISOString().slice(0, 10);
const YESTERDAY = new Date(Date.now() - 86_400_000)
  .toISOString()
  .slice(0, 10);
const TODAY_START = new Date(`${TODAY}T00:00:00.000Z`);
const TODAY_END = new Date(`${TODAY}T23:59:59.999Z`);
const YESTERDAY_NOON = new Date(`${YESTERDAY}T12:00:00.000Z`);

interface ApiResult {
  status: number;
  body: any;
  data: any;
}

async function api(
  method: string,
  endpoint: string,
  body?: unknown,
): Promise<ApiResult> {
  const res = await fetch(`${API_BASE}${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${ADMIN_TOKEN}`,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const parsed = text ? JSON.parse(text) : null;
  return { status: res.status, body: parsed, data: parsed?.data };
}

async function waitForApi(): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${API_BASE}/v1/health`);
      if (res.ok) return;
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`QA API not reachable at ${API_BASE}`);
}

async function cleanup() {
  await prisma.aiScore.deleteMany({
    where: { conversationId: { startsWith: QA } },
  });
  await prisma.aiAnswerFeedback.deleteMany({
    where: {
      OR: [{ id: { startsWith: QA } }, { conversationId: { startsWith: QA } }],
    },
  });
  await prisma.chatMessage.deleteMany({ where: { id: { startsWith: QA } } });
  await prisma.conversation.deleteMany({ where: { id: { startsWith: QA } } });
}

async function createExplicit(
  key: string,
  verdict: 'correct' | 'incorrect',
  extra: Record<string, unknown> = {},
): Promise<string> {
  const res = await api('POST', '/v1/admin/ai-feedback', {
    conversationId: `${QA}${key}`,
    verdict,
    ...extra,
  });
  expect(res.status).toBe(201);
  expect(res.data?.id).toBeTruthy();
  return res.data.id as string;
}

async function recordImplicit(
  key: string,
  signal: 'transferred' | 'repeated_question' | 'abandoned',
  metadata?: Record<string, unknown>,
) {
  const conversationId = `${QA}${key}`;
  await feedbackService.recordImplicit({
    conversationId,
    signal,
    metadata,
  });
  const row = await prisma.aiAnswerFeedback.findFirst({
    where: { conversationId },
    orderBy: { createdAt: 'desc' },
  });
  expect(row).toBeTruthy();
  return row!;
}

async function humanScoreCount(feedbackId: string): Promise<number> {
  return prisma.aiScore.count({
    where: {
      source: 'HUMAN',
      metadata: { path: ['feedbackId'], equals: feedbackId } as never,
    },
  });
}

async function patchTriage(
  id: string,
  body: Record<string, unknown>,
): Promise<ApiResult> {
  return api('PATCH', `/v1/admin/ai-feedback/${id}`, body);
}

beforeAll(async () => {
  await waitForApi();
  await cleanup();
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe('Batch 2 — ingest derivation', () => {
  it('explicit correct → NO_ISSUE / REVIEWED, failureKind null', async () => {
    const id = await createExplicit('explicit_correct', 'correct');
    const row = await prisma.aiAnswerFeedback.findUnique({ where: { id } });
    expect(row).toMatchObject({
      source: 'explicit',
      verdict: 'correct',
      failureKind: null,
      resolution: 'NO_ISSUE',
      reviewStatus: 'REVIEWED',
      reviewedBy: null,
    });
  });

  it('explicit incorrect → MODEL_ERROR / OPEN / PENDING', async () => {
    const id = await createExplicit('explicit_incorrect', 'incorrect', {
      errorType: 'irrelevant',
    });
    const row = await prisma.aiAnswerFeedback.findUnique({ where: { id } });
    expect(row).toMatchObject({
      source: 'explicit',
      verdict: 'incorrect',
      errorType: 'irrelevant',
      failureKind: 'MODEL_ERROR',
      resolution: 'OPEN',
      reviewStatus: 'PENDING',
      reviewedBy: null,
    });
  });

  it('implicit ai_error → SERVICE_ERROR / OPEN', async () => {
    const row = await recordImplicit('imp_ai_error', 'transferred', {
      reason: 'ai_error',
    });
    expect(row).toMatchObject({
      source: 'implicit',
      signal: 'transferred',
      failureKind: 'SERVICE_ERROR',
      resolution: 'OPEN',
      reviewStatus: 'PENDING',
      reviewedBy: null,
    });
  });

  it('implicit explicit_request → EXPECTED_TRANSFER / EXCLUDED / IGNORED', async () => {
    const row = await recordImplicit('imp_explicit_req', 'transferred', {
      reason: 'explicit_request',
    });
    expect(row).toMatchObject({
      source: 'implicit',
      signal: 'transferred',
      failureKind: 'EXPECTED_TRANSFER',
      resolution: 'EXCLUDED',
      reviewStatus: 'IGNORED',
      reviewedBy: null,
    });
  });

  it('implicit abandoned → USER_ABANDONED / OPEN', async () => {
    const row = await recordImplicit('imp_abandoned', 'abandoned');
    expect(row).toMatchObject({
      failureKind: 'USER_ABANDONED',
      resolution: 'OPEN',
      reviewStatus: 'PENDING',
    });
  });

  it('implicit repeated_question → REPEATED_QUESTION / OPEN', async () => {
    const row = await recordImplicit(
      'imp_repeated',
      'repeated_question',
    );
    expect(row).toMatchObject({
      failureKind: 'REPEATED_QUESTION',
      resolution: 'OPEN',
      reviewStatus: 'PENDING',
    });
  });

  it('implicit transferred without reason → UNKNOWN / OPEN', async () => {
    const row = await recordImplicit('imp_transferred', 'transferred');
    expect(row).toMatchObject({
      failureKind: 'UNKNOWN',
      resolution: 'OPEN',
      reviewStatus: 'PENDING',
    });
  });
});

describe('Batch 2 — queue derivation and SQL reconciliation', () => {
  it('queue=TODO / SIGNAL totals equal the 113 §9.1 SQL counts', async () => {
    const todoSql = await prisma.aiAnswerFeedback.count({
      where: actionableWhere as never,
    });
    const signalSql = await prisma.aiAnswerFeedback.count({
      where: signalWhere as never,
    });

    const todo = await api(
      'GET',
      '/v1/admin/ai-feedback?queue=TODO&pageSize=100',
    );
    const signal = await api(
      'GET',
      '/v1/admin/ai-feedback?queue=SIGNAL&pageSize=100',
    );

    expect(todo.status).toBe(200);
    expect(signal.status).toBe(200);
    expect(todo.data.total).toBe(todoSql);
    expect(signal.data.total).toBe(signalSql);
    expect(todo.data.list.length).toBe(todoSql);
    expect(signal.data.list.length).toBe(signalSql);
  });

  it('queue=SIGNAL combines with signal (repeated_question)', async () => {
    const sql = await prisma.aiAnswerFeedback.count({
      where: {
        AND: [
          signalWhere as never,
          { signal: 'repeated_question' },
        ],
      },
    });
    const res = await api(
      'GET',
      '/v1/admin/ai-feedback?queue=SIGNAL&signal=repeated_question&pageSize=100',
    );
    expect(res.status).toBe(200);
    expect(res.data.total).toBe(sql);
    for (const row of res.data.list) {
      expect(row.source).toBe('implicit');
      expect(row.signal).toBe('repeated_question');
    }
  });

  it('claiming a signal moves it from SIGNAL to TODO', async () => {
    const row = await recordImplicit('claim_signal', 'abandoned');
    const beforeSignal = await api(
      'GET',
      `/v1/admin/ai-feedback?queue=SIGNAL&pageSize=100`,
    );
    const beforeTodo = await api(
      'GET',
      `/v1/admin/ai-feedback?queue=TODO&pageSize=100`,
    );
    expect(beforeSignal.data.list.some((x: any) => x.id === row.id)).toBe(true);
    expect(beforeTodo.data.list.some((x: any) => x.id === row.id)).toBe(false);

    const patched = await patchTriage(row.id, {
      ownerAdminId: 'qa_admin_admin',
    });
    expect(patched.status).toBe(200);

    const afterSignal = await api(
      'GET',
      `/v1/admin/ai-feedback?queue=SIGNAL&pageSize=100`,
    );
    const afterTodo = await api(
      'GET',
      `/v1/admin/ai-feedback?queue=TODO&pageSize=100`,
    );
    expect(afterSignal.data.list.some((x: any) => x.id === row.id)).toBe(false);
    expect(afterTodo.data.list.some((x: any) => x.id === row.id)).toBe(true);
  });
});

describe('Batch 2 — summary today/yesterday boundaries', () => {
  it('today summary equals direct SQL within the UTC day', async () => {
    const res = await api(
      'GET',
      `/v1/admin/ai-feedback/summary?from=${TODAY}&to=${TODAY}`,
    );
    expect(res.status).toBe(200);

    const window = { createdAt: { gte: TODAY_START, lte: TODAY_END } };
    const [total, pending, signals] = await Promise.all([
      prisma.aiAnswerFeedback.count({ where: window }),
      prisma.aiAnswerFeedback.count({
        where: { AND: [window, actionableWhere as never] } as never,
      }),
      prisma.aiAnswerFeedback.count({
        where: { AND: [window, signalWhere as never] } as never,
      }),
    ]);

    expect(res.data.total).toBe(total);
    expect(res.data.pending).toBe(pending);
    expect(res.data.signals).toBe(signals);
  });

  it('date-only from/to is inclusive at 00:00:00.000 and 23:59:59.999', async () => {
    const startId = await createExplicit('bound_start', 'incorrect');
    const endId = await createExplicit('bound_end', 'incorrect');
    const yesterdayId = await createExplicit('bound_yesterday', 'incorrect');

    await prisma.aiAnswerFeedback.update({
      where: { id: startId },
      data: { createdAt: TODAY_START },
    });
    await prisma.aiAnswerFeedback.update({
      where: { id: endId },
      data: { createdAt: TODAY_END },
    });
    await prisma.aiAnswerFeedback.update({
      where: { id: yesterdayId },
      data: { createdAt: YESTERDAY_NOON },
    });

    const todayRes = await api(
      'GET',
      `/v1/admin/ai-feedback?from=${TODAY}&to=${TODAY}&pageSize=100`,
    );
    const todayIds = todayRes.data.list.map((x: any) => x.id);
    expect(todayIds).toContain(startId);
    expect(todayIds).toContain(endId);
    expect(todayIds).not.toContain(yesterdayId);

    const yesterdayRes = await api(
      'GET',
      `/v1/admin/ai-feedback?from=${YESTERDAY}&to=${YESTERDAY}&pageSize=100`,
    );
    const yesterdayIds = yesterdayRes.data.list.map((x: any) => x.id);
    expect(yesterdayIds).toContain(yesterdayId);
    expect(yesterdayIds).not.toContain(startId);
  });
});

describe('Batch 2 — updateTriage atomic derivation', () => {
  it('reviewStatus only also writes resolution', async () => {
    const id = await createExplicit('triage_review_only', 'incorrect');
    const res = await patchTriage(id, { reviewStatus: 'REVIEWED' });
    expect(res.status).toBe(200);
    const row = await prisma.aiAnswerFeedback.findUnique({ where: { id } });
    expect(row).toMatchObject({
      reviewStatus: 'REVIEWED',
      resolution: 'CONFIRMED',
      reviewedBy: 'qa_admin_admin',
    });
  });

  it('resolution only also writes reviewStatus', async () => {
    const id = await createExplicit('triage_resolution_only', 'incorrect');
    const res = await patchTriage(id, { resolution: 'EXCLUDED' });
    expect(res.status).toBe(200);
    const row = await prisma.aiAnswerFeedback.findUnique({ where: { id } });
    expect(row).toMatchObject({
      resolution: 'EXCLUDED',
      reviewStatus: 'IGNORED',
      reviewedBy: 'qa_admin_admin',
    });
    // Resolution is not a judgment change → no HUMAN score.
    expect(await humanScoreCount(id)).toBe(0);
  });

  it('failureKind-only change writes one HUMAN score', async () => {
    const id = await createExplicit('triage_failure_kind', 'incorrect');
    expect(await humanScoreCount(id)).toBe(0);
    const res = await patchTriage(id, {
      failureKind: 'UNEXPECTED_TRANSFER',
    });
    expect(res.status).toBe(200);
    const row = await prisma.aiAnswerFeedback.findUnique({ where: { id } });
    expect(row).toMatchObject({
      failureKind: 'UNEXPECTED_TRANSFER',
      resolution: 'OPEN',
      reviewStatus: 'PENDING',
    });
    expect(await humanScoreCount(id)).toBe(1);
    const scores = await prisma.aiScore.findMany({
      where: {
        source: 'HUMAN',
        metadata: { path: ['feedbackId'], equals: id } as never,
      },
    });
    expect(scores[0].stringValue).toBe('UNEXPECTED_TRANSFER');
  });

  it('verdict=correct → NO_ISSUE / REVIEWED and clears failureKind', async () => {
    const id = await createExplicit('triage_correct', 'incorrect');
    const res = await patchTriage(id, { verdict: 'correct' });
    expect(res.status).toBe(200);
    const row = await prisma.aiAnswerFeedback.findUnique({ where: { id } });
    expect(row).toMatchObject({
      verdict: 'correct',
      failureKind: null,
      resolution: 'NO_ISSUE',
      reviewStatus: 'REVIEWED',
    });
  });

  it('note-only and reviewStatus-only do not write a HUMAN score', async () => {
    const id = await createExplicit('triage_score_note', 'incorrect');
    expect(await humanScoreCount(id)).toBe(0);

    const noteRes = await patchTriage(id, { note: 'qa note only' });
    expect(noteRes.status).toBe(200);
    expect(await humanScoreCount(id)).toBe(0);

    const statusRes = await patchTriage(id, { reviewStatus: 'REVIEWED' });
    expect(statusRes.status).toBe(200);
    expect(await humanScoreCount(id)).toBe(0);
  });

  it('judgment change writes exactly one HUMAN score; later note does not add', async () => {
    const id = await createExplicit('triage_score_change', 'incorrect');
    expect(await humanScoreCount(id)).toBe(0);

    const correctRes = await patchTriage(id, { verdict: 'correct' });
    expect(correctRes.status).toBe(200);
    expect(await humanScoreCount(id)).toBe(1);

    const scores = await prisma.aiScore.findMany({
      where: {
        source: 'HUMAN',
        metadata: { path: ['feedbackId'], equals: id } as never,
      },
    });
    expect(scores[0]).toMatchObject({
      source: 'HUMAN',
      value: 1,
      stringValue: 'NO_ISSUE',
      adminId: 'qa_admin_admin',
    });

    const noteRes = await patchTriage(id, { note: 'post-verdict note' });
    expect(noteRes.status).toBe(200);
    expect(await humanScoreCount(id)).toBe(1);
  });
});
