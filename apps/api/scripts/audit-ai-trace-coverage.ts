/**
 * 链路覆盖率审计（只读）。
 *
 * 回答一个运营/工程都会问的问题：明明有 AI 回复，为什么点进去没有 trace？
 * 统计窗口内的 AI 消息与 trace，按会话对比，列出「有回复但零链路」的会话。
 *
 * 用法：
 *   yarn workspace @lucky/api tsx scripts/audit-ai-trace-coverage.ts
 *   yarn workspace @lucky/api tsx scripts/audit-ai-trace-coverage.ts --hours=6
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function readHours(): number {
  const arg = process.argv.find((value) => value.startsWith('--hours='));
  const hours = arg ? Number(arg.slice('--hours='.length)) : 24;
  return Number.isFinite(hours) && hours > 0 ? hours : 24;
}

async function main() {
  const hours = readHours();
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);
  console.log(
    `[trace-audit] window=${hours}h since=${since.toISOString()} (UTC)`,
  );

  const aiMessages = await prisma.chatMessage.groupBy({
    by: ['conversationId'],
    where: { source: 'ai', createdAt: { gte: since } },
    _count: { _all: true },
  });
  const totalReplies = aiMessages.reduce(
    (sum, row) => sum + row._count._all,
    0,
  );
  const conversationIds = aiMessages.map((row) => row.conversationId);

  if (conversationIds.length === 0) {
    console.log('[trace-audit] no AI replies in window');
    return;
  }

  const traces = await prisma.aiTrace.groupBy({
    by: ['conversationId'],
    where: {
      conversationId: { in: conversationIds },
      createdAt: { gte: since },
    },
    _count: { _all: true },
  });
  const traceByConversation = new Map(
    traces.map((row) => [row.conversationId, row._count._all]),
  );
  const totalTraces = traces.reduce((sum, row) => sum + row._count._all, 0);

  const missing = aiMessages
    .filter((row) => !traceByConversation.has(row.conversationId))
    .sort((a, b) => b._count._all - a._count._all);

  console.log(
    `[trace-audit] conversations=${conversationIds.length} aiReplies=${totalReplies} traces=${totalTraces}`,
  );
  console.log(
    `[trace-audit] conversationsWithoutTrace=${missing.length} ` +
      `(${missing.reduce((sum, row) => sum + row._count._all, 0)} replies)`,
  );

  if (missing.length > 0) {
    console.log('\n[trace-audit] top conversations with replies but no trace:');
    for (const row of missing.slice(0, 20)) {
      const latest = await prisma.chatMessage.findFirst({
        where: { conversationId: row.conversationId, source: 'ai' },
        orderBy: { seqId: 'desc' },
        select: { createdAt: true },
      });
      console.log(
        `  ${row.conversationId} replies=${row._count._all} latest=${latest?.createdAt?.toISOString() ?? 'unknown'}`,
      );
    }
  }

  console.log(
    '\n[trace-audit] note: rows written before the trace feature (2026-11-21 00:24) cannot be reconstructed.',
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
