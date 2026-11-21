/**
 * Batch 5 — 119 Phase 1 problem analysis (real QA API/DB).
 *
 * Seed prerequisite:
 *   DATABASE_URL=... npx tsx qa/seed/batch5.ts
 *
 * Expected seed (UTC 2026-11-18):
 *   traces=4, conversations=2, events=8
 *   problem_rate 8/4, service_error_rate 2/4, zero_hit 1/4,
 *   explicit_negative 1/4, repeat 1/2; INTENT order/rag = 1/2.
 *
 * D-B5-01: the advisory lock is not released across Prisma pooled connections,
 * so a back-to-back same-window re-run returns 409. The suite keeps that test
 * failing (evidence) and uses a QA-only lock cleanup so the remaining checks
 * can run.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import * as jwt from 'jsonwebtoken';
import { PrismaService } from '@api/common/prisma/prisma.service';

const QA_ENV_FILE = path.resolve(__dirname, '../../../../qa/.env.qa');
function readQaEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  if (!fs.existsSync(QA_ENV_FILE)) return env;
  for (const line of fs.readFileSync(QA_ENV_FILE, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return env;
}

const ENV = readQaEnv();
for (const [key, value] of Object.entries(ENV)) process.env[key] = value;

const API_BASE = (ENV.QA_API_URL ?? 'http://127.0.0.1:4102/api').replace(
  /\/$/,
  '',
);
const SECRET =
  ENV.ADMIN_JWT_SECRET ?? 'qa_admin_jwt_secret_change_me_0123456789';
const DATE = ENV.QA_BATCH5_DATE ?? '2026-11-18';
const FAIL_DATE = '2026-11-17';
const START = new Date(`${DATE}T00:00:00.000Z`);
const FAIL_START = new Date(`${FAIL_DATE}T00:00:00.000Z`);

const ROLES = {
  VIEWER: 'qa_admin_viewer',
  EDITOR: 'qa_admin_editor',
  ADMIN: 'qa_admin_admin',
  SUPER_ADMIN: 'qa_admin_super',
} as const;
type QaRole = keyof typeof ROLES;

function tokenFor(role: QaRole): string {
  return jwt.sign(
    { sub: ROLES[role], role, type: 'admin', username: `qa_${role.toLowerCase()}` },
    SECRET,
    { expiresIn: '1h' },
  );
}

const prisma = new PrismaService();

interface ApiResult {
  status: number;
  body: any;
  data: any;
}

async function api(
  method: string,
  endpoint: string,
  role: QaRole = 'ADMIN',
  body?: unknown,
): Promise<ApiResult> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    try {
      const res = await fetch(`${API_BASE}${endpoint}`, {
        method,
        headers: {
          Authorization: `Bearer ${tokenFor(role)}`,
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await res.text();
      const parsed = text ? JSON.parse(text) : null;
      return { status: res.status, body: parsed, data: parsed?.data };
    } catch (err) {
      // The API restart used to clear the leaked advisory lock briefly resets
      // connections; retry connection-level failures, not HTTP responses.
      lastError = err;
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw lastError;
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

/**
 * D-B5-01 workaround: a real API restart closes the Prisma pool sessions that
 * still hold the leaked advisory lock. The product bug remains (the back-to-back
 * re-run test below fails); this only lets the remaining checks run.
 */
const REPO_ROOT = path.resolve(__dirname, '../../../..');
function restartApi(): void {
  execSync('bash qa/scripts/restart-api.sh', {
    cwd: REPO_ROOT,
    stdio: 'pipe',
    timeout: 180_000,
  });
}

function redisCli(args: string): string {
  return execSync(
    `docker exec lucky-redis-qa redis-cli -n 15 ${args}`,
    { encoding: 'utf8', timeout: 10_000 },
  ).trim();
}

async function dropFailTrigger(): Promise<void> {
  await prisma
    .$executeRawUnsafe(
      'DROP TRIGGER IF EXISTS qa_b5_fail_trg ON ai_problem_events',
    )
    .catch(() => undefined);
  await prisma
    .$executeRawUnsafe('DROP FUNCTION IF EXISTS qa_b5_fail_fn()')
    .catch(() => undefined);
}

async function cleanWindow(start: Date): Promise<void> {
  await prisma.aiProblemEvent.deleteMany({ where: { windowStart: start } });
  await prisma.aiMetricWindow.deleteMany({ where: { windowStart: start } });
  await prisma.aiAnalysisRun.deleteMany({ where: { windowStart: start } });
}

async function runAnalysis(date: string): Promise<ApiResult> {
  return api('POST', '/v1/admin/ai-analysis/runs', 'ADMIN', { date });
}

async function getMetrics(date: string): Promise<any[]> {
  const res = await api(
    'GET',
    `/v1/admin/ai-analysis/metrics?date=${date}`,
    'ADMIN',
  );
  expect(res.status).toBe(200);
  return res.data.metrics;
}

function metric(
  rows: any[],
  name: string,
  dimension: string,
  dimensionValue?: string,
) {
  return rows.find(
    (row) =>
      row.metric === name &&
      row.dimension === dimension &&
      (dimensionValue === undefined || row.dimensionValue === dimensionValue),
  );
}

beforeAll(async () => {
  restartApi();
  await waitForApi();
  await dropFailTrigger();
  await cleanWindow(START);
  await cleanWindow(FAIL_START);
  await prisma.aiAnswerFeedback
    .deleteMany({ where: { id: { startsWith: 'qa_b5_fail_' } } })
    .catch(() => undefined);

  // The seed must be present.
  const [traces, conversations, feedback, evalResults, security] =
    await Promise.all([
      prisma.aiTrace.count({
        where: {
          id: { startsWith: 'qa_b5_' },
          createdAt: { gte: START, lt: new Date(START.getTime() + 86_400_000) },
        },
      }),
      prisma.conversation.count({
        where: {
          id: { startsWith: 'qa_b5_' },
          createdAt: { gte: START, lt: new Date(START.getTime() + 86_400_000) },
        },
      }),
      prisma.aiAnswerFeedback.count({ where: { id: { startsWith: 'qa_b5_' } } }),
      prisma.aiEvalResult.count({ where: { id: { startsWith: 'qa_b5_' } } }),
      prisma.aiSecurityEvent.count({ where: { id: { startsWith: 'qa_b5_' } } }),
    ]);
  if (!traces || !conversations || !feedback || !evalResults || !security) {
    throw new Error(
      'Batch 5 seed missing; run: npx tsx qa/seed/batch5.ts',
    );
  }
}, 180_000);

afterAll(async () => {
  await dropFailTrigger();
  restartApi();
  await prisma.$disconnect();
}, 180_000);

describe('Batch 5 — run + events', () => {
  it('builds 8 events for the seeded UTC day, without raw text', async () => {
    const res = await runAnalysis(DATE);
    expect(res.status).toBe(201);
    expect(res.data.status).toBe('COMPLETED');
    expect(res.data.processed).toBe(8);
    expect(res.data.createdEvents).toBe(8);

    const events = await api(
      'GET',
      `/v1/admin/ai-analysis/events?date=${DATE}&pageSize=100`,
      'ADMIN',
    );
    expect(events.status).toBe(200);
    expect(events.data.total).toBe(8);
    const counts: Record<string, number> = {};
    for (const row of events.data.list) {
      counts[row.type] = (counts[row.type] ?? 0) + 1;
    }
    expect(counts).toEqual({
      SERVICE_ERROR: 2,
      EXPLICIT_NEGATIVE: 1,
      REPEATED_QUESTION: 1,
      USER_ABANDONED: 1,
      ZERO_HIT: 1,
      EVAL_UNSOLVED: 1,
      SECURITY_HIT: 1,
    });

    // 119 Phase 2 intentionally stores a redacted, 200-char-capped
    // `metadata.questionPreview` for clustering. The original input may appear
    // there, but notes/outputs/reasons must never leak, and every preview is
    // capped. Everything outside metadata stays free of the seed text.
    const rawFields = [
      'qa_b5_secret_feedback_note',
      'qa_b5_secret_trace_output',
      'qa_b5_secret_eval_reason',
      'qa_b5_secret_last_message',
    ];
    const apiText = JSON.stringify(events.data.list);
    for (const forbidden of rawFields) {
      expect(apiText).not.toContain(forbidden);
    }
    const previews = events.data.list
      .map((row: any) => row.metadata?.questionPreview)
      .filter((value: unknown): value is string => typeof value === 'string');
    expect(previews.length).toBeGreaterThan(0);
    for (const preview of previews) {
      expect(preview.length).toBeLessThanOrEqual(200);
    }
    for (const row of events.data.list) {
      const withoutMetadata = { ...row, metadata: undefined };
      expect(JSON.stringify(withoutMetadata)).not.toContain('qa_b5_secret');
    }

    const dbRows = await prisma.aiProblemEvent.findMany({
      where: { windowStart: START },
    });
    expect(dbRows.length).toBe(8);
    for (const row of dbRows) {
      const withoutMetadata = { ...row, metadata: undefined };
      expect(JSON.stringify(withoutMetadata)).not.toContain('qa_b5_secret');
      const preview = (row.metadata as any)?.questionPreview;
      if (typeof preview === 'string') expect(preview.length).toBeLessThanOrEqual(200);
    }
    expect(JSON.stringify(dbRows)).not.toContain('qa_b5_secret_feedback_note');
    expect(JSON.stringify(dbRows)).not.toContain('qa_b5_secret_trace_output');

    // Spot-check source IDs.
    const traceError = events.data.list.find(
      (row: any) => row.sourceId === 'qa_b5_trace_error',
    );
    expect(traceError).toMatchObject({
      type: 'SERVICE_ERROR',
      source: 'trace',
      intent: 'order',
    });
    const zero = events.data.list.find(
      (row: any) => row.sourceId === 'qa_b5_trace_zero',
    );
    expect(zero?.type).toBe('ZERO_HIT');
    const evalEvent = events.data.list.find(
      (row: any) => row.sourceId === 'qa_b5_eval_result',
    );
    expect(evalEvent?.type).toBe('EVAL_UNSOLVED');
    const security = events.data.list.find(
      (row: any) => row.sourceId === 'qa_b5_security',
    );
    expect(security?.type).toBe('SECURITY_HIT');
  });

  it('supports type filter and pagination', async () => {
    const filtered = await api(
      'GET',
      `/v1/admin/ai-analysis/events?date=${DATE}&type=SERVICE_ERROR&pageSize=100`,
      'ADMIN',
    );
    expect(filtered.status).toBe(200);
    expect(filtered.data.total).toBe(2);
    for (const row of filtered.data.list) {
      expect(row.type).toBe('SERVICE_ERROR');
    }

    const paged = await api(
      'GET',
      `/v1/admin/ai-analysis/events?date=${DATE}&pageSize=2`,
      'ADMIN',
    );
    expect(paged.data.total).toBe(8);
    expect(paged.data.list.length).toBe(2);
  });
});

describe('Batch 5 — metrics', () => {
  it('computes ALL and INTENT numerators/denominators', async () => {
    const rows = await getMetrics(DATE);
    expect(rows.length).toBe(7);

    const problem = metric(rows, 'problem_rate', 'ALL', 'ALL');
    expect(problem).toMatchObject({ numerator: 8, denominator: 4 });
    expect(problem.value).toBeCloseTo(2, 4);

    const service = metric(rows, 'service_error_rate', 'ALL', 'ALL');
    expect(service).toMatchObject({ numerator: 2, denominator: 4 });
    expect(service.value).toBeCloseTo(0.5, 4);

    const zero = metric(rows, 'zero_hit_rate', 'ALL', 'ALL');
    expect(zero).toMatchObject({ numerator: 1, denominator: 3 });
    expect(zero.value).toBeCloseTo(1 / 3, 4);

    const explicit = metric(rows, 'explicit_negative_rate', 'ALL', 'ALL');
    expect(explicit).toMatchObject({ numerator: 1, denominator: 4 });
    expect(explicit.value).toBeCloseTo(0.25, 4);

    const repeat = metric(rows, 'repeat_rate', 'ALL', 'ALL');
    expect(repeat).toMatchObject({ numerator: 1, denominator: 2 });
    expect(repeat.value).toBeCloseTo(0.5, 4);

    const order = metric(rows, 'problem_rate', 'INTENT', 'order');
    expect(order).toMatchObject({ numerator: 1, denominator: 2 });
    expect(order.value).toBeCloseTo(0.5, 4);
    const rag = metric(rows, 'problem_rate', 'INTENT', 'rag');
    expect(rag).toMatchObject({ numerator: 1, denominator: 2 });
    expect(rag.value).toBeCloseTo(0.5, 4);

    for (const row of rows) {
      expect(row.sampleSize).toBe(row.denominator);
    }

    // SQL cross-check of the denominators used by the implementation.
    const traces = await prisma.aiTrace.count({
      where: {
        createdAt: { gte: START, lt: new Date(START.getTime() + 86_400_000) },
      },
    });
    const conversations = await prisma.conversation.count({
      where: {
        createdAt: { gte: START, lt: new Date(START.getTime() + 86_400_000) },
      },
    });
    expect(problem.denominator).toBe(traces);
    expect(repeat.denominator).toBe(conversations);
    // D-B5-02 fix: zero-hit denominator = traces with a RAG span.
    const ragTraces = await prisma.aiTrace.count({
      where: {
        createdAt: { gte: START, lt: new Date(START.getTime() + 86_400_000) },
        spans: { some: { type: 'rag' } },
      },
    });
    expect(ragTraces).toBe(3);
    expect(zero.denominator).toBe(ragTraces);
  });
});

describe('Batch 5 — idempotency', () => {
  it('same-window re-run without restart is idempotent (201)', async () => {
    // D-B5-01 fix: the Redis lock is released after the first run, so the
    // second consecutive POST acquires it and completes.
    const again = await runAnalysis(DATE);
    expect(again.status).toBe(201);
    expect(again.data.status).toBe('COMPLETED');
    expect(again.data.createdEvents).toBe(8);

    const events = await prisma.aiProblemEvent.count({
      where: { windowStart: START },
    });
    const metrics = await prisma.aiMetricWindow.count({
      where: { windowStart: START },
    });
    expect(events).toBe(8);
    expect(metrics).toBe(7);
  });

  it('after an API restart, re-run still yields 8 events / 7 metrics', async () => {
    restartApi();
    const again = await runAnalysis(DATE);
    expect(again.status).toBe(201);
    expect(again.data.status).toBe('COMPLETED');
    expect(again.data.createdEvents).toBe(8);
    expect(
      await prisma.aiProblemEvent.count({ where: { windowStart: START } }),
    ).toBe(8);
    expect(
      await prisma.aiMetricWindow.count({ where: { windowStart: START } }),
    ).toBe(7);
    expect(
      await prisma.aiAnalysisRun.count({ where: { windowStart: START } }),
    ).toBe(1);
  }, 180_000);
});

describe('Batch 5 — concurrency and lock TTL', () => {
  const CONC_DATE = '2026-11-16';
  const CONC_START = new Date(`${CONC_DATE}T00:00:00.000Z`);
  const LOCK_KEY = `ai:analysis:${CONC_START.toISOString()}`;

  it('holds the Redis lock (30 min TTL) and rejects a concurrent run', async () => {
    await prisma.aiAnalysisRun.deleteMany({ where: { windowStart: CONC_START } });
    await prisma.aiMetricWindow.deleteMany({
      where: { windowStart: CONC_START },
    });
    await prisma.aiProblemEvent.deleteMany({
      where: { windowStart: CONC_START },
    });
    await prisma.aiAnswerFeedback.deleteMany({
      where: { id: { startsWith: 'qa_b5_conc_' } },
    });
    // Clear a lock left by an interrupted previous run; the lock TTL is 30m.
    redisCli(`DEL "${LOCK_KEY}"`);

    // 500 events make the first run long enough to observe the lock.
    await prisma.aiAnswerFeedback.createMany({
      data: Array.from({ length: 500 }, (_, i) => ({
        id: `qa_b5_conc_${i}`,
        conversationId: 'qa_b5_conc_conv',
        source: 'explicit',
        verdict: 'incorrect',
        failureKind: 'MODEL_ERROR',
        resolution: 'OPEN',
        reviewStatus: 'PENDING',
        createdAt: new Date(`${CONC_DATE}T10:00:00.000Z`),
      })) as never,
    });

    const firstPromise = runAnalysis(CONC_DATE);
    let ttl = -2;
    for (let i = 0; i < 80; i += 1) {
      const out = redisCli(`PTTL "${LOCK_KEY}"`);
      if (out !== '-2') {
        ttl = Number(out);
        break;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeGreaterThan(29 * 60 * 1000);
    // Redis PTTL can be a few ms above the configured PX due to clock rounding.
    expect(ttl).toBeLessThanOrEqual(30 * 60 * 1000 + 60_000);

    const second = await runAnalysis(CONC_DATE);
    const first = await firstPromise;
    expect(first.status).toBe(201);
    expect(second.status).toBe(409);
    expect(String(second.body?.message ?? '')).toContain(
      'Another analysis run is in progress',
    );
    expect(
      await prisma.aiProblemEvent.count({ where: { windowStart: CONC_START } }),
    ).toBe(500);

    // Lock released after the run.
    expect(redisCli(`PTTL "${LOCK_KEY}"`)).toBe('-2');

    await prisma.aiProblemEvent.deleteMany({
      where: { windowStart: CONC_START },
    });
    await prisma.aiMetricWindow.deleteMany({
      where: { windowStart: CONC_START },
    });
    await prisma.aiAnalysisRun.deleteMany({
      where: { windowStart: CONC_START },
    });
    await prisma.aiAnswerFeedback.deleteMany({
      where: { id: { startsWith: 'qa_b5_conc_' } },
    });
  }, 180_000);
});

describe('Batch 5 — validation and roles', () => {
  it('rejects an invalid date with 400', async () => {
    const notDate = await runAnalysis('not-a-date');
    expect(notDate.status).toBe(400);

    const impossible = await runAnalysis('2026-13-99');
    expect(impossible.status).toBe(400);
  });

  it('VIEWER cannot run or read; EDITOR cannot read or run', async () => {
    const viewerPost = await api(
      'POST',
      '/v1/admin/ai-analysis/runs',
      'VIEWER',
      { date: DATE },
    );
    expect(viewerPost.status).toBe(403);
    const viewerGet = await api(
      'GET',
      `/v1/admin/ai-analysis/metrics?date=${DATE}`,
      'VIEWER',
    );
    expect(viewerGet.status).toBe(403);

    const editorPost = await api(
      'POST',
      '/v1/admin/ai-analysis/runs',
      'EDITOR',
      { date: DATE },
    );
    expect(editorPost.status).toBe(403);
    for (const endpoint of [
      '/v1/admin/ai-analysis/runs',
      `/v1/admin/ai-analysis/metrics?date=${DATE}`,
      `/v1/admin/ai-analysis/events?date=${DATE}`,
    ]) {
      const editorGet = await api('GET', endpoint, 'EDITOR');
      // 119 Phase 2–5 polish (4cc2954a): analysis reads are ADMIN/SUPER only.
      expect(editorGet.status).toBe(403);
    }
    const adminRuns = await api('GET', '/v1/admin/ai-analysis/runs', 'ADMIN');
    expect(adminRuns.status).toBe(200);
    expect(Array.isArray(adminRuns.data)).toBe(true);
  });
});

describe('Batch 5 — failure visibility', () => {
  it('marks the run FAILED and stores error when persistence fails', async () => {
    await dropFailTrigger();
    restartApi();
    await cleanWindow(FAIL_START);
    await prisma.aiAnswerFeedback.deleteMany({
      where: { id: { startsWith: 'qa_b5_fail_' } },
    });
    await prisma.aiAnswerFeedback.create({
      data: {
        id: 'qa_b5_fail_feedback',
        conversationId: 'qa_b5_fail_conv',
        source: 'explicit',
        verdict: 'incorrect',
        failureKind: 'MODEL_ERROR',
        resolution: 'OPEN',
        reviewStatus: 'PENDING',
        createdAt: new Date(`${FAIL_DATE}T10:00:00.000Z`),
      },
    });

    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION qa_b5_fail_fn() RETURNS trigger AS $$
      BEGIN
        IF NEW.window_start >= TIMESTAMP '${FAIL_DATE} 00:00:00'
           AND NEW.window_start < TIMESTAMP '${DATE} 00:00:00' THEN
          RAISE EXCEPTION 'qa simulated analysis failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);
    await prisma.$executeRawUnsafe(
      'CREATE TRIGGER qa_b5_fail_trg BEFORE INSERT ON ai_problem_events ' +
        'FOR EACH ROW EXECUTE FUNCTION qa_b5_fail_fn()',
    );

    const res = await runAnalysis(FAIL_DATE);
    expect([500, 503]).toContain(res.status);

    const runs = await api(
      'GET',
      '/v1/admin/ai-analysis/runs?limit=100',
      'ADMIN',
    );
    const failed = runs.data.find(
      (row: any) =>
        new Date(row.windowStart).toISOString().slice(0, 10) === FAIL_DATE,
    );
    expect(failed).toBeTruthy();
    expect(failed.status).toBe('FAILED');
    expect(String(failed.error ?? '')).toContain(
      'qa simulated analysis failure',
    );

    await dropFailTrigger();
    await prisma.aiAnswerFeedback
      .deleteMany({ where: { id: { startsWith: 'qa_b5_fail_' } } })
      .catch(() => undefined);
  }, 180_000);
});
