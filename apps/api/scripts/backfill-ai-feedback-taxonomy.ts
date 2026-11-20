/**
 * 一次性回填 AI 反馈的运营归因/处理结论。
 *
 * 规则见 docs/AI-joymini/113-AI质量运营-数据模型.md §9。
 * - 只处理 resolution IS NULL 的行，可重复执行
 * - 不覆盖已有 resolution/failureKind
 * - 启发式结果允许 UNKNOWN，后续由运营在页面确认
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const BATCH_SIZE = 500;

type FeedbackRow = {
  id: string;
  conversationId: string;
  verdict: string | null;
  signal: string | null;
  reviewStatus: string;
};

const REVIEW_TO_RESOLUTION: Record<string, string> = {
  PENDING: 'OPEN',
  REVIEWED: 'CONFIRMED',
  IGNORED: 'EXCLUDED',
};

function inferFailureKind(
  row: FeedbackRow,
  transferReason: string | null,
): string | null {
  if (transferReason === 'ai_error') return 'SERVICE_ERROR';
  if (transferReason === 'explicit_request') return 'EXPECTED_TRANSFER';
  if (row.verdict === 'incorrect') return 'MODEL_ERROR';
  if (row.signal === 'abandoned') return 'USER_ABANDONED';
  if (row.signal === 'repeated_question') return 'REPEATED_QUESTION';
  if (row.signal === 'transferred') return 'UNEXPECTED_TRANSFER';
  if (row.verdict === 'correct') return null;
  return 'UNKNOWN';
}

async function main() {
  let processed = 0;

  for (;;) {
    const rows = (await prisma.aiAnswerFeedback.findMany({
      where: { resolution: null },
      orderBy: { createdAt: 'asc' },
      take: BATCH_SIZE,
      select: {
        id: true,
        conversationId: true,
        verdict: true,
        signal: true,
        reviewStatus: true,
      },
    })) as FeedbackRow[];
    if (rows.length === 0) break;

    const conversations = await prisma.conversation.findMany({
      where: { id: { in: [...new Set(rows.map((row) => row.conversationId))] } },
      select: { id: true, transferReason: true },
    });
    const reasonById = new Map(
      conversations.map((conversation) => [
        conversation.id,
        conversation.transferReason,
      ]),
    );

    await prisma.$transaction(
      rows.map((row) =>
        prisma.aiAnswerFeedback.update({
          where: { id: row.id },
          data: {
            failureKind: inferFailureKind(
              row,
              reasonById.get(row.conversationId) ?? null,
            ),
            resolution:
              REVIEW_TO_RESOLUTION[row.reviewStatus] ?? 'OPEN',
          },
        }),
      ),
    );

    processed += rows.length;
    console.log(`[backfill] processed ${processed}`);
  }

  console.log(`[backfill] done, ${processed} rows`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
