/**
 * Batch 2 QA seed — deterministic `qa_b2_*` rows on top of batch1.
 *
 * Run:
 *   DATABASE_URL=postgresql://.../joy_mini_qa npx tsx qa/seed/batch2.ts
 *   npx tsx qa/seed/batch2.ts --clean    # remove qa_b2_* only
 *
 * Data contract (on top of qa/seed/batch1.ts):
 *   - C/A/B: explicit incorrect, newest first → review-order tests.
 *   - service: implicit ai_error → SERVICE_ERROR (TODO).
 *   - transferred/repeated/abandoned: implicit signals (SIGNAL queue).
 *   - expected: implicit explicit_request → EXPECTED_TRANSFER/EXCLUDED.
 *   - correct: explicit correct → NO_ISSUE/REVIEWED.
 *   - yesterday_*: actionable rows dated yesterday UTC → today-window tests.
 *   - security today + yesterday → today security counts.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const QA = 'qa_b2_';

async function clean() {
  await prisma.aiScore.deleteMany({
    where: { conversationId: { startsWith: QA } },
  });
  await prisma.aiAnswerFeedback.deleteMany({
    where: {
      OR: [
        { id: { startsWith: QA } },
        { conversationId: { startsWith: QA } },
      ],
    },
  });
  await prisma.chatMessage.deleteMany({ where: { id: { startsWith: QA } } });
  await prisma.conversation.deleteMany({ where: { id: { startsWith: QA } } });
  await prisma.aiSecurityEvent.deleteMany({
    where: { id: { startsWith: QA } },
  });
}

interface MsgSeed {
  convId: string;
  key: string;
  question: string;
  answer: string;
  createdAt: Date;
}

async function seedConversationWithMessages(m: MsgSeed) {
  await prisma.conversation.create({
    data: {
      id: m.convId,
      type: 'SUPPORT',
      name: `${m.convId}_name`,
      status: 1,
      lastMsgContent: m.answer,
      lastMsgTime: m.createdAt,
      lastMsgSeqId: 2,
    },
  });
  await prisma.chatMessage.createMany({
    data: [
      {
        id: `${QA}msg_${m.key}_user`,
        conversationId: m.convId,
        type: 0,
        content: m.question,
        seqId: 1,
        role: 'user',
        source: 'user',
        createdAt: new Date(m.createdAt.getTime() - 60_000),
      },
      {
        id: `${QA}msg_${m.key}_ai`,
        conversationId: m.convId,
        type: 0,
        content: m.answer,
        seqId: 2,
        role: 'assistant',
        source: 'ai',
        createdAt: m.createdAt,
      },
    ],
  });
}

async function seed() {
  const now = new Date();
  const at = (secondsAgo: number) =>
    new Date(now.getTime() - secondsAgo * 1000);
  const yesterdayNoon = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() - 1,
      12,
      0,
      0,
    ),
  );
  const yesterdayAfternoon = new Date(yesterdayNoon.getTime() + 60 * 60 * 1000);

  // Newest first: C, then A, then B. The review panel consumes candidates in
  // createdAt-desc order, so this order drives the one-at-a-time test.
  await seedConversationWithMessages({
    convId: `${QA}conv_c`,
    key: 'c',
    question: 'qa_b2_C_question',
    answer: 'qa_b2_C_answer',
    createdAt: at(0),
  });
  await seedConversationWithMessages({
    convId: `${QA}conv_a`,
    key: 'a',
    question: 'qa_b2_A_question',
    answer: 'qa_b2_A_answer',
    createdAt: at(1),
  });
  await seedConversationWithMessages({
    convId: `${QA}conv_b`,
    key: 'b',
    question: 'qa_b2_B_question',
    answer: 'qa_b2_B_answer',
    createdAt: at(2),
  });

  const feedback = [
    // Review targets (explicit incorrect, TODO + PENDING).
    {
      id: `${QA}fb_c`,
      conversationId: `${QA}conv_c`,
      messageId: `${QA}msg_c_ai`,
      source: 'explicit',
      verdict: 'incorrect',
      errorType: 'irrelevant',
      failureKind: 'MODEL_ERROR',
      resolution: 'OPEN',
      reviewStatus: 'PENDING',
      createdAt: at(0),
    },
    {
      id: `${QA}fb_a`,
      conversationId: `${QA}conv_a`,
      messageId: `${QA}msg_a_ai`,
      source: 'explicit',
      verdict: 'incorrect',
      errorType: 'irrelevant',
      failureKind: 'MODEL_ERROR',
      resolution: 'OPEN',
      reviewStatus: 'PENDING',
      createdAt: at(1),
    },
    {
      id: `${QA}fb_b`,
      conversationId: `${QA}conv_b`,
      messageId: `${QA}msg_b_ai`,
      source: 'explicit',
      verdict: 'incorrect',
      errorType: 'irrelevant',
      failureKind: 'MODEL_ERROR',
      resolution: 'OPEN',
      reviewStatus: 'PENDING',
      createdAt: at(2),
    },
    // ai_error transfer → SERVICE_ERROR, actionable (TODO).
    {
      id: `${QA}fb_service`,
      conversationId: `${QA}conv_service`,
      source: 'implicit',
      signal: 'transferred',
      metadata: { reason: 'ai_error' },
      failureKind: 'SERVICE_ERROR',
      resolution: 'OPEN',
      reviewStatus: 'PENDING',
      createdAt: at(3),
    },
    // Implicit signals (SIGNAL, not TODO).
    {
      id: `${QA}fb_transferred`,
      conversationId: `${QA}conv_transferred`,
      source: 'implicit',
      signal: 'transferred',
      metadata: { reason: 'customer_request' },
      failureKind: 'UNKNOWN',
      resolution: 'OPEN',
      reviewStatus: 'PENDING',
      createdAt: at(4),
    },
    {
      id: `${QA}fb_repeated`,
      conversationId: `${QA}conv_repeated`,
      source: 'implicit',
      signal: 'repeated_question',
      failureKind: 'REPEATED_QUESTION',
      resolution: 'OPEN',
      reviewStatus: 'PENDING',
      createdAt: at(5),
    },
    {
      id: `${QA}fb_abandoned`,
      conversationId: `${QA}conv_abandoned`,
      source: 'implicit',
      signal: 'abandoned',
      failureKind: 'USER_ABANDONED',
      resolution: 'OPEN',
      reviewStatus: 'PENDING',
      createdAt: at(6),
    },
    // explicit_request → EXPECTED_TRANSFER / EXCLUDED (not SIGNAL, not TODO).
    {
      id: `${QA}fb_expected`,
      conversationId: `${QA}conv_expected`,
      source: 'implicit',
      signal: 'transferred',
      metadata: { reason: 'explicit_request' },
      failureKind: 'EXPECTED_TRANSFER',
      resolution: 'EXCLUDED',
      reviewStatus: 'IGNORED',
      createdAt: at(7),
    },
    // Correct → NO_ISSUE / REVIEWED (not TODO, not SIGNAL).
    {
      id: `${QA}fb_correct`,
      conversationId: `${QA}conv_correct`,
      source: 'explicit',
      verdict: 'correct',
      failureKind: null,
      resolution: 'NO_ISSUE',
      reviewStatus: 'REVIEWED',
      createdAt: at(8),
    },
    // Yesterday rows: must not appear in today's overview counts.
    {
      id: `${QA}fb_yesterday`,
      conversationId: `${QA}conv_yesterday`,
      source: 'explicit',
      verdict: 'incorrect',
      errorType: 'irrelevant',
      failureKind: 'MODEL_ERROR',
      resolution: 'OPEN',
      reviewStatus: 'PENDING',
      createdAt: yesterdayNoon,
    },
    {
      id: `${QA}fb_yesterday_service`,
      conversationId: `${QA}conv_yesterday_service`,
      source: 'implicit',
      signal: 'transferred',
      metadata: { reason: 'ai_error' },
      failureKind: 'SERVICE_ERROR',
      resolution: 'OPEN',
      reviewStatus: 'PENDING',
      createdAt: yesterdayAfternoon,
    },
  ];

  await prisma.aiAnswerFeedback.createMany({
    data: feedback.map((row) => ({
      ...row,
      metadata: (row.metadata ?? undefined) as never,
    })),
  });

  // One NEW security event today + one yesterday for the today-window card.
  await prisma.aiSecurityEvent.createMany({
    data: [
      {
        id: `${QA}security_today`,
        type: 'prompt_override',
        mode: 'log',
        length: 42,
        status: 'NEW',
        createdAt: now,
      },
      {
        id: `${QA}security_yesterday`,
        type: 'prompt_override',
        mode: 'log',
        length: 42,
        status: 'NEW',
        createdAt: yesterdayNoon,
      },
    ],
  });

  const counts = {
    conversations: await prisma.conversation.count({
      where: { id: { startsWith: QA } },
    }),
    messages: await prisma.chatMessage.count({
      where: { id: { startsWith: QA } },
    }),
    feedback: await prisma.aiAnswerFeedback.count({
      where: { id: { startsWith: QA } },
    }),
    security: await prisma.aiSecurityEvent.count({
      where: { id: { startsWith: QA } },
    }),
  };
  console.log('[qa-seed-b2] done', counts);
}

async function main() {
  const cleanOnly = process.argv.includes('--clean');
  await clean();
  if (cleanOnly) {
    console.log('[qa-seed-b2] cleaned qa_b2_* rows only');
    return;
  }
  await seed();
}

main()
  .catch((err) => {
    console.error('[qa-seed-b2] failed', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
