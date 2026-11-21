/**
 * Privacy + retention QA (commit b152616c).
 *
 * Covers:
 *   1. recordReplyTrace redacts phone/email/ID in AiTrace input/output
 *      (order numbers preserved); also checks AiSpan output snippets.
 *   2. TraceService.purgeExpired deletes >30d traces/spans/LLM scores but
 *      keeps HUMAN scores and new traces.
 *   3. VIEWER eval reads are redacted; ADMIN raw; VIEWER/EDITOR judge 403.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as jwt from 'jsonwebtoken';

// AiCustomerService pulls meilisearch (ESM) and uuid (ESM).
jest.mock('meilisearch', () => ({
  Meilisearch: class Meilisearch {},
}));
jest.mock('uuid', () => ({
  v4: () => '00000000-0000-4000-8000-000000000000',
}));

import { PrismaService } from '@api/common/prisma/prisma.service';
import { TraceService } from '@api/admin/ai-traces/ai-traces.service';
import { AiCustomerService } from '@api/client/ai-customer/ai-customer.service';

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
process.env.AI_TRACE_RETENTION_DAYS = '30';

const API_BASE = (ENV.QA_API_URL ?? 'http://127.0.0.1:4102/api').replace(
  /\/$/,
  '',
);
const SECRET =
  ENV.ADMIN_JWT_SECRET ?? 'qa_admin_jwt_secret_change_me_0123456789';
const ROLES = {
  VIEWER: 'qa_admin_viewer',
  EDITOR: 'qa_admin_editor',
  ADMIN: 'qa_admin_admin',
  SUPER_ADMIN: 'qa_admin_super',
} as const;
type QaRole = keyof typeof ROLES;
const QA = 'qa_pr_';

function tokenFor(role: QaRole): string {
  return jwt.sign(
    { sub: ROLES[role], role, type: 'admin', username: `qa_${role.toLowerCase()}` },
    SECRET,
    { expiresIn: '1h' },
  );
}

const prisma = new PrismaService();
const traceService = new TraceService(prisma);

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
  const oldTraces = await prisma.aiTrace.findMany({
    where: {
      OR: [
        { id: { startsWith: QA } },
        { conversationId: { startsWith: QA } },
      ],
    },
    select: { id: true },
  });
  const oldTraceIds = oldTraces.map((t) => t.id);
  await prisma.aiSpan.deleteMany({
    where: {
      OR: [
        { id: { startsWith: QA } },
        ...(oldTraceIds.length ? [{ traceId: { in: oldTraceIds } }] : []),
      ],
    },
  });
  await prisma.aiTrace.deleteMany({
    where: {
      OR: [
        { id: { startsWith: QA } },
        { conversationId: { startsWith: QA } },
      ],
    },
  });
  await prisma.aiScore.deleteMany({ where: { id: { startsWith: QA } } });
  await prisma.aiEvalDataset.deleteMany({
    where: {
      OR: [
        { id: { startsWith: QA } },
        { name: { startsWith: QA } },
      ],
    },
  });
  await prisma.conversation.deleteMany({ where: { id: { startsWith: QA } } });
  await prisma.chatMessage.deleteMany({ where: { id: { startsWith: QA } } });
}

beforeAll(async () => {
  await waitForApi();
  await cleanup();
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe('Privacy — trace PII redaction', () => {
  it('redacts phone/email/ID in trace input/output and keeps order numbers', async () => {
    const conversationId = `${QA}conv_pii`;
    await prisma.conversation.create({
      data: {
        id: conversationId,
        type: 'SUPPORT',
        name: `${QA}conv_pii`,
        status: 1,
      },
    });

    const args: unknown[] = new Array(21).fill(null);
    args[3] = prisma; // prismaService
    const service = new (AiCustomerService as any)(...args, traceService);

    const piiInput =
      '联系电话 13812341234，邮箱 user@example.com，身份证 110101199001011234，订单号 202611210001';
    const piiOutput =
      '已登记：13812341234 / user@example.com / 110101199001011234 / 订单 202611210001';

    await (service as any).recordReplyTrace({
      message: piiInput,
      userId: `${QA}user_pii`,
      conversationId,
      triggerMessageId: `${QA}trigger_pii`,
      startedAt: Date.now(),
      status: 'SUCCESS',
      finalState: { values: { intent: 'general' } },
      newMessages: [{ content: piiOutput }],
      ragSources: [],
      streamUsage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    });

    const trace = await prisma.aiTrace.findFirst({
      where: { conversationId },
      orderBy: { createdAt: 'desc' },
      include: { spans: true },
    });
    expect(trace).toBeTruthy();

    for (const text of [trace?.input ?? '', trace?.output ?? '']) {
      expect(text).toContain('138****1234');
      expect(text).toContain('u***@example.com');
      expect(text).toContain('1101**********1234');
      expect(text).toContain('202611210001');
      expect(text).not.toContain('13812341234');
      expect(text).not.toContain('user@example.com');
      expect(text).not.toContain('110101199001011234');
    }

    // Span snippets must not retain raw PII either.
    const spanText = JSON.stringify(trace?.spans ?? []);
    expect(spanText).not.toContain('13812341234');
    expect(spanText).not.toContain('user@example.com');
    expect(spanText).not.toContain('110101199001011234');
  });
});

describe('Privacy — trace retention', () => {
  it('purges >30d traces/spans/LLM scores but keeps HUMAN scores and new traces', async () => {
    const oldDate = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);

    await prisma.aiTrace.create({
      data: {
        id: `${QA}trace_old`,
        conversationId: `${QA}conv_old`,
        source: 'qa',
        input: 'old',
        status: 'SUCCESS',
        createdAt: oldDate,
        spans: {
          create: [
            {
              id: `${QA}span_old`,
              type: 'llm',
              name: 'old-span',
              status: 'OK',
              startedAt: oldDate,
            },
          ],
        },
      },
    });
    await prisma.aiScore.create({
      data: {
        id: `${QA}score_old_llm`,
        traceId: `${QA}trace_old`,
        source: 'LLM',
        value: 0.5,
        createdAt: oldDate,
      },
    });
    await prisma.aiScore.create({
      data: {
        id: `${QA}score_old_human`,
        traceId: `${QA}trace_old`,
        source: 'HUMAN',
        value: 1,
        createdAt: oldDate,
      },
    });
    await prisma.aiTrace.create({
      data: {
        id: `${QA}trace_new`,
        conversationId: `${QA}conv_new`,
        source: 'qa',
        input: 'new',
        status: 'SUCCESS',
      },
    });

    await traceService.purgeExpired();

    expect(await prisma.aiTrace.findUnique({ where: { id: `${QA}trace_old` } }))
      .toBeNull();
    expect(await prisma.aiSpan.findUnique({ where: { id: `${QA}span_old` } }))
      .toBeNull();
    expect(
      await prisma.aiScore.findUnique({ where: { id: `${QA}score_old_llm` } }),
    ).toBeNull();
    expect(
      await prisma.aiScore.findUnique({
        where: { id: `${QA}score_old_human` },
      }),
    ).toBeTruthy();
    expect(
      await prisma.aiTrace.findUnique({ where: { id: `${QA}trace_new` } }),
    ).toBeTruthy();
  });
});

describe('Privacy — eval reads', () => {
  const datasetId = `${QA}eval_dataset`;
  const caseId = `${QA}eval_case`;
  const runId = `${QA}eval_run`;
  const resultId = `${QA}eval_result`;

  beforeAll(async () => {
    await prisma.aiEvalDataset.create({
      data: {
        id: datasetId,
        name: `${QA}eval_dataset`,
        description: 'qa privacy',
      },
    });
    await prisma.aiEvalCase.create({
      data: {
        id: caseId,
        datasetId,
        question: 'qa_pr_secret_question',
        answer: 'qa_pr_secret_answer',
        expect: { mustMention: ['qa_pr_secret_expect'] },
        expected: 'qa_pr_secret_expected',
        tags: [],
      },
    });
    await prisma.aiEvalRun.create({
      data: {
        id: runId,
        datasetId,
        status: 'COMPLETED',
        mode: 'STORED',
        startedAt: new Date(),
        finishedAt: new Date(),
        summary: { mode: 'STORED', total: 1, solved: 0, unsolved: 1 },
      },
    });
    await prisma.aiEvalResult.create({
      data: {
        id: resultId,
        runId,
        caseId,
        verdict: 'unsolved',
        score: 0,
        reason: 'qa_pr_secret_reason',
        actualAnswer: 'qa_pr_secret_actual',
      },
    });
  });

  it('VIEWER dataset detail has null question/answer/expected/expect', async () => {
    const res = await api(
      'GET',
      `/v1/admin/ai-eval/datasets/${datasetId}`,
      'VIEWER',
    );
    expect(res.status).toBe(200);
    const item = res.data.cases.find((c: any) => c.id === caseId);
    expect(item).toBeTruthy();
    expect(item.question).toBeNull();
    expect(item.answer).toBeNull();
    expect(item.expected).toBeNull();
    expect(item.expect).toBeNull();
  });

  it('ADMIN dataset detail keeps raw values', async () => {
    const res = await api(
      'GET',
      `/v1/admin/ai-eval/datasets/${datasetId}`,
      'ADMIN',
    );
    const item = res.data.cases.find((c: any) => c.id === caseId);
    expect(item.question).toBe('qa_pr_secret_question');
    expect(item.answer).toBe('qa_pr_secret_answer');
    expect(item.expected).toBe('qa_pr_secret_expected');
    expect(item.expect).toEqual({ mustMention: ['qa_pr_secret_expect'] });
  });

  it('VIEWER run detail redacts actualAnswer/reason and result case fields', async () => {
    const res = await api('GET', `/v1/admin/ai-eval/runs/${runId}`, 'VIEWER');
    expect(res.status).toBe(200);
    const result = res.data.results.find((r: any) => r.id === resultId);
    expect(result).toBeTruthy();
    expect(result.actualAnswer).toBeNull();
    expect(result.reason).toBeNull();
    expect(result.case.question).toBeNull();
    expect(result.case.answer).toBeNull();
    expect(result.case.expected).toBeNull();
    expect(result.case.expect).toBeNull();
  });

  it('ADMIN run detail keeps raw values', async () => {
    const res = await api('GET', `/v1/admin/ai-eval/runs/${runId}`, 'ADMIN');
    const result = res.data.results.find((r: any) => r.id === resultId);
    expect(result.actualAnswer).toBe('qa_pr_secret_actual');
    expect(result.reason).toBe('qa_pr_secret_reason');
    expect(result.case.question).toBe('qa_pr_secret_question');
    expect(result.case.answer).toBe('qa_pr_secret_answer');
    expect(result.case.expected).toBe('qa_pr_secret_expected');
    expect(result.case.expect).toEqual({ mustMention: ['qa_pr_secret_expect'] });
  });

  it('VIEWER and EDITOR remain denied from judge', async () => {
    for (const role of ['VIEWER', 'EDITOR'] as const) {
      const res = await api('POST', '/v1/admin/ai-eval/judge', role, {
        question: 'q',
        answer: 'a',
        expectTask: {},
      });
      expect(res.status).toBe(403);
    }
  });
});
