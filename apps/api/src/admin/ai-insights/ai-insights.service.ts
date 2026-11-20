import { Injectable } from '@nestjs/common';
import { PrismaService } from '@api/common/prisma/prisma.service';
import { QueryInsightsDto } from './dto/query-insights.dto';

@Injectable()
export class AiInsightsService {
  constructor(private readonly prisma: PrismaService) {}

  async overview(query: QueryInsightsDto) {
    const end = query.to ? new Date(`${query.to}T23:59:59.999Z`) : new Date();
    const start = query.from
      ? new Date(`${query.from}T00:00:00.000Z`)
      : new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
    const range = { gte: start, lte: end };

    const [
      conversations,
      messagesBySource,
      feedbackBySignal,
      feedbackByReview,
      transfers,
      usage,
    ] = await Promise.all([
      this.prisma.conversation.count({
        where: { createdAt: range, type: { in: ['SUPPORT', 'AI'] } },
      }),
      this.prisma.chatMessage.groupBy({
        by: ['source'],
        where: { createdAt: range },
        _count: { id: true },
      }),
      this.prisma.aiAnswerFeedback.groupBy({
        by: ['signal'],
        where: { createdAt: range, source: 'implicit' },
        _count: { id: true },
      }),
      this.prisma.aiAnswerFeedback.groupBy({
        by: ['reviewStatus'],
        where: { createdAt: range },
        _count: { id: true },
      }),
      this.prisma.conversation.groupBy({
        by: ['transferReason'],
        where: {
          createdAt: range,
          transferReason: { not: null },
        },
        _count: { id: true },
      }),
      this.prisma.aiUsageDaily.aggregate({
        where: { date: { gte: start, lte: end } },
        _sum: { totalTokens: true, requests: true },
      }),
    ]);

    const aiMessages =
      messagesBySource.find((row) => row.source === 'ai')?._count.id ?? 0;
    const userMessages =
      messagesBySource.find((row) => row.source === 'user')?._count.id ?? 0;
    const humanMessages =
      messagesBySource.find((row) => row.source === 'human_agent')?._count.id ??
      0;
    const repeated =
      feedbackBySignal.find((row) => row.signal === 'repeated_question')?._count
        .id ?? 0;
    const abandoned =
      feedbackBySignal.find((row) => row.signal === 'abandoned')?._count.id ??
      0;
    const transferred =
      feedbackBySignal.find((row) => row.signal === 'transferred')?._count.id ??
      0;

    const transferTotal = transfers.reduce(
      (sum, row) => sum + row._count.id,
      0,
    );

    return {
      range: {
        from: start.toISOString().slice(0, 10),
        to: end.toISOString().slice(0, 10),
        timezone: 'UTC',
      },
      conversations,
      messages: { ai: aiMessages, user: userMessages, human: humanMessages },
      feedback: {
        repeatedQuestion: repeated,
        abandoned,
        transferred,
        byReviewStatus: feedbackByReview.map((row) => ({
          status: row.reviewStatus,
          count: row._count.id,
        })),
      },
      transfers: {
        total: transferTotal,
        byReason: transfers.map((row) => ({
          reason: row.transferReason ?? 'unknown',
          count: row._count.id,
        })),
        rate:
          conversations > 0
            ? Number((transferTotal / conversations).toFixed(3))
            : 0,
      },
      usage: {
        totalTokens: usage._sum.totalTokens ?? 0,
        requests: usage._sum.requests ?? 0,
      },
      notes: [
        '口径为 UTC；AI/用户/人工消息来自 ChatMessage.source。',
        '转人工率 = transferReason 非空的会话 / SUPPORT+AI 会话数。',
        '重复追问/放弃/转人工来自隐式反馈信号。',
      ],
    };
  }
}
