/**
 * Batch 1 QA seed — real Prisma writes into joy_mini_qa only.
 *
 * Run:
 *   DATABASE_URL=postgresql://.../joy_mini_qa npx tsx qa/seed/batch1.ts
 *   # or: npx tsx qa/seed/batch1.ts --clean   (delete qa_* rows only)
 *
 * Every row id starts with `qa_`, and cleanup deletes only `qa_`-prefixed ids.
 * No raw SQL dumps, no writes outside the QA database.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const QA = 'qa_';

async function clean() {
  // Delete in FK-safe order. Only QA-prefixed rows.
  await prisma.aiSpan.deleteMany({ where: { id: { startsWith: QA } } });
  await prisma.aiTrace.deleteMany({ where: { id: { startsWith: QA } } });
  await prisma.aiAnswerFeedback.deleteMany({
    where: { id: { startsWith: QA } },
  });
  await prisma.aiSecurityEvent.deleteMany({
    where: { id: { startsWith: QA } },
  });
  await prisma.chatMessage.deleteMany({ where: { id: { startsWith: QA } } });
  await prisma.conversation.deleteMany({ where: { id: { startsWith: QA } } });
  await prisma.adminUser.deleteMany({ where: { id: { startsWith: QA } } });
  // Eval datasets created during QA probes; cases/runs/results cascade.
  await prisma.aiEvalDataset.deleteMany({
    where: { name: { startsWith: QA } },
  });
}

async function seed() {
  const now = new Date();
  const tenMinutesAgo = new Date(now.getTime() - 10 * 60 * 1000);
  const minuteAgo = new Date(now.getTime() - 60 * 1000);

  // ---------------------------------------------------------------- admins
  const admins = [
    { id: 'qa_admin_viewer', username: 'qa_viewer', role: 'VIEWER', realName: 'QA Viewer' },
    { id: 'qa_admin_editor', username: 'qa_editor', role: 'EDITOR', realName: 'QA Editor' },
    { id: 'qa_admin_admin', username: 'qa_admin', role: 'ADMIN', realName: 'QA Admin' },
    { id: 'qa_admin_super', username: 'qa_super', role: 'SUPER_ADMIN', realName: 'QA Super Admin' },
  ];
  for (const admin of admins) {
    await prisma.adminUser.create({
      data: {
        ...admin,
        // Not used for login in QA (tokens are minted directly), but the
        // column is required.
        password: 'qa-not-a-login-account',
        status: 1,
      },
    });
  }

  // ----------------------------------------------------------- conversation
  await prisma.conversation.create({
    data: {
      id: 'qa_conv_1',
      type: 'SUPPORT',
      name: 'qa_support_conversation_1',
      status: 1,
      lastMsgContent: 'qa_last_message_secret_1',
      lastMsgTime: now,
      lastMsgSeqId: 2,
      lastMsgSenderId: null,
    },
  });

  await prisma.chatMessage.createMany({
    data: [
      {
        id: 'qa_msg_user_1',
        conversationId: 'qa_conv_1',
        senderId: null,
        type: 0,
        content: 'qa_user_question_secret_1',
        meta: { qa: 'user_meta_secret' },
        seqId: 1,
        role: 'user',
        source: 'user',
        createdAt: minuteAgo,
      },
      {
        id: 'qa_msg_ai_1',
        conversationId: 'qa_conv_1',
        senderId: null,
        type: 0,
        content: 'qa_ai_answer_secret_1',
        meta: { qa: 'ai_meta_secret' },
        seqId: 2,
        role: 'assistant',
        source: 'ai',
        createdAt: now,
      },
    ],
  });

  // A support conversation waiting for a human, for the SLA queue.
  await prisma.conversation.create({
    data: {
      id: 'qa_conv_sla_waiting',
      type: 'SUPPORT',
      name: 'qa_sla_waiting_1',
      status: 1,
      lastMsgContent: 'qa_sla_last_message_secret',
      lastMsgTime: tenMinutesAgo,
      lastMsgSeqId: 1,
      handlerId: 'awaiting_human',
      transferredAt: tenMinutesAgo,
      transferReason: 'qa_transfer_reason',
    },
  });

  // ------------------------------------------------------------- feedback
  const feedbacks = [
    // Explicit feedback linked to the AI answer. `input`/`answer` are derived
    // by the service from the chat messages; ADMIN sees them raw.
    {
      id: 'qa_fb_explicit_1',
      conversationId: 'qa_conv_1',
      messageId: 'qa_msg_ai_1',
      source: 'explicit',
      verdict: 'incorrect',
      errorType: 'irrelevant',
      failureKind: 'MODEL_ERROR',
      reviewStatus: 'PENDING',
      resolution: 'OPEN',
    },
    // 3x SERVICE_ERROR, signal=transferred.
    ...Array.from({ length: 3 }, (_, i) => ({
      id: `qa_fb_service_${i + 1}`,
      conversationId: 'qa_conv_1',
      messageId: null,
      source: 'implicit',
      signal: 'transferred',
      failureKind: 'SERVICE_ERROR',
      reviewStatus: 'PENDING',
      resolution: 'OPEN',
    })),
    {
      id: 'qa_fb_repeat_1',
      conversationId: 'qa_conv_1',
      messageId: null,
      source: 'implicit',
      signal: 'repeated_question',
      failureKind: 'REPEATED_QUESTION',
      reviewStatus: 'PENDING',
      resolution: 'OPEN',
    },
    {
      id: 'qa_fb_abandoned_1',
      conversationId: 'qa_conv_1',
      messageId: null,
      source: 'implicit',
      signal: 'abandoned',
      failureKind: 'USER_ABANDONED',
      reviewStatus: 'PENDING',
      resolution: 'OPEN',
    },
    {
      id: 'qa_fb_unexpected_1',
      conversationId: 'qa_conv_1',
      messageId: null,
      source: 'implicit',
      failureKind: 'UNEXPECTED_TRANSFER',
      reviewStatus: 'PENDING',
      resolution: 'OPEN',
    },
    // 2x ADDED_TO_EVAL (reviewed).
    ...Array.from({ length: 2 }, (_, i) => ({
      id: `qa_fb_added_${i + 1}`,
      conversationId: 'qa_conv_1',
      messageId: null,
      source: 'explicit',
      verdict: 'incorrect',
      failureKind: 'MODEL_ERROR',
      reviewStatus: 'REVIEWED',
      resolution: 'ADDED_TO_EVAL',
    })),
  ];

  await prisma.aiAnswerFeedback.createMany({
    data: feedbacks.map((row) => ({
      ...row,
      input: row.source === 'explicit' && row.id === 'qa_fb_explicit_1'
        ? null // derived from chat history by the service
        : 'qa_feedback_input_secret',
      note: 'qa_seed_note',
    })),
  });

  // ---------------------------------------------------------------- trace
  await prisma.aiTrace.create({
    data: {
      id: 'qa_trace_1',
      conversationId: 'qa_conv_1',
      triggerMessageId: 'qa_msg_user_1',
      aiMessageId: 'qa_msg_ai_1',
      source: 'qa',
      intent: 'qa_intent',
      input: 'qa_trace_input_secret',
      output: 'qa_trace_output_secret',
      status: 'SUCCESS',
      latencyMs: 123,
      metadata: { qa: 'trace_metadata_secret' },
      spans: {
        create: [
          {
            id: 'qa_span_1',
            type: 'llm',
            name: 'qa_span_name',
            status: 'OK',
            input: { qa: 'span_input_secret' },
            output: { qa: 'span_output_secret' },
            error: 'qa_span_error_secret',
            startedAt: minuteAgo,
            endedAt: now,
            durationMs: 123,
            metadata: { qa: 'span_metadata_secret' },
          },
        ],
      },
    },
  });

  // One NEW security event so the overview "安全待处理" attention row and the
  // security anomaly count are exercised for ADMIN/SUPER (and omitted for
  // VIEWER) without touching any real security data.
  await prisma.aiSecurityEvent.create({
    data: {
      id: 'qa_security_1',
      type: 'prompt_override',
      mode: 'log',
      length: 42,
      status: 'NEW',
    },
  });

  const counts = {
    admins: await prisma.adminUser.count({ where: { id: { startsWith: QA } } }),
    conversations: await prisma.conversation.count({
      where: { id: { startsWith: QA } },
    }),
    messages: await prisma.chatMessage.count({ where: { id: { startsWith: QA } } }),
    feedback: await prisma.aiAnswerFeedback.count({
      where: { id: { startsWith: QA } },
    }),
    traces: await prisma.aiTrace.count({ where: { id: { startsWith: QA } } }),
    spans: await prisma.aiSpan.count({ where: { id: { startsWith: QA } } }),
    securityEvents: await prisma.aiSecurityEvent.count({
      where: { id: { startsWith: QA } },
    }),
  };
  console.log('[qa-seed] done', counts);
}

async function main() {
  const shouldCleanOnly = process.argv.includes('--clean');
  await clean();
  if (shouldCleanOnly) {
    console.log('[qa-seed] cleaned qa_* rows only');
    return;
  }
  await seed();
}

main()
  .catch((err) => {
    console.error('[qa-seed] failed', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
