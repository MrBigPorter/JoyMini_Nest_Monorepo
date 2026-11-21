/**
 * Final batch (frozen ec114966): semantic clusters, closed/ignored guards,
 * fallback paths and eval token budget.
 *
 * Real QA API/DB/Redis + judge stub. The stub also implements Ollama-style
 * /api/embeddings: coupon questions share a dimension (cosine distance 0),
 * `qa_dim_mismatch` returns 768d, and a dead embedding URL exercises the
 * no-provider fallback.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
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

const PREFIX = 'qa_final_';
const SEM_A = '2027-02-10';
const SEM_B = '2027-02-11';
const SEM_C = '2027-02-12';
const SEM_D = '2027-02-13';
const FALLBACK_DAY = '2027-02-14';
const DIM_DAY = '2027-02-15';
const DATES = [SEM_A, SEM_B, SEM_C, SEM_D, FALLBACK_DAY, DIM_DAY];

const TEXT_A = 'qa_final_优惠券怎么领';
const TEXT_B = 'qa_final_哪里领券';
const TEXT_C = 'qa_final_优惠券在哪领取';
const TEXT_D = 'qa_final_怎么获得优惠券';
const TEXT_DIM = 'qa_final_qa_dim_mismatch_优惠券怎么领';
const FALLBACK_A = 'qa_final_退款怎么还没到';
const FALLBACK_B = 'qa_final_退款什么时候到';

const prisma = new PrismaService();
const queue = new Queue('ai-eval', {
  connection: { url: ENV.REDIS_URL ?? 'redis://127.0.0.1:6382/15' },
});
const runIds = new Set<string>();
// Pin embedding to the QA Ollama stub: Jina/Infinity are disabled so results
// do not depend on external providers or real API keys.
const BASE_ENV = ['JINA_API_KEY=', 'INFINITY_EMBEDDING_BASE_URL='];
jest.setTimeout(300_000);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const dayStart = (day: string) => new Date(`${day}T00:00:00.000Z`);
const at = (day: string, hour = 10) =>
  new Date(`${day}T${String(hour).padStart(2, '0')}:00:00.000Z`);

function signature(text: string): string {
  const normalized = text
    .trim()
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '');
  return createHash('sha256').update(normalized).digest('hex').slice(0, 64);
}

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
  timeoutMs = 60_000,
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
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const res = await fetch(`${API_BASE}/v1/health`);
      if (res.ok) return;
    } catch {
      // warm up a fresh socket after the restart
    }
    await sleep(250);
  }
  throw new Error('API warm-up failed after restart');
}

async function cleanup() {
  const clusters = await prisma.aiProblemCluster.findMany({
    where: { representativeText: { contains: PREFIX } },
    select: { id: true },
  });
  const clusterIds = clusters.map((row) => row.id);
  await prisma.aiProblemClusterDay.deleteMany({
    where: { clusterId: { in: clusterIds } },
  });
  await prisma.aiProblemCluster.deleteMany({
    where: { id: { in: clusterIds } },
  });
  await prisma.aiProblemEvent.deleteMany({
    where: {
      OR: [
        { id: { startsWith: PREFIX } },
        { sourceId: { startsWith: PREFIX } },
      ],
    },
  });
  await prisma.aiMetricWindow.deleteMany({
    where: { windowStart: { in: DATES.map(dayStart) } },
  });
  await prisma.aiAnalysisRun.deleteMany({
    where: { windowStart: { in: DATES.map(dayStart) } },
  });
  await prisma.aiAnalysisAlert.deleteMany({
    where: { windowStart: { in: DATES.map(dayStart) } },
  });
  await prisma.aiAnswerFeedback.deleteMany({
    where: { id: { startsWith: PREFIX } },
  });
  await prisma.aiTrace.deleteMany({ where: { id: { startsWith: PREFIX } } });
  await prisma.conversation.deleteMany({
    where: { id: { startsWith: PREFIX } },
  });

  for (const runId of runIds) {
    try {
      await (await queue.getJob(runId))?.remove();
    } catch {
      // terminal jobs may already be gone
    }
  }
  await prisma.$executeRawUnsafe(
    `DELETE FROM ai_scores
      WHERE metadata->>'evalRunId' IN (
        SELECT r.id FROM ai_eval_runs r
        JOIN ai_eval_datasets d ON d.id = r.dataset_id
        WHERE d.name LIKE 'qa_final_ds_%'
      )`,
  );
  await prisma.aiEvalDataset.deleteMany({
    where: { name: { startsWith: 'qa_final_ds_' } },
  });
  runIds.clear();
}

async function seedDay(day: string, inputs: string[]) {
  const conversationId = `${PREFIX}conv_${day}`;
  await prisma.conversation.create({
    data: {
      id: conversationId,
      type: 'SUPPORT',
      name: conversationId,
      status: 1,
      createdAt: at(day, 8),
    },
  });
  await prisma.aiTrace.create({
    data: {
      id: `${PREFIX}trace_${day}`,
      conversationId,
      source: 'qa',
      input: inputs[0],
      status: 'SUCCESS',
      createdAt: at(day, 9),
    },
  });
  await prisma.aiAnswerFeedback.createMany({
    data: inputs.map((input, index) => ({
      id: `${PREFIX}fb_${day}_${index + 1}`,
      conversationId,
      source: 'explicit',
      verdict: 'incorrect',
      input,
      createdAt: at(day, 10 + index),
    })),
  });
}

async function runWindow(day: string) {
  const res = await api('POST', '/v1/admin/ai-analysis/runs', { date: day });
  expect([200, 201]).toContain(res.status);
  return res.data;
}

async function clusterByText(text: string) {
  return prisma.aiProblemCluster.findUnique({
    where: { signature: signature(text) },
  });
}

async function hasEmbedding(clusterId: string): Promise<boolean> {
  const rows = await prisma.$queryRawUnsafe<Array<{ has: boolean }>>(
    'SELECT embedding IS NOT NULL AS has FROM ai_problem_clusters WHERE id = $1',
    clusterId,
  );
  return rows[0]?.has === true;
}

async function createEvalDataset(name: string, cases: any[]): Promise<string> {
  const created = await api('POST', '/v1/admin/ai-eval/datasets', {
    name: `qa_final_ds_${name}_${Date.now()}`,
    description: 'qa final batch budget',
  });
  expect([200, 201]).toContain(created.status);
  const datasetId = created.data.id as string;
  const added = await api('POST', `/v1/admin/ai-eval/datasets/${datasetId}/cases`, {
    cases,
  });
  expect([200, 201]).toContain(added.status);
  return datasetId;
}

async function startEvalRun(datasetId: string): Promise<string> {
  const res = await api('POST', `/v1/admin/ai-eval/datasets/${datasetId}/runs`, {
    mode: 'STORED',
  });
  expect([200, 201]).toContain(res.status);
  const runId = res.data.id as string;
  runIds.add(runId);
  return runId;
}

async function getEvalRun(runId: string) {
  const res = await api('GET', `/v1/admin/ai-eval/runs/${runId}`);
  expect(res.status).toBe(200);
  return res.data;
}

beforeAll(async () => {
  await cleanup();
  await restartApi(...BASE_ENV);
});

afterAll(async () => {
  try {
    await restartApi();
  } catch (err) {
    console.error('final API restore failed:', err);
  }
  await cleanup();
  await queue.close();
  await prisma.$disconnect();
});

describe('Semantic clustering (provider available)', () => {
  it('merges two different signatures into one cluster and keeps representative text', async () => {
    await seedDay(SEM_A, [TEXT_A]);
    const runA = await runWindow(SEM_A);
    expect(runA.status).toBe('COMPLETED');

    const clusterA = await clusterByText(TEXT_A);
    expect(clusterA).toBeTruthy();
    expect(await hasEmbedding(clusterA!.id)).toBe(true);
    expect(clusterA?.representativeText).toBe(TEXT_A);

    await seedDay(SEM_B, [TEXT_B]);
    const runB = await runWindow(SEM_B);
    expect(runB.status).toBe('COMPLETED');

    // Different signature, but the embedding hook makes distance 0 -> merge.
    expect(await clusterByText(TEXT_B)).toBeNull();
    const merged = await prisma.aiProblemCluster.findUnique({
      where: { id: clusterA!.id },
    });
    expect(merged?.count).toBe(2);
    expect(merged?.representativeText).toBe(TEXT_A);

    // Rerun does not double the count.
    await runWindow(SEM_B);
    expect(
      (await prisma.aiProblemCluster.findUnique({ where: { id: clusterA!.id } }))
        ?.count,
    ).toBe(2);
  });

  it('does not feed CLOSED or IGNORED clusters', async () => {
    const clusterA = await clusterByText(TEXT_A);
    const patched = await api(
      'PATCH',
      `/v1/admin/ai-analysis/clusters/${clusterA!.id}`,
      { status: 'CLOSED' },
    );
    expect(patched.status).toBe(200);

    await seedDay(SEM_C, [TEXT_C]);
    await runWindow(SEM_C);
    const clusterC = await clusterByText(TEXT_C);
    expect(clusterC).toBeTruthy();
    expect(clusterC!.id).not.toBe(clusterA!.id);
    expect(clusterC?.count).toBe(1);
    expect(
      (await prisma.aiProblemCluster.findUnique({ where: { id: clusterA!.id } }))
        ?.count,
    ).toBe(2);

    await api('PATCH', `/v1/admin/ai-analysis/clusters/${clusterC!.id}`, {
      status: 'IGNORED',
    });
    await seedDay(SEM_D, [TEXT_D]);
    await runWindow(SEM_D);
    const clusterD = await clusterByText(TEXT_D);
    expect(clusterD).toBeTruthy();
    expect(clusterD!.id).not.toBe(clusterC!.id);
    expect(clusterD?.count).toBe(1);
    expect(
      (await prisma.aiProblemCluster.findUnique({ where: { id: clusterC!.id } }))
        ?.count,
    ).toBe(1);
  });
});

describe('Semantic clustering fallbacks', () => {
  it('falls back to signature clustering when the provider is unavailable', async () => {
    await restartApi(
      ...BASE_ENV,
      'OLLAMA_EMBEDDING_BASE_URL=http://127.0.0.1:4198',
    );
    try {
      await seedDay(FALLBACK_DAY, [FALLBACK_A, FALLBACK_B]);
      const run = await runWindow(FALLBACK_DAY);
      expect(run.status).toBe('COMPLETED');

      const a = await clusterByText(FALLBACK_A);
      const b = await clusterByText(FALLBACK_B);
      expect(a).toBeTruthy();
      expect(b).toBeTruthy();
      expect(a!.id).not.toBe(b!.id);
      expect(a?.count).toBe(1);
      expect(b?.count).toBe(1);
    } finally {
      await restartApi(...BASE_ENV);
    }
  });

  it('falls back when the embedding dimension is not 1024', async () => {
    await seedDay(DIM_DAY, [TEXT_DIM]);
    const run = await runWindow(DIM_DAY);
    expect(run.status).toBe('COMPLETED');

    const cluster = await clusterByText(TEXT_DIM);
    expect(cluster).toBeTruthy();
    expect(await hasEmbedding(cluster!.id)).toBe(false);
  });
});

describe('Eval token budget', () => {
  it('fails a run when the budget is too small, and reports usage', async () => {
    await restartApi('AI_EVAL_RUN_TOKEN_BUDGET=200', ...BASE_ENV);
    try {
      const longAnswer = 'x'.repeat(2000);
      const datasetId = await createEvalDataset('tiny', [
        { question: 'qa_final_budget_long', answer: longAnswer, expected: 'ok' },
      ]);
      const runId = await startEvalRun(datasetId);
      const run = await waitFor(
        async () => {
          const current = await getEvalRun(runId);
          return current.status === 'FAILED' ? current : null;
        },
        'budget FAILED',
        30_000,
      );
      expect(run.summary?.error).toBe('token budget exceeded');
      expect(run.summary?.usage?.exceeded).toBe(true);
      expect(run.summary?.usage?.budget).toBe(200);
      expect(run.finishedAt).toBeTruthy();
    } finally {
      await restartApi(...BASE_ENV);
    }
  });

  it('keeps cancellation ahead of budget/completion', async () => {
    await restartApi('AI_EVAL_RUN_TOKEN_BUDGET=200', ...BASE_ENV);
    try {
      const datasetId = await createEvalDataset('cancel-priority', [
        {
          question: 'qa_final_cancel_slow_qa_eval_slow',
          answer: 'short answer one',
          expected: 'ok',
        },
        {
          question: 'qa_final_cancel_slow_qa_eval_slow_2',
          answer: 'short answer two',
          expected: 'ok',
        },
      ]);
      const runId = await startEvalRun(datasetId);
      await sleep(800);
      const cancelled = await api(
        'POST',
        `/v1/admin/ai-eval/runs/${runId}/cancel`,
      );
      expect(cancelled.status).toBe(200);

      await sleep(6_000);
      const run = await getEvalRun(runId);
      expect(run.status).toBe('CANCELLED');
      expect(run.status).not.toBe('FAILED');
      expect(run.status).not.toBe('COMPLETED');
    } finally {
      await restartApi(...BASE_ENV);
    }
  });

  it('records usage on a normal completed run without configured prices', async () => {
    const datasetId = await createEvalDataset('normal', [
      { question: 'qa_final_budget_ok_1', answer: 'answer one', expected: 'ok' },
      { question: 'qa_final_budget_ok_2', answer: 'answer two', expected: 'ok' },
    ]);
    const runId = await startEvalRun(datasetId);
    const run = await waitFor(
      async () => {
        const current = await getEvalRun(runId);
        return current.status === 'COMPLETED' ? current : null;
      },
      'normal COMPLETED',
      30_000,
    );
    expect(run.summary?.usage?.estimatedTokens).toBeGreaterThan(0);
    expect(run.summary?.usage?.costConfigured).toBe(false);
    expect(run.summary?.usage?.exceeded).toBe(false);
    expect(run.results).toHaveLength(2);
  });
});
