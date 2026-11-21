/**
 * Eval queue + cancellation (frozen 3d4d3387 / eval queue 8052f29).
 *
 * Real QA API + Postgres + Redis/BullMQ + judge stub (4199). Covers:
 *   1. startRun enqueues and the worker drives the run to COMPLETED
 *   2. cancel a mid-judge run: CANCELLED, summary.cancelled=true, no more
 *      results, never overwritten by COMPLETED/FAILED, idempotent
 *   3. duplicate enqueue with the same jobId keeps one job
 *   4. a waiting job survives an API process restart and is consumed
 *   5. AI_EVAL_ENABLED=false blocks startRun (403) but cancel still works
 *
 * The judge stub delays questions containing `qa_eval_slow` by 4s; the QA
 * script `qa/scripts/restart-api-env.sh` restarts the API with env overrides.
 */
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as jwt from 'jsonwebtoken';
import { Queue } from 'bullmq';
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

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const API_BASE = (ENV.QA_API_URL ?? 'http://127.0.0.1:4102/api').replace(
  /\/$/,
  '',
);
const ADMIN_TOKEN = jwt.sign(
  { sub: 'qa_admin_admin', role: 'ADMIN', type: 'admin', username: 'qa_admin' },
  ENV.ADMIN_JWT_SECRET ?? 'qa_admin_jwt_secret_change_me_0123456789',
  { expiresIn: '2h' },
);

const PREFIX = 'qa_eq_';
const QUEUE_NAME = 'ai-eval';
const JOB_NAME = 'run-eval';
const SLOW_MARKER = 'qa_eval_slow';

const prisma = new PrismaService();
const queue = new Queue(QUEUE_NAME, {
  connection: { url: ENV.REDIS_URL ?? 'redis://127.0.0.1:6382/15' },
});

const runIds = new Set<string>();

jest.setTimeout(240_000);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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

async function waitFor<T>(
  fn: () => Promise<T | null | undefined>,
  label: string,
  timeoutMs = 30_000,
  intervalMs = 100,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await fn();
    if (value !== null && value !== undefined) return value;
    await sleep(intervalMs);
  }
  throw new Error(`timeout waiting for ${label}`);
}

async function restartApi(...overrides: string[]): Promise<void> {
  execFileSync(
    'bash',
    [path.join(REPO_ROOT, 'qa/scripts/restart-api-env.sh'), ...overrides],
    { cwd: REPO_ROOT, stdio: 'inherit' },
  );
  // The restarted process invalidates undici's pooled keep-alive sockets; a
  // warm-up fetch (with retries) avoids a spurious ECONNRESET on the first
  // real request after a restart.
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      const res = await fetch(`${API_BASE}/v1/health`);
      if (res.ok) return;
    } catch {
      // stale socket from the previous process; retry on a fresh connection
    }
    await sleep(250);
  }
  throw new Error('API fetch warm-up failed after restart');
}

async function createDataset(
  name: string,
  cases: Array<{ question: string; answer: string; expected?: string }>,
): Promise<string> {
  const created = await api('POST', '/v1/admin/ai-eval/datasets', {
    name: `${PREFIX}${name}_${Date.now()}`,
    description: 'qa eval queue',
  });
  expect([200, 201]).toContain(created.status);
  const datasetId = created.data.id as string;

  const added = await api('POST', `/v1/admin/ai-eval/datasets/${datasetId}/cases`, {
    cases: cases.map((item, index) => ({
      question: item.question,
      answer: item.answer,
      expected: item.expected ?? `qa_eq_expected_${index + 1}`,
    })),
  });
  expect([200, 201]).toContain(added.status);
  return datasetId;
}

async function startRun(datasetId: string): Promise<string> {
  const started = await api('POST', `/v1/admin/ai-eval/datasets/${datasetId}/runs`, {
    mode: 'STORED',
  });
  expect([200, 201]).toContain(started.status);
  const runId = started.data.id as string;
  runIds.add(runId);
  return runId;
}

async function getRun(runId: string): Promise<any> {
  const result = await api('GET', `/v1/admin/ai-eval/runs/${runId}`);
  expect(result.status).toBe(200);
  return result.data;
}

async function resultCount(runId: string): Promise<number> {
  return prisma.aiEvalResult.count({ where: { runId } });
}

async function cleanup(): Promise<void> {
  try {
    queue.resume().catch(() => undefined);
    for (const runId of runIds) {
      try {
        const job = await queue.getJob(runId);
        await job?.remove();
      } catch {
        // active/completed jobs may already be gone; housekeeping only.
      }
    }
    // AiScore rows reference the run only in metadata (no FK).
    await prisma.$executeRawUnsafe(
      `DELETE FROM ai_scores
        WHERE metadata->>'evalRunId' IN (
          SELECT r.id FROM ai_eval_runs r
          JOIN ai_eval_datasets d ON d.id = r.dataset_id
          WHERE d.name LIKE '${PREFIX}%'
        )`,
    );
    await prisma.aiEvalDataset.deleteMany({
      where: { name: { startsWith: PREFIX } },
    });
  } finally {
    runIds.clear();
  }
}

beforeAll(async () => {
  await cleanup();
});

afterAll(async () => {
  try {
    await restartApi();
  } catch (err) {
    // Keep the original failure visible; the API is restarted separately.
    console.error('final API restart failed:', err);
  }
  await cleanup();
  await queue.close();
  await prisma.$disconnect();
});

describe('Eval queue — enqueue + worker', () => {
  it('startRun is executed by the worker to COMPLETED', async () => {
    const datasetId = await createDataset('basic', [
      { question: 'qa_eq_basic_1', answer: 'answer one' },
      { question: 'qa_eq_basic_2', answer: 'answer two' },
    ]);
    const runId = await startRun(datasetId);

    // Queue job exists with jobId = run.id.
    await waitFor(
      () => queue.getJob(runId),
      'queue job for run',
      10_000,
    ).then((job) => expect(job?.id).toBe(runId));

    const run = await waitFor(
      async () => {
        const current = await getRun(runId);
        return current.status === 'COMPLETED' ? current : null;
      },
      'run COMPLETED',
      40_000,
    );
    expect(run.status).toBe('COMPLETED');
    expect(run.results).toHaveLength(2);
    expect(run.results.every((item: any) => item.verdict === 'solved')).toBe(
      true,
    );
    expect(run.finishedAt).toBeTruthy();
  });
});

describe('Eval queue — cancellation', () => {
  it('cancels mid-run, stops writing results and is idempotent', async () => {
    const datasetId = await createDataset('cancel', [
      { question: 'qa_eq_cancel_fast', answer: 'fast answer' },
      { question: `qa_eq_cancel_2_${SLOW_MARKER}`, answer: 'slow answer 2' },
      { question: `qa_eq_cancel_3_${SLOW_MARKER}`, answer: 'slow answer 3' },
      { question: `qa_eq_cancel_4_${SLOW_MARKER}`, answer: 'slow answer 4' },
      { question: `qa_eq_cancel_5_${SLOW_MARKER}`, answer: 'slow answer 5' },
    ]);
    const runId = await startRun(datasetId);

    // At least one result lands before we cancel; the next case is in the
    // 4s judge delay, giving a deterministic cancellation window.
    await waitFor(
      async () => ((await resultCount(runId)) >= 1 ? true : null),
      'first eval result',
      20_000,
      50,
    );
    const beforeCancel = await resultCount(runId);

    const cancelled = await api('POST', `/v1/admin/ai-eval/runs/${runId}/cancel`);
    expect(cancelled.status).toBe(200);
    expect(cancelled.data.status).toBe('CANCELLED');
    expect(cancelled.data.finishedAt).toBeTruthy();
    expect(cancelled.data.summary?.cancelled).toBe(true);

    // The in-flight judge returns after ~4s; it must not add a result or
    // overwrite CANCELLED with COMPLETED/FAILED.
    await sleep(6_000);
    const afterWait = await getRun(runId);
    expect(afterWait.status).toBe('CANCELLED');
    expect(afterWait.summary?.cancelled).toBe(true);
    expect(await resultCount(runId)).toBe(beforeCancel);
    expect(afterWait.results).toHaveLength(beforeCancel);

    // Idempotent second cancel.
    const again = await api('POST', `/v1/admin/ai-eval/runs/${runId}/cancel`);
    expect(again.status).toBe(200);
    expect(again.data.status).toBe('CANCELLED');
    expect(await resultCount(runId)).toBe(beforeCancel);
  });
});

describe('Eval queue — jobId dedupe', () => {
  it('keeps exactly one job for the same run id', async () => {
    await queue.pause();
    try {
      const datasetId = await createDataset('dedupe', [
        { question: `qa_eq_dedupe_1_${SLOW_MARKER}`, answer: 'answer one' },
        { question: `qa_eq_dedupe_2_${SLOW_MARKER}`, answer: 'answer two' },
      ]);
      const runId = await startRun(datasetId);

      const job = await waitFor(
        () => queue.getJob(runId),
        'dedupe queue job',
        10_000,
      );
      expect(job.id).toBe(runId);

      const waitingForRun = async () =>
        (await queue.getWaiting()).filter((item) => item.id === runId).length;
      expect(await waitingForRun()).toBe(1);

      // Re-enqueue the same run twice; jobId must collapse to one job.
      await queue.add(JOB_NAME, { runId }, { jobId: runId, attempts: 1 });
      await queue.add(JOB_NAME, { runId }, { jobId: runId, attempts: 1 });
      expect(await waitingForRun()).toBe(1);
      expect((await queue.getJob(runId))?.id).toBe(runId);

      // Cleanly stop the paused run.
      const cancelled = await api('POST', `/v1/admin/ai-eval/runs/${runId}/cancel`);
      expect(cancelled.status).toBe(200);
      expect(cancelled.data.status).toBe('CANCELLED');
    } finally {
      await queue.resume();
    }
  });
});

describe('Eval queue — survives API restart', () => {
  it('a waiting job is consumed by the new API process', async () => {
    await queue.pause();
    try {
      const datasetId = await createDataset('restart', [
        { question: 'qa_eq_restart_1', answer: 'answer one' },
        { question: 'qa_eq_restart_2', answer: 'answer two' },
      ]);
      const runId = await startRun(datasetId);

      const job = await waitFor(
        () => queue.getJob(runId),
        'restart queue job',
        10_000,
      );
      expect(job.id).toBe(runId);
      expect((await getRun(runId)).status).toBe('RUNNING');

      // Kill and start the API while the job is still waiting in Redis.
      await restartApi();

      await queue.resume();

      const run = await waitFor(
        async () => {
          const current = await getRun(runId);
          return current.status === 'COMPLETED' ? current : null;
        },
        'run COMPLETED after API restart',
        60_000,
      );
      expect(run.status).toBe('COMPLETED');
      expect(run.results).toHaveLength(2);
    } finally {
      await queue.resume();
    }
  });
});

describe('Eval queue — feature flag', () => {
  it('blocks startRun when AI_EVAL_ENABLED=false but still cancels', async () => {
    await queue.pause();
    try {
      const datasetId = await createDataset('flag', [
        { question: `qa_eq_flag_1_${SLOW_MARKER}`, answer: 'answer one' },
        { question: `qa_eq_flag_2_${SLOW_MARKER}`, answer: 'answer two' },
      ]);
      const runId = await startRun(datasetId);
      await waitFor(() => queue.getJob(runId), 'flag queue job', 10_000);

      await restartApi('AI_EVAL_ENABLED=false');

      const blocked = await api('POST', `/v1/admin/ai-eval/datasets/${datasetId}/runs`, {
        mode: 'STORED',
      });
      expect(blocked.status).toBe(403);
      expect(String(blocked.body?.message ?? '')).toContain(
        'AI eval is disabled',
      );

      // Cancel is a safety valve and must not require the switch.
      const cancelled = await api('POST', `/v1/admin/ai-eval/runs/${runId}/cancel`);
      expect(cancelled.status).toBe(200);
      expect(cancelled.data.status).toBe('CANCELLED');
      expect(cancelled.data.summary?.cancelled).toBe(true);
    } finally {
      // Restore the normal QA API before the rest of the suite runs.
      await restartApi();
      await queue.resume();
    }
  });
});
