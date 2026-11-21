/**
 * Batch 5 QA seed — one deterministic UTC day for 119 Phase 1 analysis.
 *
 * Expected (with the default date):
 *   traces = 4, conversations = 2
 *   events = 8:
 *     EXPLICIT_NEGATIVE 1
 *     SERVICE_ERROR 2 (feedback SERVICE_ERROR + trace ERROR)
 *     REPEATED_QUESTION 1
 *     USER_ABANDONED 1
 *     ZERO_HIT 1
 *     EVAL_UNSOLVED 1
 *     SECURITY_HIT 1
 *   metrics:
 *     problem_rate ALL = 8/4 = 2.0
 *     service_error_rate ALL = 2/4 = 0.5
 *     zero_hit_rate ALL = 1/4 = 0.25
 *     explicit_negative_rate ALL = 1/4 = 0.25
 *     repeat_rate ALL = 1/2 = 0.5
 *     problem_rate INTENT order = 1/2 = 0.5
 *     problem_rate INTENT rag   = 1/2 = 0.5
 *
 * Run:
 *   DATABASE_URL=... npx tsx qa/seed/batch5.ts
 *   DATABASE_URL=... npx tsx qa/seed/batch5.ts --clean
 */
import { PrismaClient } from '@prisma/client';
import * as fs from 'node:fs';
import * as path from 'node:path';

const prisma = new PrismaClient();
const QA = 'qa_b5_';

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

const QA_ENV = readEnvFile();
const DATE = process.env.QA_BATCH5_DATE || QA_ENV.QA_BATCH5_DATE || '2026-11-18';
const start = new Date(`${DATE}T00:00:00.000Z`);
const at = (hour: number, minute = 0) =>
  new Date(start.getTime() + hour * 3600_000 + minute * 60_000);

async function clean() {
  await prisma.aiProblemEvent.deleteMany({
    where: {
      OR: [
        { sourceId: { startsWith: QA } },
        { id: { startsWith: QA } },
      ],
    },
  });
  await prisma.aiMetricWindow.deleteMany({
    where: { windowStart: start },
  });
  await prisma.aiAnalysisRun.deleteMany({
    where: { windowStart: start },
  });
  // Phase 2 added clusters/alerts; keep the Batch 5 window isolated.
  const batch5Clusters = await prisma.aiProblemCluster.findMany({
    where: { representativeText: { contains: QA } },
    select: { id: true },
  });
  await prisma.aiProblemClusterDay.deleteMany({
    where: { clusterId: { in: batch5Clusters.map((row) => row.id) } },
  });
  await prisma.aiProblemCluster.deleteMany({
    where: { id: { in: batch5Clusters.map((row) => row.id) } },
  });
  await prisma.aiAnalysisAlert.deleteMany({
    where: { windowStart: start },
  });
  await prisma.aiEvalDataset.deleteMany({
    where: {
      OR: [
        { id: { startsWith: QA } },
        { name: { startsWith: QA } },
      ],
    },
  });
  await prisma.aiSecurityEvent.deleteMany({
    where: { id: { startsWith: QA } },
  });
  await prisma.aiSpan.deleteMany({
    where: { traceId: { startsWith: QA } },
  });
  await prisma.aiTrace.deleteMany({ where: { id: { startsWith: QA } } });
  await prisma.aiAnswerFeedback.deleteMany({
    where: { id: { startsWith: QA } },
  });
  await prisma.conversation.deleteMany({ where: { id: { startsWith: QA } } });
}

async function seed() {
  // Two conversations created inside the window (repeat_rate denominator).
  for (const n of [1, 2]) {
    await prisma.conversation.create({
      data: {
        id: `${QA}conv_${n}`,
        type: 'SUPPORT',
        name: `${QA}conv_${n}_name`,
        status: 1,
        lastMsgContent: `${QA}secret_last_message`,
        lastMsgTime: at(9),
        lastMsgSeqId: 1,
        createdAt: at(9),
      },
    });
  }

  const feedback = [
    {
      id: `${QA}fb_negative`,
      conversationId: `${QA}conv_1`,
      source: 'explicit',
      verdict: 'incorrect',
      errorType: 'irrelevant',
      failureKind: 'MODEL_ERROR',
      resolution: 'OPEN',
      reviewStatus: 'PENDING',
      input: `${QA}secret_feedback_input`,
      note: `${QA}secret_feedback_note`,
      createdAt: at(10, 0),
    },
    {
      id: `${QA}fb_service`,
      conversationId: `${QA}conv_1`,
      source: 'implicit',
      signal: 'transferred',
      failureKind: 'SERVICE_ERROR',
      resolution: 'OPEN',
      reviewStatus: 'PENDING',
      createdAt: at(10, 5),
    },
    {
      id: `${QA}fb_repeat`,
      conversationId: `${QA}conv_2`,
      source: 'implicit',
      signal: 'repeated_question',
      failureKind: 'REPEATED_QUESTION',
      resolution: 'OPEN',
      reviewStatus: 'PENDING',
      createdAt: at(10, 10),
    },
    {
      id: `${QA}fb_abandoned`,
      conversationId: `${QA}conv_2`,
      source: 'implicit',
      signal: 'abandoned',
      failureKind: 'USER_ABANDONED',
      resolution: 'OPEN',
      reviewStatus: 'PENDING',
      createdAt: at(10, 15),
    },
  ];
  await prisma.aiAnswerFeedback.createMany({ data: feedback });

  // 4 traces (replies denominator): ERROR, ZERO_HIT, and two normal.
  await prisma.aiTrace.create({
    data: {
      id: `${QA}trace_error`,
      conversationId: `${QA}conv_1`,
      source: 'qa',
      intent: 'order',
      input: `${QA}secret_trace_input_error`,
      output: `${QA}secret_trace_output_error`,
      status: 'ERROR',
      createdAt: at(11, 0),
    },
  });
  await prisma.aiTrace.create({
    data: {
      id: `${QA}trace_zero`,
      conversationId: `${QA}conv_1`,
      source: 'qa',
      intent: 'rag',
      input: `${QA}secret_trace_input_zero`,
      output: `${QA}secret_trace_output_zero`,
      status: 'SUCCESS',
      createdAt: at(11, 10),
      spans: {
        create: [
          {
            id: `${QA}span_zero`,
            type: 'rag',
            name: 'rag-retrieval',
            status: 'OK',
            output: { sourceCount: 0 },
            startedAt: at(11, 10),
          },
        ],
      },
    },
  });
  await prisma.aiTrace.create({
    data: {
      id: `${QA}trace_ok1`,
      conversationId: `${QA}conv_2`,
      source: 'qa',
      intent: 'order',
      status: 'SUCCESS',
      createdAt: at(11, 20),
      spans: {
        create: [
          {
            id: `${QA}span_ok1`,
            type: 'rag',
            name: 'rag-retrieval',
            status: 'OK',
            output: { sourceCount: 2 },
            startedAt: at(11, 20),
          },
        ],
      },
    },
  });
  await prisma.aiTrace.create({
    data: {
      id: `${QA}trace_ok2`,
      conversationId: `${QA}conv_2`,
      source: 'qa',
      intent: 'rag',
      status: 'SUCCESS',
      createdAt: at(11, 30),
      spans: {
        create: [
          {
            id: `${QA}span_ok2`,
            type: 'rag',
            name: 'rag-retrieval',
            status: 'OK',
            output: { sourceCount: 3 },
            startedAt: at(11, 30),
          },
        ],
      },
    },
  });

  // Eval unsolved with an expectation -> EVAL_UNSOLVED.
  await prisma.aiEvalDataset.create({
    data: {
      id: `${QA}dataset`,
      name: `${QA}dataset`,
      description: 'qa batch5',
      createdBy: 'qa_admin_admin',
    },
  });
  await prisma.aiEvalCase.create({
    data: {
      id: `${QA}case`,
      datasetId: `${QA}dataset`,
      question: `${QA}eval_question`,
      answer: `${QA}eval_answer`,
      expect: { mustMention: ['7 days'] },
      expected: `${QA}eval_expected`,
      source: 'manual',
      tags: [],
    },
  });
  await prisma.aiEvalRun.create({
    data: {
      id: `${QA}eval_run`,
      datasetId: `${QA}dataset`,
      status: 'COMPLETED',
      mode: 'STORED',
      startedAt: at(12, 0),
      finishedAt: at(12, 1),
      summary: { mode: 'STORED', total: 1, solved: 0, unsolved: 1 },
    },
  });
  await prisma.aiEvalResult.create({
    data: {
      id: `${QA}eval_result`,
      runId: `${QA}eval_run`,
      caseId: `${QA}case`,
      verdict: 'unsolved',
      score: 0,
      reason: `${QA}secret_eval_reason`,
      createdAt: at(12, 1),
    },
  });

  // Security NEW -> SECURITY_HIT.
  await prisma.aiSecurityEvent.create({
    data: {
      id: `${QA}security`,
      type: 'prompt_override',
      mode: 'log',
      length: 42,
      status: 'NEW',
      createdAt: at(13, 0),
    },
  });

  const counts = {
    date: DATE,
    traces: await prisma.aiTrace.count({
      where: {
        conversationId: { startsWith: QA },
        createdAt: { gte: start, lt: new Date(start.getTime() + 86_400_000) },
      },
    }),
    conversations: await prisma.conversation.count({
      where: {
        id: { startsWith: QA },
        createdAt: { gte: start, lt: new Date(start.getTime() + 86_400_000) },
      },
    }),
    feedback: await prisma.aiAnswerFeedback.count({
      where: { id: { startsWith: QA } },
    }),
    evalResults: await prisma.aiEvalResult.count({
      where: { id: { startsWith: QA } },
    }),
    security: await prisma.aiSecurityEvent.count({
      where: { id: { startsWith: QA } },
    }),
  };
  console.log('[qa-seed-b5] done', counts);
}

async function main() {
  const cleanOnly = process.argv.includes('--clean');
  await clean();
  if (cleanOnly) {
    console.log('[qa-seed-b5] cleaned qa_b5_* and analysis window rows');
    return;
  }
  await seed();
}

main()
  .catch((err) => {
    console.error('[qa-seed-b5] failed', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
