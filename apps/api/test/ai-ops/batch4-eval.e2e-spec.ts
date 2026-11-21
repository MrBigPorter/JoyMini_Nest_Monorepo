/**
 * Batch 4 — eval honesty + run lifecycle (real QA API/DB).
 *
 * Covers:
 *   - empty expectation rejected; expected answer accepted
 *   - concurrent run rejected
 *   - stale RUNNING run recovered to FAILED with summary.error
 *   - case edit/delete + cross-dataset 404
 *   - STORED run summary + result/score traceId null
 *   - LIVE run result/score traceId null
 *   - judge failure -> run FAILED with summary.error
 *
 * The QA judge stub returns 500 for questions containing `qa_judge_fail`, so
 * the FAILED path is deterministic. The chat graph is pointed at the same stub
 * for LIVE eval (see qa/.env.qa).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
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
const ADMIN_TOKEN = jwt.sign(
  { sub: 'qa_admin_admin', role: 'ADMIN', type: 'admin', username: 'qa_admin' },
  ENV.ADMIN_JWT_SECRET ?? 'qa_admin_jwt_secret_change_me_0123456789',
  { expiresIn: '1h' },
);
const PREFIX = 'qa_b4_api_';

const prisma = new PrismaService();

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
  await prisma
    .$executeRawUnsafe(
      `DELETE FROM ai_scores WHERE metadata->>'evalRunId' IN (
         SELECT id FROM ai_eval_runs WHERE dataset_id IN (
           SELECT id FROM ai_eval_datasets WHERE name LIKE '${PREFIX}%'
         )
       )`,
    )
    .catch(() => undefined);
  await prisma.aiEvalDataset
    .deleteMany({ where: { name: { startsWith: PREFIX } } })
    .catch(() => undefined);
}

async function createDataset(name: string): Promise<string> {
  const res = await api('POST', '/v1/admin/ai-eval/datasets', { name });
  expect(res.status).toBe(201);
  return res.data.id as string;
}

async function addCase(
  datasetId: string,
  input: {
    question: string;
    answer?: string;
    expect?: Record<string, unknown>;
    expected?: string | Record<string, unknown>;
  },
): Promise<string> {
  const res = await api(
    'POST',
    `/v1/admin/ai-eval/datasets/${datasetId}/cases`,
    {
      cases: [
        {
          question: input.question,
          answer: input.answer ?? 'qa_b4_answer',
          ...(input.expect !== undefined ? { expect: input.expect } : {}),
          ...(input.expected !== undefined
            ? { expected: input.expected }
            : {}),
        },
      ],
    },
  );
  expect(res.status).toBe(201);
  const cases = res.data.cases ?? [];
  const created = cases.find((c: any) => c.question === input.question);
  expect(created).toBeTruthy();
  return created.id as string;
}

async function startRun(
  datasetId: string,
  mode: 'STORED' | 'LIVE' = 'STORED',
): Promise<ApiResult> {
  return api('POST', `/v1/admin/ai-eval/datasets/${datasetId}/runs`, {
    mode,
  });
}

async function pollRun(runId: string, timeoutMs = 90_000): Promise<any> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await api('GET', `/v1/admin/ai-eval/runs/${runId}`);
    if (res.status === 200) {
      const status = res.data?.status;
      if (status === 'COMPLETED' || status === 'FAILED') return res.data;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`run ${runId} did not reach a terminal state`);
}

async function getDataset(id: string): Promise<any> {
  const res = await api('GET', `/v1/admin/ai-eval/datasets/${id}`);
  expect(res.status).toBe(200);
  return res.data;
}

beforeAll(async () => {
  await waitForApi();
  await cleanup();
  const features = await api('GET', '/v1/admin/ai-ops/features');
  expect(features.status).toBe(200);
  if (!features.data.evalEnabled) {
    throw new Error(
      'eval is disabled in the running API; restart with AI_EVAL_ENABLED=true',
    );
  }
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe('Batch 4 — expectation gate', () => {
  it('rejects a run when expect={} and expected is null', async () => {
    const ds = await createDataset(`${PREFIX}empty`);
    await addCase(ds, { question: 'qa_b4_empty_q', expect: {} });

    const res = await startRun(ds);
    expect(res.status).toBe(400);
    expect(String(res.body?.message ?? '')).toContain('no expectation');
  });

  it('D-B4-01: accepts a non-empty string `expected` without expect.mustMention', async () => {
    const ds = await createDataset(`${PREFIX}string_expected`);
    await addCase(ds, {
      question: 'qa_b4_string_q',
      expect: {},
      expected: 'must mention 7 days',
    });

    // Handoff/acceptance: adding `expected` is enough to start the run.
    const res = await startRun(ds);
    expect(res.status).toBe(201);
    const run = await pollRun(res.data.id);
    expect(run.status).toBe('COMPLETED');
  });

  it('accepts expected as an object without expect.mustMention', async () => {
    const ds = await createDataset(`${PREFIX}object_only_expected`);
    await addCase(ds, {
      question: 'qa_b4_object_only_q',
      expect: {},
      expected: { mustMention: ['7 days'] },
    });

    const res = await startRun(ds);
    expect(res.status).toBe(201);
    const run = await pollRun(res.data.id);
    expect(run.status).toBe('COMPLETED');
  });

  it('accepts expected as an object and produces a summary', async () => {
    const ds = await createDataset(`${PREFIX}object_expected`);
    await addCase(ds, {
      question: 'qa_b4_object_q1',
      expect: { mustMention: ['7 days'] },
      expected: { mustMention: ['7 days'] },
    });
    await addCase(ds, {
      question: 'qa_b4_object_q2',
      expect: { mustMention: ['refund'] },
    });

    const res = await startRun(ds);
    expect(res.status).toBe(201);
    const run = await pollRun(res.data.id);
    expect(run.status).toBe('COMPLETED');
    expect(run.summary).toMatchObject({ mode: 'STORED', total: 2 });
    expect(typeof run.summary.passRate).toBe('number');
    expect(run.results.length).toBe(2);
    for (const result of run.results) {
      expect(result.traceId).toBeNull();
    }
    const scores = await prisma.aiScore.findMany({
      where: {
        metadata: { path: ['evalRunId'], equals: run.id } as never,
      },
    });
    expect(scores.length).toBe(2);
    for (const score of scores) expect(score.traceId).toBeNull();
  });
});

describe('Batch 4 — run lifecycle', () => {
  it('rejects a second run while one is RUNNING', async () => {
    const ds = await createDataset(`${PREFIX}concurrent`);
    await addCase(ds, {
      question: 'qa_b4_concurrent_q',
      expect: { mustMention: ['x'] },
    });
    await prisma.aiEvalRun.create({
      data: {
        id: `${PREFIX}running`,
        datasetId: ds,
        status: 'RUNNING',
        mode: 'STORED',
        startedAt: new Date(),
      },
    });

    const res = await startRun(ds);
    expect(res.status).toBe(400);
    expect(String(res.body?.message ?? '')).toContain('run in progress');
  });

  it('recovers a 40-minute-old RUNNING run to FAILED with summary.error', async () => {
    const ds = await createDataset(`${PREFIX}stale`);
    await addCase(ds, {
      question: 'qa_b4_stale_q',
      expect: { mustMention: ['x'] },
    });
    const staleId = `${PREFIX}stale_run`;
    await prisma.aiEvalRun.create({
      data: {
        id: staleId,
        datasetId: ds,
        status: 'RUNNING',
        mode: 'STORED',
        startedAt: new Date(Date.now() - 40 * 60 * 1000),
      },
    });

    const res = await api('GET', `/v1/admin/ai-eval/runs/${staleId}`);
    expect(res.status).toBe(200);
    expect(res.data.status).toBe('FAILED');
    expect(String(res.data.summary?.error ?? '')).toContain('stale RUNNING');
    expect(res.data.finishedAt).toBeTruthy();
  });

  it('surfaces a judge failure as FAILED with summary.error', async () => {
    const ds = await createDataset(`${PREFIX}judge_fail`);
    await addCase(ds, {
      question: 'qa_judge_fail_question',
      expect: { mustMention: ['x'] },
    });

    const res = await startRun(ds);
    expect(res.status).toBe(201);
    const run = await pollRun(res.data.id);
    expect(run.status).toBe('FAILED');
    expect(String(run.summary?.error ?? '')).toContain('judge');
  });
});

describe('Batch 4 — case edit / delete', () => {
  it('PATCH persists the expectation, DELETE removes it, cross-dataset is 404', async () => {
    const dsA = await createDataset(`${PREFIX}cases_a`);
    const dsB = await createDataset(`${PREFIX}cases_b`);
    const caseA = await addCase(dsA, {
      question: 'qa_b4_case_a',
      expect: { mustMention: ['old'] },
    });
    const caseB = await addCase(dsB, {
      question: 'qa_b4_case_b',
      expect: { mustMention: ['b'] },
    });

    const patch = await api(
      'PATCH',
      `/v1/admin/ai-eval/datasets/${dsA}/cases/${caseA}`,
      { expected: 'updated expectation', expect: { mustMention: ['updated'] } },
    );
    expect(patch.status).toBe(200);
    const afterPatch = await getDataset(dsA);
    const updated = afterPatch.cases.find((c: any) => c.id === caseA);
    expect(updated.expected).toBe('updated expectation');
    expect(updated.expect).toEqual({ mustMention: ['updated'] });

    const crossPatch = await api(
      'PATCH',
      `/v1/admin/ai-eval/datasets/${dsA}/cases/${caseB}`,
      { expected: 'x' },
    );
    expect(crossPatch.status).toBe(404);
    const crossDelete = await api(
      'DELETE',
      `/v1/admin/ai-eval/datasets/${dsA}/cases/${caseB}`,
    );
    expect(crossDelete.status).toBe(404);

    const del = await api(
      'DELETE',
      `/v1/admin/ai-eval/datasets/${dsA}/cases/${caseA}`,
    );
    expect(del.status).toBe(200);
    const afterDelete = await getDataset(dsA);
    expect(afterDelete.cases.some((c: any) => c.id === caseA)).toBe(false);
  });
});

describe('Batch 4 — LIVE eval trace lineage', () => {
  it('LIVE result and score keep traceId null (no dangling id)', async () => {
    const ds = await createDataset(`${PREFIX}live`);
    await addCase(ds, {
      question: 'qa_b4_live_q',
      expect: { mustMention: ['7 days'] },
    });

    const res = await startRun(ds, 'LIVE');
    expect(res.status).toBe(201);
    const run = await pollRun(res.data.id, 120_000);
    expect(['COMPLETED', 'FAILED']).toContain(run.status);
    expect(run.results.length).toBeGreaterThan(0);
    for (const result of run.results) {
      expect(result.traceId).toBeNull();
    }
    const scores = await prisma.aiScore.findMany({
      where: {
        metadata: { path: ['evalRunId'], equals: run.id } as never,
      },
    });
    expect(scores.length).toBeGreaterThan(0);
    for (const score of scores) expect(score.traceId).toBeNull();
  });
});
