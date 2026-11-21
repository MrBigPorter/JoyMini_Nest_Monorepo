/**
 * Quick Wins 1 — SLA snapshot minute bucket + RAG quality signals.
 *
 * Seed prerequisite (run after the QA API is up):
 *   DATABASE_URL=... npx tsx qa/seed/quickwins-1.ts
 *
 * Expected RAG stats: total=10, flagged=5, needReview=5,
 * byScore={excellent:5, good:5, fair:0, suspicious:0}.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as jwt from 'jsonwebtoken';
import { PrismaService } from '@api/common/prisma/prisma.service';
import { SupportSlaService } from '@api/admin/chat/support-sla.service';

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
const TOKEN = jwt.sign(
  { sub: 'qa_admin_admin', role: 'ADMIN', type: 'admin', username: 'qa_admin' },
  ENV.ADMIN_JWT_SECRET ?? 'qa_admin_jwt_secret_change_me_0123456789',
  { expiresIn: '1h' },
);
const PREFIX = 'qa_qw2_';

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
      Authorization: `Bearer ${TOKEN}`,
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

function slaService(): SupportSlaService {
  const config = {
    get: (key: string, def?: unknown) =>
      key === 'SUPPORT_SLA_MINUTES' ? '5' : def,
  } as never;
  return new SupportSlaService(prisma, config);
}

const WAITING_WHERE = {
  type: 'SUPPORT' as const,
  handlerId: 'awaiting_human',
  status: 1,
};

async function cleanPatchDoc() {
  await prisma.knowledgeDocument.deleteMany({
    where: { docId: 'qa_qw2_patch_doc' },
  });
}

beforeAll(async () => {
  await waitForApi();
  await cleanPatchDoc();
  await prisma.conversation.updateMany({
    where: { id: `${PREFIX}sla_1` },
    data: { handlerId: 'awaiting_human' },
  });
  const docs = await prisma.knowledgeDocument.count({
    where: { docId: { startsWith: PREFIX } },
  });
  const slas = await prisma.conversation.count({
    where: { id: { startsWith: `${PREFIX}sla_` } },
  });
  if (docs < 10 || slas < 2) {
    throw new Error(
      'Quick Wins seed missing; run: npx tsx qa/seed/quickwins-1.ts',
    );
  }
});

afterAll(async () => {
  await prisma.conversation.updateMany({
    where: { id: `${PREFIX}sla_1` },
    data: { handlerId: 'awaiting_human' },
  });
  await cleanPatchDoc();
  await prisma.$disconnect();
});

describe('Quick Wins 1 — SLA snapshot bucket', () => {
  it('two same-minute checkQueue calls collapse to one row and update the count', async () => {
    // Stay away from a minute boundary so both calls share one bucket.
    while (new Date().getSeconds() >= 50) {
      await new Promise((r) => setTimeout(r, 1000));
    }

    const service = slaService();
    const before = await prisma.conversation.count({ where: WAITING_WHERE });

    await service.checkQueue();
    const minute = new Date(Math.floor(Date.now() / 60_000) * 60_000);
    let rows = await prisma.supportSlaSnapshot.findMany({
      where: { bucket: minute },
    });
    expect(rows.length).toBe(1);
    expect(rows[0].waiting).toBe(before);

    // Claim one seeded waiting conversation; the second call updates the row.
    await prisma.conversation.update({
      where: { id: `${PREFIX}sla_1` },
      data: { handlerId: 'qa_admin' },
    });
    await service.checkQueue();

    rows = await prisma.supportSlaSnapshot.findMany({
      where: { bucket: minute },
    });
    expect(rows.length).toBe(1);
    expect(rows[0].waiting).toBe(before - 1);

    await prisma.conversation.update({
      where: { id: `${PREFIX}sla_1` },
      data: { handlerId: 'awaiting_human' },
    });
    await prisma.supportSlaSnapshot.deleteMany({ where: { bucket: minute } });
  }, 90_000);

  it('rejects two direct inserts with the same bucket', async () => {
    const bucket = new Date('2030-01-01T00:00:00.000Z');
    await prisma.supportSlaSnapshot.deleteMany({ where: { bucket } });
    await prisma.supportSlaSnapshot.create({
      data: { bucket, waiting: 1, breached: 0, longestWait: 0 },
    });

    await expect(
      prisma.supportSlaSnapshot.create({
        data: { bucket, waiting: 2, breached: 0, longestWait: 0 },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });

    await prisma.supportSlaSnapshot.deleteMany({ where: { bucket } });
  });
});

describe('Quick Wins 1 — knowledge quality', () => {
  it('table/list/emoji docs score 100 and truncation stays for real truncation', async () => {
    const stats = await api(
      'GET',
      '/v1/admin/rag/documents/quality-stats',
    );
    expect(stats.status).toBe(200);
    expect(stats.data).toMatchObject({
      total: 10,
      flagged: 5,
      byScore: { excellent: 5, good: 5, fair: 0, suspicious: 0 },
    });
    expect(stats.data.needReview).toBeGreaterThanOrEqual(
      stats.data.flagged,
    );
    expect(stats.data.needReview).toBeGreaterThan(0);
    expect(stats.data.recentFlags.length).toBe(5);

    const good = await prisma.knowledgeDocument.findMany({
      where: { docId: { startsWith: `${PREFIX}good_` } },
      select: { docId: true, qualityScore: true, qualityFlags: true },
    });
    expect(good.length).toBe(5);
    for (const doc of good) {
      expect(doc.qualityScore).toBe(100);
      expect(doc.qualityFlags).toBeNull();
    }

    const flagged = await prisma.knowledgeDocument.findMany({
      where: { docId: { startsWith: `${PREFIX}flagged_` } },
      select: { docId: true, qualityScore: true, qualityFlags: true },
    });
    expect(flagged.length).toBe(5);
    for (const doc of flagged) {
      expect(doc.qualityScore).toBe(75);
      expect(doc.qualityFlags).toContain('truncation');
    }
  });

  it('PATCH content recomputes quality_score/quality_flags', async () => {
    const goodContent = `${'这是用于知识质量检查的说明文档，介绍退款、订单与客服流程。'.repeat(
      8,
    )}\n\n| 项目 | 说明 |\n| --- | --- |\n| 退款 | 7 天 |`;
    const truncatedContent = `${'这是用于知识质量检查的说明文档，介绍退款、订单与客服流程。'.repeat(
      8,
    )}\n\n这一段故意不写任何结尾标点所以应当被判定为可能截断`;

    const created = await api('POST', '/v1/admin/rag/documents', {
      title: 'QA patch doc',
      domain: 'common',
      docId: 'qa_qw2_patch_doc',
      keywords: [],
      content: goodContent,
    });
    expect(created.status).toBe(201);
    expect(created.data.qualityScore).toBe(100);
    expect(created.data.qualityFlags).toBeNull();
    const id = created.data.id as string;

    const before = await api('GET', '/v1/admin/rag/documents/quality-stats');
    expect(before.data.flagged).toBe(5);
    expect(before.data.total).toBe(11);

    const patched = await api('PATCH', `/v1/admin/rag/documents/${id}`, {
      content: truncatedContent,
    });
    expect(patched.status).toBe(200);
    expect(patched.data.qualityScore).toBe(75);
    expect(patched.data.qualityFlags).toContain('truncation');

    const afterBad = await api('GET', '/v1/admin/rag/documents/quality-stats');
    expect(afterBad.data.flagged).toBe(6);
    expect(afterBad.data.needReview).toBeGreaterThanOrEqual(6);

    const restored = await api('PATCH', `/v1/admin/rag/documents/${id}`, {
      content: goodContent,
    });
    expect(restored.data.qualityScore).toBe(100);
    expect(restored.data.qualityFlags).toBeNull();

    const afterRestore = await api(
      'GET',
      '/v1/admin/rag/documents/quality-stats',
    );
    expect(afterRestore.data.flagged).toBe(5);

    const deleted = await api('DELETE', `/v1/admin/rag/documents/${id}`);
    expect(deleted.status).toBe(200);
    const afterDelete = await api(
      'GET',
      '/v1/admin/rag/documents/quality-stats',
    );
    expect(afterDelete.data.total).toBe(10);
    await cleanPatchDoc();
  }, 60_000);
});
