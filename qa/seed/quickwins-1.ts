/**
 * Quick Wins 1 QA seed.
 *
 * Creates:
 *   - 2 extra SUPPORT conversations waiting for a human (plus the batch1 one).
 *   - 10 knowledge documents via the real API:
 *       good_table_1/2, good_list_1/2, good_emoji_1 -> score 100, no flags
 *       flagged_1..5 -> score 75, flags "truncation" (no sentence punctuation)
 *
 * Expected quality-stats: total=10, flagged=5, needReview=5,
 * byScore={excellent:5, good:5, fair:0, suspicious:0}.
 *
 * Run after the QA API is up:
 *   DATABASE_URL=... npx tsx qa/seed/quickwins-1.ts
 *   DATABASE_URL=... npx tsx qa/seed/quickwins-1.ts --clean
 */
import { PrismaClient } from '@prisma/client';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as jwt from 'jsonwebtoken';

const prisma = new PrismaClient();
const PREFIX = 'qa_qw2_';

function readEnvFile(): Record<string, string> {
  const env: Record<string, string> = {};
  try {
    const raw = fs.readFileSync(path.resolve(__dirname, '../.env.qa'), 'utf8');
    for (const line of String(raw).split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
    }
  } catch {
    // ignore
  }
  return env;
}

const ENV = readEnvFile();
const API_BASE = (ENV.QA_API_URL ?? 'http://127.0.0.1:4102/api').replace(
  /\/$/,
  '',
);
const TOKEN = jwt.sign(
  { sub: 'qa_admin_admin', role: 'ADMIN', type: 'admin', username: 'qa_admin' },
  ENV.ADMIN_JWT_SECRET ?? 'qa_admin_jwt_secret_change_me_0123456789',
  { expiresIn: '1h' },
);

async function clean() {
  const docs = await prisma.knowledgeDocument.findMany({
    where: { docId: { startsWith: PREFIX } },
    select: { id: true },
  });
  if (docs.length > 0) {
    await prisma.documentChunk.deleteMany({
      where: { documentId: { in: docs.map((d) => d.id) } },
    });
  }
  await prisma.knowledgeDocument.deleteMany({
    where: { docId: { startsWith: PREFIX } },
  });
  await prisma.conversation.deleteMany({ where: { id: { startsWith: PREFIX } } });
}

async function createDoc(input: {
  docId: string;
  title: string;
  content: string;
}): Promise<{ qualityScore: number | null; qualityFlags: string | null }> {
  const res = await fetch(`${API_BASE}/v1/admin/rag/documents`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      title: input.title,
      domain: 'common',
      docId: input.docId,
      keywords: [],
      content: input.content,
    }),
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(
      `create doc ${input.docId} failed: ${res.status} ${json.message}`,
    );
  }
  return {
    qualityScore: json.data.qualityScore,
    qualityFlags: json.data.qualityFlags,
  };
}

const BASE =
  '这是用于知识质量检查的说明文档，介绍退款、订单与客服流程。'.repeat(8);

const GOOD = [
  {
    docId: `${PREFIX}good_table_1`,
    title: '退款政策表',
    content: `${BASE}\n\n| 项目 | 说明 |\n| --- | --- |\n| 退款 | 7 天 |`,
  },
  {
    docId: `${PREFIX}good_table_2`,
    title: '配送时效表',
    content: `${BASE}\n\n| 地区 | 时效 |\n| --- | --- |\n| 市区 | 1 天 |`,
  },
  {
    docId: `${PREFIX}good_list_1`,
    title: '退款步骤',
    content: `${BASE}\n\n- 第一步：提交退款申请`,
  },
  {
    docId: `${PREFIX}good_list_2`,
    title: '客服步骤',
    content: `${BASE}\n\n- 第二步：等待客服审核`,
  },
  {
    docId: `${PREFIX}good_emoji_1`,
    title: '联系客服',
    content: `${BASE}\n\n如有疑问请联系客服。😊`,
  },
];

const FLAGGED = Array.from({ length: 5 }, (_, i) => ({
  docId: `${PREFIX}flagged_${i + 1}`,
  title: `截断示例 ${i + 1}`,
  // Last line deliberately has no sentence-ending punctuation.
  content: `${BASE}\n\n这一段故意不写任何结尾标点所以应当被判定为可能截断`,
}));

async function seed() {
  // Two additional waiting conversations (batch1 has one -> 3 total).
  for (const n of [1, 2]) {
    await prisma.conversation.create({
      data: {
        id: `${PREFIX}sla_${n}`,
        type: 'SUPPORT',
        name: `${PREFIX}sla_${n}`,
        status: 1,
        handlerId: 'awaiting_human',
        transferredAt: new Date(Date.now() - 10 * 60 * 1000),
      },
    });
  }

  const results: Array<{
    kind: 'good' | 'flagged';
    docId: string;
    score: number | null;
    flags: string | null;
  }> = [];
  for (const doc of GOOD) {
    const r = await createDoc(doc);
    results.push({ kind: 'good', docId: doc.docId, ...r });
  }
  for (const doc of FLAGGED) {
    const r = await createDoc(doc);
    results.push({ kind: 'flagged', docId: doc.docId, ...r });
  }

  console.log('[qa-seed-qw1] done');
  console.table(results);
  console.log(
    'expected quality-stats: total=10 flagged=5 needReview=5 (excellent=5 good=5)',
  );
}

async function main() {
  const cleanOnly = process.argv.includes('--clean');
  await clean();
  if (cleanOnly) {
    console.log('[qa-seed-qw1] cleaned qa_qw2_* docs/conversations');
    return;
  }
  await seed();
}

main()
  .catch((err) => {
    console.error('[qa-seed-qw1] failed', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
