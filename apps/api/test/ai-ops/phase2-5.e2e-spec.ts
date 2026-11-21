/**
 * 119 Phase 2–5 QA (frozen 50e7aaaf / code 2a8fc31a).
 *
 * Covers:
 *   2. problem clusters: same normalized question -> one cluster/count; rerun
 *      is idempotent; different question -> different cluster.
 *   3. alerts: 4 days of history + high current value with sample>=5 -> alerts;
 *      sample<5 -> no alert; ACK.
 *   4. fix loop: PATCH status/owner/fixType; create eval case from cluster with
 *      expected/expect.mustMention/source=cluster/metadata.clusterId; cluster
 *      becomes FIXING; empty expected -> 400.
 *   5. retention: purge old events/runs/cluster-days/alerts, keep fresh rows.
 */
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as jwt from 'jsonwebtoken';
import { PrismaService } from '@api/common/prisma/prisma.service';
import { AiAnalysisService } from '@api/admin/ai-analysis/ai-analysis.service';

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
  { expiresIn: '2h' },
);

const PREFIX = 'qa_p25_';
const CLUSTER_DAY = '2026-12-20';
const LOW_DAY = '2026-12-22';
const HISTORY_DAYS = ['2026-12-16', '2026-12-17', '2026-12-18', '2026-12-19'];
const DATES = [...HISTORY_DAYS, CLUSTER_DAY, LOW_DAY];
const DATASET_NAME = `${PREFIX}regression_ds`;

const prisma = new PrismaService();
const analysis = new AiAnalysisService(prisma, {} as never, {} as never);

const SAME_QUESTION = [
  'QA_P25_退款未到账 请帮我看看',
  'QA_P25_退款未到账！请帮我看看？',
  'qa_p25_退款未到账，请帮我看看。',
  'QA_P25_退款未到账?? 请帮我看看',
  'QA_P25_退款未到账 请 帮 我 看 看',
];
const OTHER_QUESTION = ['QA_P25_优惠券无法领取', 'QA_P25_优惠券无法领取！'];

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

const SAME_SIGNATURE = signature(SAME_QUESTION[0]);
const OTHER_SIGNATURE = signature(OTHER_QUESTION[0]);

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

async function cleanup() {
  const clusters = await prisma.aiProblemCluster.findMany({
    where: {
      OR: [
        { signature: { in: [SAME_SIGNATURE, OTHER_SIGNATURE] } },
        { representativeText: { contains: 'QA_P25_' } },
      ],
    },
    select: { id: true },
  });
  const clusterIds = clusters.map((row) => row.id);

  await prisma.aiProblemClusterDay.deleteMany({
    where: {
      OR: [
        { clusterId: { in: clusterIds } },
        { clusterId: { startsWith: PREFIX } },
      ],
    },
  });
  await prisma.aiProblemCluster.deleteMany({
    where: {
      OR: [
        { id: { in: clusterIds } },
        { representativeText: { contains: 'QA_P25_' } },
      ],
    },
  });
  await prisma.aiProblemEvent.deleteMany({
    where: {
      OR: [
        { id: { startsWith: PREFIX } },
        { sourceId: { startsWith: PREFIX } },
      ],
    },
  });
  await prisma.aiAnalysisAlert.deleteMany({
    where: {
      OR: [
        { windowStart: { in: DATES.map(dayStart) } },
        { id: { startsWith: PREFIX } },
      ],
    },
  });
  await prisma.aiAnalysisRun.deleteMany({
    where: {
      OR: [
        { jobType: 'EVENT_BUILD', windowStart: { in: DATES.map(dayStart) } },
        { id: { startsWith: PREFIX } },
      ],
    },
  });
  await prisma.aiMetricWindow.deleteMany({
    where: { windowStart: { in: DATES.map(dayStart) } },
  });
  await prisma.aiAnswerFeedback.deleteMany({
    where: { id: { startsWith: PREFIX } },
  });
  await prisma.aiTrace.deleteMany({ where: { id: { startsWith: PREFIX } } });
  await prisma.conversation.deleteMany({ where: { id: { startsWith: PREFIX } } });
  await prisma.aiEvalDataset.deleteMany({
    where: { name: { startsWith: PREFIX } },
  });
}

async function seedHistory(metric: string, value: number) {
  await prisma.aiMetricWindow.createMany({
    data: HISTORY_DAYS.map((day, index) => ({
      windowStart: dayStart(day),
      windowType: 'DAY',
      metric,
      dimension: 'ALL',
      dimensionValue: 'ALL',
      numerator: Math.round(value * 100),
      denominator: 100,
      value,
      sampleSize: 100,
      createdAt: new Date(at(day, 1).getTime() + index),
    })),
    skipDuplicates: true,
  });
}

async function seedCommon() {
  // Conversations: repeat_rate denominator = 10.
  await prisma.conversation.createMany({
    data: Array.from({ length: 10 }, (_, index) => ({
      id: `${PREFIX}conv_${index + 1}`,
      type: 'SUPPORT' as const,
      name: `${PREFIX}conv_${index + 1}`,
      status: 1,
      createdAt: at(CLUSTER_DAY, 8),
    })),
  });

  // Traces: problem_rate denominator = 7.
  await prisma.aiTrace.createMany({
    data: Array.from({ length: 7 }, (_, index) => ({
      id: `${PREFIX}trace_${index + 1}`,
      conversationId: `${PREFIX}conv_1`,
      source: 'qa',
      intent: null,
      input:
        index === 0
          ? 'QA_P25_退款未到账? 请帮我看看'
          : `qa_p25_trace_input_${index + 1}`,
      output: 'qa',
      status: 'SUCCESS',
      createdAt: at(CLUSTER_DAY, 9),
    })),
  });

  await prisma.aiSpan.create({
    data: {
      id: `${PREFIX}span_zero`,
      traceId: `${PREFIX}trace_1`,
      type: 'rag',
      name: 'qa-rag',
      status: 'OK',
      output: { sourceCount: 0 },
      startedAt: at(CLUSTER_DAY, 9),
    },
  });

  // 5 explicit negatives with the same problem (punctuation/case variants).
  await prisma.aiAnswerFeedback.createMany({
    data: SAME_QUESTION.map((input, index) => ({
      id: `${PREFIX}fb_same_${index + 1}`,
      conversationId: `${PREFIX}conv_1`,
      source: 'explicit',
      verdict: 'incorrect',
      input,
      createdAt: at(CLUSTER_DAY, 10 + index),
    })),
  });

  // 2 events of a different problem -> its own cluster.
  await prisma.aiAnswerFeedback.createMany({
    data: OTHER_QUESTION.map((input, index) => ({
      id: `${PREFIX}fb_other_${index + 1}`,
      conversationId: `${PREFIX}conv_1`,
      source: 'explicit',
      verdict: 'incorrect',
      input,
      createdAt: at(CLUSTER_DAY, 12 + index),
    })),
  });

  // 3 repeated-question events without preview: drive repeat_rate to 0.3
  // (MEDIUM alert) but do not create clusters.
  await prisma.aiAnswerFeedback.createMany({
    data: Array.from({ length: 3 }, (_, index) => ({
      id: `${PREFIX}fb_repeat_${index + 1}`,
      conversationId: `${PREFIX}conv_1`,
      source: 'implicit',
      signal: 'repeated_question',
      input: null,
      createdAt: at(CLUSTER_DAY, 14 + index),
    })),
  });

  await seedHistory('problem_rate', 0.05);
  await seedHistory('explicit_negative_rate', 0.05);
  await seedHistory('repeat_rate', 0.1);
}

async function runWindow(day: string) {
  const result = await api('POST', '/v1/admin/ai-analysis/runs', { date: day });
  expect([200, 201]).toContain(result.status);
  return result.data;
}

beforeAll(async () => {
  await cleanup();
  await seedCommon();
  const run = await runWindow(CLUSTER_DAY);
  expect(run.status).toBe('COMPLETED');
  expect(run.createdEvents).toBe(11); // 5 explicit + 2 other + 3 repeated + 1 zero-hit trace
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe('Phase 2 — problem clusters', () => {
  it('groups the same normalized question into one cluster with the exact count', async () => {
    const cluster = await prisma.aiProblemCluster.findUnique({
      where: { signature: SAME_SIGNATURE },
    });
    expect(cluster).toBeTruthy();
    expect(cluster?.count).toBe(6);

    const events = await prisma.aiProblemEvent.findMany({
      where: { clusterId: cluster!.id },
    });
    expect(events).toHaveLength(6);
    // 5 feedback events + 1 trace-derived ZERO_HIT share the same normalized text.
    expect(events.filter((row) => row.type === 'EXPLICIT_NEGATIVE')).toHaveLength(5);
    expect(events.filter((row) => row.type === 'ZERO_HIT')).toHaveLength(1);

    const day = await prisma.aiProblemClusterDay.findUnique({
      where: {
        clusterId_day: {
          clusterId: cluster!.id,
          day: dayStart(CLUSTER_DAY),
        },
      },
    });
    expect(day?.count).toBe(6);

    // Different question -> different cluster id/signature.
    const other = await prisma.aiProblemCluster.findUnique({
      where: { signature: OTHER_SIGNATURE },
    });
    expect(other).toBeTruthy();
    expect(other?.count).toBe(2);
    expect(other!.id).not.toBe(cluster!.id);
  });

  it('reruns the same window without doubling cluster counts', async () => {
    const before = await prisma.aiProblemCluster.findUnique({
      where: { signature: SAME_SIGNATURE },
    });
    const run = await runWindow(CLUSTER_DAY);
    expect(run.status).toBe('COMPLETED');

    const after = await prisma.aiProblemCluster.findUnique({
      where: { signature: SAME_SIGNATURE },
    });
    expect(after?.count).toBe(before?.count);
    expect(after?.count).toBe(6);

    const day = await prisma.aiProblemClusterDay.findUnique({
      where: {
        clusterId_day: { clusterId: after!.id, day: dayStart(CLUSTER_DAY) },
      },
    });
    expect(day?.count).toBe(6);

    const events = await prisma.aiProblemEvent.count({
      where: { clusterId: after!.id },
    });
    expect(events).toBe(6);
  });
});

describe('Phase 3 — alerts', () => {
  it('creates HIGH/MEDIUM alerts for a high value with enough history and sample', async () => {
    const alerts = await prisma.aiAnalysisAlert.findMany({
      where: { windowStart: dayStart(CLUSTER_DAY) },
    });
    const byMetric = new Map(alerts.map((row) => [row.metric, row]));
    expect(byMetric.has('problem_rate')).toBe(true);
    expect(byMetric.has('explicit_negative_rate')).toBe(true);
    expect(byMetric.has('repeat_rate')).toBe(true);

    expect(byMetric.get('problem_rate')?.severity).toBe('HIGH');
    expect(byMetric.get('explicit_negative_rate')?.severity).toBe('HIGH');
    expect(byMetric.get('repeat_rate')?.severity).toBe('MEDIUM');
    expect(byMetric.get('repeat_rate')?.value).toBeCloseTo(0.3, 6);

    // API list surfaces the same alerts.
    const listed = await api(
      'GET',
      '/v1/admin/ai-analysis/alerts?status=NEW&pageSize=100',
    );
    expect(listed.status).toBe(200);
    const ours = (listed.data.list as any[]).filter(
      (row) => row.windowStart.slice(0, 10) === CLUSTER_DAY,
    );
    expect(ours.length).toBeGreaterThanOrEqual(3);
  });

  it('does not alert when the sample is below 5', async () => {
    await prisma.aiAnswerFeedback.createMany({
      data: Array.from({ length: 4 }, (_, index) => ({
        id: `${PREFIX}low_fb_${index + 1}`,
        conversationId: `${PREFIX}conv_1`,
        source: 'implicit',
        failureKind: 'SERVICE_ERROR',
        input: null,
        createdAt: at(LOW_DAY, 10 + index),
      })),
    });
    await prisma.aiTrace.createMany({
      data: Array.from({ length: 4 }, (_, index) => ({
        id: `${PREFIX}low_trace_${index + 1}`,
        conversationId: `${PREFIX}conv_1`,
        source: 'qa',
        input: `qa_p25_low_${index + 1}`,
        status: 'SUCCESS',
        createdAt: at(LOW_DAY, 9),
      })),
    });

    const run = await runWindow(LOW_DAY);
    expect(run.status).toBe('COMPLETED');
    expect(
      await prisma.aiAnalysisAlert.count({
        where: { windowStart: dayStart(LOW_DAY) },
      }),
    ).toBe(0);
  });

  it('ACKs an alert and moves it out of the NEW list', async () => {
    const alert = await prisma.aiAnalysisAlert.findFirst({
      where: { windowStart: dayStart(CLUSTER_DAY) },
      orderBy: { createdAt: 'asc' },
    });
    expect(alert).toBeTruthy();

    const ack = await api(
      'PATCH',
      `/v1/admin/ai-analysis/alerts/${alert!.id}/ack`,
    );
    expect(ack.status).toBe(200);
    expect(ack.data.status).toBe('ACK');

    const db = await prisma.aiAnalysisAlert.findUnique({
      where: { id: alert!.id },
    });
    expect(db?.status).toBe('ACK');

    const newList = await api(
      'GET',
      '/v1/admin/ai-analysis/alerts?status=NEW&pageSize=100',
    );
    expect(
      (newList.data.list as any[]).some((row) => row.id === alert!.id),
    ).toBe(false);
    const ackList = await api(
      'GET',
      '/v1/admin/ai-analysis/alerts?status=ACK&pageSize=100',
    );
    expect(
      (ackList.data.list as any[]).some((row) => row.id === alert!.id),
    ).toBe(true);
  });
});

describe('Phase 4 — fix loop', () => {
  it('PATCHes status/owner/fixType and creates a regression case', async () => {
    const cluster = await prisma.aiProblemCluster.findUnique({
      where: { signature: SAME_SIGNATURE },
    });
    expect(cluster).toBeTruthy();

    const patched = await api(
      'PATCH',
      `/v1/admin/ai-analysis/clusters/${cluster!.id}`,
      {
        status: 'ASSIGNED',
        ownerAdminId: 'qa_admin_admin',
        fixType: 'PROMPT',
        suggestedCause: 'MODEL',
      },
    );
    expect(patched.status).toBe(200);
    expect(patched.data).toMatchObject({
      status: 'ASSIGNED',
      ownerAdminId: 'qa_admin_admin',
      fixType: 'PROMPT',
      suggestedCause: 'MODEL',
    });

    const dataset = await api('POST', '/v1/admin/ai-eval/datasets', {
      name: DATASET_NAME,
      description: 'qa phase2-5 regression',
    });
    expect([200, 201]).toContain(dataset.status);
    const datasetId = dataset.data.id as string;

    const expected = 'qa_p25_expected_refund_arrives';
    const regression = await api(
      'POST',
      `/v1/admin/ai-analysis/clusters/${cluster!.id}/regression`,
      { datasetId, expected },
    );
    expect([200, 201]).toContain(regression.status);
    expect(regression.data.status).toBe('FIXING');

    const testCase = await prisma.aiEvalCase.findFirst({
      where: { datasetId, source: 'cluster' },
    });
    expect(testCase).toBeTruthy();
    expect(testCase?.question).toBe(cluster!.representativeText);
    expect(testCase?.expected).toBe(expected);
    expect(testCase?.expect).toMatchObject({ mustMention: [expected] });
    expect(testCase?.metadata).toMatchObject({ clusterId: cluster!.id });

    const dbCluster = await prisma.aiProblemCluster.findUnique({
      where: { id: cluster!.id },
    });
    expect(dbCluster?.status).toBe('FIXING');

    const empty = await api(
      'POST',
      `/v1/admin/ai-analysis/clusters/${cluster!.id}/regression`,
      { datasetId, expected: '' },
    );
    expect(empty.status).toBe(400);
  });
});

describe('Phase 5 — retention', () => {
  it('purges old rows and keeps fresh ones', async () => {
    const now = Date.now();
    const old = new Date(now - 400 * 24 * 3600_000);
    const fresh = new Date(now - 10 * 24 * 3600_000);

    await prisma.aiProblemEvent.createMany({
      data: [
        {
          id: `${PREFIX}ret_old_event`,
          occurredAt: old,
          windowStart: old,
          windowType: 'DAY',
          type: 'QA_P25_RET',
          severity: 1,
          confidence: 1,
          source: 'qa',
          sourceId: `${PREFIX}ret_old_src`,
        },
        {
          id: `${PREFIX}ret_new_event`,
          occurredAt: fresh,
          windowStart: fresh,
          windowType: 'DAY',
          type: 'QA_P25_RET',
          severity: 1,
          confidence: 1,
          source: 'qa',
          sourceId: `${PREFIX}ret_new_src`,
        },
      ],
    });
    await prisma.aiAnalysisRun.createMany({
      data: [
        {
          id: `${PREFIX}ret_old_run`,
          jobType: 'QA_P25_RET',
          windowStart: old,
          windowEnd: new Date(old.getTime() + 86_400_000),
          status: 'COMPLETED',
          startedAt: old,
        },
        {
          id: `${PREFIX}ret_new_run`,
          jobType: 'QA_P25_RET',
          windowStart: fresh,
          windowEnd: new Date(fresh.getTime() + 86_400_000),
          status: 'COMPLETED',
          startedAt: fresh,
        },
      ],
    });
    await prisma.aiProblemClusterDay.createMany({
      data: [
        {
          id: `${PREFIX}ret_old_day`,
          clusterId: `${PREFIX}ret_cluster`,
          day: old,
          count: 1,
        },
        {
          id: `${PREFIX}ret_new_day`,
          clusterId: `${PREFIX}ret_cluster`,
          day: fresh,
          count: 1,
        },
      ],
    });
    await prisma.aiAnalysisAlert.createMany({
      data: [
        {
          id: `${PREFIX}ret_old_alert`,
          windowStart: old,
          metric: 'qa_p25_ret_metric',
          dimension: 'ALL',
          dimensionValue: 'ALL',
          value: 1,
          baseline: 0.1,
          sampleSize: 10,
          severity: 'HIGH',
          message: 'qa_p25_ret',
          createdAt: old,
        },
        {
          id: `${PREFIX}ret_new_alert`,
          windowStart: fresh,
          metric: 'qa_p25_ret_metric',
          dimension: 'ALL',
          dimensionValue: 'ALL',
          value: 1,
          baseline: 0.1,
          sampleSize: 10,
          severity: 'HIGH',
          message: 'qa_p25_ret',
          createdAt: fresh,
        },
      ],
    });

    await analysis.purgeExpired();

    expect(
      await prisma.aiProblemEvent.findUnique({
        where: { id: `${PREFIX}ret_old_event` },
      }),
    ).toBeNull();
    expect(
      await prisma.aiAnalysisRun.findUnique({
        where: { id: `${PREFIX}ret_old_run` },
      }),
    ).toBeNull();
    expect(
      await prisma.aiProblemClusterDay.findUnique({
        where: { id: `${PREFIX}ret_old_day` },
      }),
    ).toBeNull();
    expect(
      await prisma.aiAnalysisAlert.findUnique({
        where: { id: `${PREFIX}ret_old_alert` },
      }),
    ).toBeNull();

    expect(
      await prisma.aiProblemEvent.findUnique({
        where: { id: `${PREFIX}ret_new_event` },
      }),
    ).toBeTruthy();
    expect(
      await prisma.aiAnalysisRun.findUnique({
        where: { id: `${PREFIX}ret_new_run` },
      }),
    ).toBeTruthy();
    expect(
      await prisma.aiProblemClusterDay.findUnique({
        where: { id: `${PREFIX}ret_new_day` },
      }),
    ).toBeTruthy();
    expect(
      await prisma.aiAnalysisAlert.findUnique({
        where: { id: `${PREFIX}ret_new_alert` },
      }),
    ).toBeTruthy();
  });
});
