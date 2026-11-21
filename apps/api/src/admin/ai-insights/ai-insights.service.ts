import { Injectable } from '@nestjs/common';
import { ConversationType } from '@prisma/client';
import { PrismaService } from '@api/common/prisma/prisma.service';
import { QueryInsightsDto } from './dto/query-insights.dto';

/** 洞察指标只统计这两类会话，GROUP/DIRECT 不进分母。 */
const AI_CONVERSATION_TYPES = {
  in: [ConversationType.SUPPORT, ConversationType.AI],
};

/**
 * 114 §8 的率都基于 AiAnswerFeedback.failureKind（Batch 1–5 已落库）：
 * - MODEL_ERROR：显式负反馈自动派生
 * - SERVICE_ERROR：transferReason='ai_error' 的转人工自动派生
 * - EXPECTED_TRANSFER：transferReason='explicit_request' 自动派生
 * - UNEXPECTED_TRANSFER：只能由运营人工确认写入，system 派生不会写
 */
const FAILURE_KIND = {
  MODEL_ERROR: 'MODEL_ERROR',
  SERVICE_ERROR: 'SERVICE_ERROR',
  EXPECTED_TRANSFER: 'EXPECTED_TRANSFER',
  UNEXPECTED_TRANSFER: 'UNEXPECTED_TRANSFER',
} as const;

function ratio(numerator: number, denominator: number): number {
  return denominator > 0 ? Number((numerator / denominator).toFixed(3)) : 0;
}

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
      feedbackByFailureKind,
      transfers,
      transferPopulation,
      actionableFeedback,
      usage,
    ] = await Promise.all([
      // 兼容旧字段：窗口内创建的 SUPPORT/AI 会话数。
      this.prisma.conversation.count({
        where: { createdAt: range, type: AI_CONVERSATION_TYPES },
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
      // 114 §8 率的统一来源：运营归因，而不是 verdict/signal 原始值。
      this.prisma.aiAnswerFeedback.groupBy({
        by: ['failureKind'],
        where: { createdAt: range },
        _count: { id: true },
      }),
      // 分子：本轮窗口内真实发生的转人工。用 transferredAt 而不是
      // transferReason + createdAt，否则“窗口内创建、窗口外才转”的 sticky
      // 会话会被算进来；同时按会话类型过滤，GROUP/DIRECT 不参与。
      this.prisma.conversation.groupBy({
        by: ['transferReason'],
        where: {
          type: AI_CONVERSATION_TYPES,
          transferredAt: range,
          transferReason: { not: null },
        },
        _count: { id: true },
      }),
      // 分母：窗口内创建、或窗口内发生转人工的 SUPPORT/AI 会话。
      // 这样窗口前创建、窗口内转人工的会话既在分子也在分母，转人工率不会 > 1。
      this.prisma.conversation.count({
        where: {
          type: AI_CONVERSATION_TYPES,
          OR: [{ createdAt: range }, { transferredAt: range }],
        },
      }),
      // 可行动反馈 = 显式负反馈 ∪ SERVICE_ERROR（113 §9.1 / 114 §4.3）。
      // 不额外限制 resolution：已关闭的故障仍属于本期可行动集合，否则
      // 分子（SERVICE_ERROR）可能大于分母。
      this.prisma.aiAnswerFeedback.count({
        where: {
          createdAt: range,
          OR: [
            { source: 'explicit', verdict: 'incorrect' },
            { failureKind: FAILURE_KIND.SERVICE_ERROR },
          ],
        },
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

    const countByFailureKind = (kind: string) =>
      feedbackByFailureKind.find((row) => row.failureKind === kind)?._count
        .id ?? 0;

    const transferTotal = transfers.reduce(
      (sum, row) => sum + row._count.id,
      0,
    );

    // ── 114 §8 核心率 ───────────────────────────────────────────────
    const modelErrors = countByFailureKind(FAILURE_KIND.MODEL_ERROR);
    // 只统计人工确认后的 UNEXPECTED_TRANSFER；implicit transferred 仅作信号。
    const unexpectedTransfers = countByFailureKind(
      FAILURE_KIND.UNEXPECTED_TRANSFER,
    );
    const expectedTransfers = countByFailureKind(
      FAILURE_KIND.EXPECTED_TRANSFER,
    );
    // SERVICE_ERROR 本身就是一次转人工（ai_error），计入确认转人工分母。
    const serviceErrors = countByFailureKind(FAILURE_KIND.SERVICE_ERROR);

    const confirmedTransfers =
      expectedTransfers + unexpectedTransfers + serviceErrors;

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
        suspectedMisTransfer: transferred,
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
        // 保留旧字段（0~1 小数）；页面用 numerator/denominator 展示“12 / 22”。
        // 分母 = 窗口内活跃（createdAt 或 transferredAt 落在窗内）的 SUPPORT/AI 会话。
        rate: ratio(transferTotal, transferPopulation),
        numerator: transferTotal,
        denominator: transferPopulation,
      },
      rates: {
        // 模型错误率 = MODEL_ERROR / (MODEL_ERROR + UNEXPECTED_TRANSFER)
        modelError: {
          numerator: modelErrors,
          denominator: modelErrors + unexpectedTransfers,
          rate: ratio(modelErrors, modelErrors + unexpectedTransfers),
        },
        // 服务故障率 = SERVICE_ERROR / 可行动反馈（显式负反馈 ∪ SERVICE_ERROR）
        serviceError: {
          numerator: serviceErrors,
          denominator: actionableFeedback,
          rate: ratio(serviceErrors, actionableFeedback),
        },
        // 误转率 = 人工确认的 UNEXPECTED_TRANSFER / 已确认转人工
        // 已确认转人工 = EXPECTED_TRANSFER + UNEXPECTED_TRANSFER + SERVICE_ERROR 转人工
        misTransfer: {
          numerator: unexpectedTransfers,
          denominator: confirmedTransfers,
          rate: ratio(unexpectedTransfers, confirmedTransfers),
        },
      },
      usage: {
        totalTokens: usage._sum.totalTokens ?? 0,
        requests: usage._sum.requests ?? 0,
      },
      notes: [
        '口径为 UTC；AI/用户/人工消息来自 ChatMessage.source（后台客服回复写 human_agent）。',
        '转人工率 = 窗口内 transferredAt 落在范围的 SUPPORT+AI 会话 / 窗口内创建或转人工的 SUPPORT+AI 会话。',
        '模型错误率/服务故障率/误转率来自 AiAnswerFeedback.failureKind；误转只统计人工确认的 UNEXPECTED_TRANSFER。',
        '服务故障率分母 = 显式负反馈 + SERVICE_ERROR；信号区 transferred 仅作“疑似误转”展示。',
      ],
    };
  }
}
