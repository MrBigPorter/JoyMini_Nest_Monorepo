/**
 * 清理模拟器产生的会话数据（默认 dry-run）。
 *
 * 识别依据只有一个：Conversation.aiMetadata.trafficSource ===
 * 'simulation_support_v1'。不按内容猜，避免误删真实用户。
 *
 * 用法（apps/api 下）：
 *   ../../node_modules/.bin/tsx --env-file=.env scripts/cleanup-sim-data.ts
 *   ../../node_modules/.bin/tsx --env-file=.env scripts/cleanup-sim-data.ts \
 *     --apply --confirm=DELETE_SIM_DATA
 *
 * 默认不删除用户，只删除会话及其消息/AI 数据；用户保留，避免误伤订单/钱包。
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const SIM_SOURCE = 'simulation_support_v1';

function argValue(args: string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  const inline = args.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const confirm = argValue(args, 'confirm');

  const conversations = await prisma.conversation.findMany({
    where: {
      type: 'SUPPORT',
      aiMetadata: { path: ['trafficSource'], equals: SIM_SOURCE },
    },
    select: { id: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });
  const ids = conversations.map((row) => row.id);

  if (ids.length === 0) {
    console.log('[sim-cleanup] no simulation conversations found');
    return;
  }

  const members = await prisma.chatMember.findMany({
    where: { conversationId: { in: ids } },
    select: { userId: true },
  });
  const userIds = [...new Set(members.map((row) => row.userId))];

  const traces = await prisma.aiTrace.findMany({
    where: { conversationId: { in: ids } },
    select: { id: true },
  });
  const traceIds = traces.map((row) => row.id);

  const [
    messageCount,
    memberCount,
    traceCount,
    feedbackCount,
    actionCount,
    outboxCount,
    scoreCount,
    eventCount,
    memoryCount,
    summaryCount,
  ] = await Promise.all([
    prisma.chatMessage.count({ where: { conversationId: { in: ids } } }),
    prisma.chatMember.count({ where: { conversationId: { in: ids } } }),
    prisma.aiTrace.count({ where: { conversationId: { in: ids } } }),
    prisma.aiAnswerFeedback.count({ where: { conversationId: { in: ids } } }),
    prisma.aiActionRequest.count({ where: { conversationId: { in: ids } } }),
    prisma.aiTaskOutbox.count({ where: { conversationId: { in: ids } } }),
    prisma.aiScore.count({
      where: {
        OR: [
          { conversationId: { in: ids } },
          ...(traceIds.length > 0 ? [{ traceId: { in: traceIds } }] : []),
        ],
      },
    }),
    prisma.aiProblemEvent.count({ where: { conversationId: { in: ids } } }),
    prisma.aiUserMemory.count({
      where: { sourceConversationId: { in: ids } },
    }),
    prisma.aiMemorySummary.count({ where: { conversationId: { in: ids } } }),
  ]);

  console.log(`[sim-cleanup] mode=${apply ? 'APPLY' : 'DRY-RUN'}`);
  console.log(`[sim-cleanup] conversations: ${ids.length}`);
  console.log(`[sim-cleanup] users referenced: ${userIds.length}`);
  console.log(`[sim-cleanup] messages: ${messageCount}`);
  console.log(`[sim-cleanup] members: ${memberCount}`);
  console.log(`[sim-cleanup] traces: ${traceCount}`);
  console.log(`[sim-cleanup] feedback: ${feedbackCount}`);
  console.log(`[sim-cleanup] action requests: ${actionCount}`);
  console.log(`[sim-cleanup] outbox: ${outboxCount}`);
  console.log(`[sim-cleanup] scores: ${scoreCount}`);
  console.log(`[sim-cleanup] problem events: ${eventCount}`);
  console.log(`[sim-cleanup] user memories: ${memoryCount}`);
  console.log(`[sim-cleanup] memory summaries: ${summaryCount}`);
  console.log(
    `[sim-cleanup] sample conversations: ${ids.slice(0, 5).join(', ')}${ids.length > 5 ? ' ...' : ''}`,
  );

  if (!apply) {
    console.log(
      '[sim-cleanup] dry-run only. To delete, pass --apply --confirm=DELETE_SIM_DATA',
    );
    return;
  }
  if (confirm !== 'DELETE_SIM_DATA') {
    throw new Error(
      'Refusing to delete: pass --confirm=DELETE_SIM_DATA together with --apply',
    );
  }

  const result = await prisma.$transaction(async (tx) => {
    const scores = await tx.aiScore.deleteMany({
      where: {
        OR: [
          { conversationId: { in: ids } },
          ...(traceIds.length > 0 ? [{ traceId: { in: traceIds } }] : []),
        ],
      },
    });
    const feedback = await tx.aiAnswerFeedback.deleteMany({
      where: { conversationId: { in: ids } },
    });
    const actions = await tx.aiActionRequest.deleteMany({
      where: { conversationId: { in: ids } },
    });
    const outbox = await tx.aiTaskOutbox.deleteMany({
      where: { conversationId: { in: ids } },
    });
    const events = await tx.aiProblemEvent.deleteMany({
      where: { conversationId: { in: ids } },
    });
    const memories = await tx.aiUserMemory.deleteMany({
      where: { sourceConversationId: { in: ids } },
    });
    const summaries = await tx.aiMemorySummary.deleteMany({
      where: { conversationId: { in: ids } },
    });
    const tracesDeleted = await tx.aiTrace.deleteMany({
      where: { conversationId: { in: ids } },
    });
    const messages = await tx.chatMessage.deleteMany({
      where: { conversationId: { in: ids } },
    });
    const membersDeleted = await tx.chatMember.deleteMany({
      where: { conversationId: { in: ids } },
    });
    const conversationsDeleted = await tx.conversation.deleteMany({
      where: { id: { in: ids } },
    });
    return {
      scores: scores.count,
      feedback: feedback.count,
      actions: actions.count,
      outbox: outbox.count,
      events: events.count,
      memories: memories.count,
      summaries: summaries.count,
      traces: tracesDeleted.count,
      messages: messages.count,
      members: membersDeleted.count,
      conversations: conversationsDeleted.count,
    };
  });

  console.log('[sim-cleanup] deleted:', JSON.stringify(result));
  console.log(
    `[sim-cleanup] users kept: ${userIds.length} (no user/order/wallet data deleted)`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
