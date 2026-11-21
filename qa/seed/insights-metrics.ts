/**
 * Insights metrics QA seed (UTC 2026-11-15 window).
 *
 * Conversations:
 *   qa_im_conv_a  SUPPORT created D10, transferred D11 explicit_request
 *   qa_im_conv_b  SUPPORT created D10
 *   qa_im_conv_c  GROUP (excluded)
 *   qa_im_conv_d  AI created D-1, transferred D12 ai_error
 * -> transfer numerator 2, denominator 3, rate 2/3; byReason 1+1; conversations=2
 *
 * Feedback (createdAt D):
 *   MODEL_ERROR x2 (explicit incorrect)
 *   SERVICE_ERROR x2 (implicit transferred)
 *   EXPECTED_TRANSFER x1
 *   UNEXPECTED_TRANSFER x1 (human-confirmed)
 *   UNKNOWN x1 (implicit transferred, suspected)
 * -> rates: modelError 2/3, serviceError 2/4, misTransfer 1/4;
 *    suspectedMisTransfer/transferred = 5
 *
 * Human reply fixture:
 *   bot + customer users, members, user/ai messages in qa_im_conv_human (today).
 *
 * Run:
 *   DATABASE_URL=... npx tsx qa/seed/insights-metrics.ts
 *   DATABASE_URL=... npx tsx qa/seed/insights-metrics.ts --clean
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const PREFIX = 'qa_im_';
const D = '2026-11-15';
const at = (date: string, h: number) => new Date(`${date}T${String(h).padStart(2, '0')}:00:00.000Z`);
const dayBefore = '2026-11-14';
const today = new Date().toISOString().slice(0, 10);

async function clean() {
  await prisma.chatMessage.deleteMany({
    where: {
      OR: [
        { id: { startsWith: PREFIX } },
        { conversationId: { startsWith: PREFIX } },
      ],
    },
  });
  await prisma.chatMember.deleteMany({
    where: {
      OR: [
        { conversationId: { startsWith: PREFIX } },
        { userId: { startsWith: PREFIX } },
      ],
    },
  });
  await prisma.conversation.deleteMany({
    where: { id: { startsWith: PREFIX } },
  });
  await prisma.user.deleteMany({ where: { id: { startsWith: PREFIX } } });
  await prisma.aiAnswerFeedback.deleteMany({
    where: { id: { startsWith: PREFIX } },
  });
}

async function seed() {
  // ── conversations for the D window ──
  await prisma.conversation.createMany({
    data: [
      {
        id: `${PREFIX}conv_a`,
        type: 'SUPPORT',
        name: `${PREFIX}conv_a`,
        status: 1,
        createdAt: at(D, 10),
        transferredAt: at(D, 11),
        transferReason: 'explicit_request',
      },
      {
        id: `${PREFIX}conv_b`,
        type: 'SUPPORT',
        name: `${PREFIX}conv_b`,
        status: 1,
        createdAt: at(D, 10),
      },
      {
        id: `${PREFIX}conv_c`,
        type: 'GROUP',
        name: `${PREFIX}conv_c`,
        status: 1,
        createdAt: at(D, 10),
      },
      {
        id: `${PREFIX}conv_d`,
        type: 'AI',
        name: `${PREFIX}conv_d`,
        status: 1,
        createdAt: at(dayBefore, 10),
        transferredAt: at(D, 12),
        transferReason: 'ai_error',
      },
    ],
  });

  // ── feedback for the D window (failureKind drives the rates) ──
  const base = {
    conversationId: `${PREFIX}conv_a`,
    input: null,
    note: null,
  };
  await prisma.aiAnswerFeedback.createMany({
    data: [
      {
        ...base,
        id: `${PREFIX}fb_model_1`,
        source: 'explicit',
        verdict: 'incorrect',
        failureKind: 'MODEL_ERROR',
        resolution: 'OPEN',
        reviewStatus: 'PENDING',
        createdAt: at(D, 13),
      },
      {
        ...base,
        id: `${PREFIX}fb_model_2`,
        source: 'explicit',
        verdict: 'incorrect',
        failureKind: 'MODEL_ERROR',
        resolution: 'OPEN',
        reviewStatus: 'PENDING',
        createdAt: at(D, 13),
      },
      {
        ...base,
        id: `${PREFIX}fb_service_1`,
        source: 'implicit',
        signal: 'transferred',
        failureKind: 'SERVICE_ERROR',
        resolution: 'OPEN',
        reviewStatus: 'PENDING',
        createdAt: at(D, 14),
      },
      {
        ...base,
        id: `${PREFIX}fb_service_2`,
        source: 'implicit',
        signal: 'transferred',
        failureKind: 'SERVICE_ERROR',
        resolution: 'OPEN',
        reviewStatus: 'PENDING',
        createdAt: at(D, 14),
      },
      {
        ...base,
        id: `${PREFIX}fb_expected`,
        source: 'implicit',
        signal: 'transferred',
        failureKind: 'EXPECTED_TRANSFER',
        resolution: 'EXCLUDED',
        reviewStatus: 'IGNORED',
        createdAt: at(D, 15),
      },
      {
        ...base,
        id: `${PREFIX}fb_unexpected`,
        source: 'implicit',
        signal: 'transferred',
        failureKind: 'UNEXPECTED_TRANSFER',
        resolution: 'OPEN',
        reviewStatus: 'PENDING',
        reviewedBy: 'qa_admin_admin',
        reviewedAt: at(D, 16),
        createdAt: at(D, 16),
      },
      {
        ...base,
        id: `${PREFIX}fb_unknown`,
        source: 'implicit',
        signal: 'transferred',
        failureKind: 'UNKNOWN',
        resolution: 'OPEN',
        reviewStatus: 'PENDING',
        createdAt: at(D, 17),
      },
    ],
  });

  // ── human reply fixture (today) ──
  await prisma.user.createMany({
    data: [
      {
        id: `${PREFIX}bot`,
        nickname: 'QA Support Bot',
        phone: 'qa-im-bot-phone',
        phoneMd5: 'qa_im_bot_md5_000000000000000000',
        isRobot: true,
      },
      {
        id: `${PREFIX}customer`,
        nickname: 'QA Customer',
        phone: 'qa-im-customer-phone',
        phoneMd5: 'qa_im_customer_md5_000000000000',
        isRobot: false,
      },
    ],
  });
  await prisma.conversation.create({
    data: {
      id: `${PREFIX}conv_human`,
      type: 'SUPPORT',
      name: `${PREFIX}conv_human`,
      status: 1,
      lastMsgContent: 'qa_im_ai_message',
      lastMsgTime: new Date(),
      lastMsgSeqId: 2,
    },
  });
  await prisma.chatMember.createMany({
    data: [
      {
        conversationId: `${PREFIX}conv_human`,
        userId: `${PREFIX}bot`,
        role: 'MEMBER',
      },
      {
        conversationId: `${PREFIX}conv_human`,
        userId: `${PREFIX}customer`,
        role: 'OWNER',
      },
    ],
  });
  await prisma.chatMessage.createMany({
    data: [
      {
        id: `${PREFIX}msg_user`,
        conversationId: `${PREFIX}conv_human`,
        senderId: `${PREFIX}customer`,
        type: 0,
        content: 'qa_im_user_message',
        seqId: 1,
        role: 'user',
        source: 'user',
      },
      {
        id: `${PREFIX}msg_ai`,
        conversationId: `${PREFIX}conv_human`,
        senderId: null,
        type: 0,
        content: 'qa_im_ai_message',
        seqId: 2,
        role: 'assistant',
        source: 'ai',
      },
    ],
  });

  console.log('[qa-seed-im] done', {
    date: D,
    today,
    conversations: await prisma.conversation.count({
      where: { id: { startsWith: PREFIX } },
    }),
    feedback: await prisma.aiAnswerFeedback.count({
      where: { id: { startsWith: PREFIX } },
    }),
  });
}

async function main() {
  const cleanOnly = process.argv.includes('--clean');
  await clean();
  if (cleanOnly) {
    console.log('[qa-seed-im] cleaned qa_im_* rows');
    return;
  }
  await seed();
}

main()
  .catch((err) => {
    console.error('[qa-seed-im] failed', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
