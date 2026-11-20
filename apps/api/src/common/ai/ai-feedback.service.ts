import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@api/common/prisma/prisma.service';

export type FeedbackSource = 'explicit' | 'implicit';
export type FeedbackVerdict = 'correct' | 'incorrect';
/** 设计 D4 的四类错误；先固定枚举，后续可扩。 */
export const FEEDBACK_ERROR_TYPES = [
  'irrelevant',
  'outdated',
  'overreach',
  'format',
] as const;
export type FeedbackErrorType = (typeof FEEDBACK_ERROR_TYPES)[number];
export type FeedbackSignal = 'transferred' | 'repeated_question' | 'abandoned';

/** 运营归因；与 113 数据模型保持一致。 */
export const FEEDBACK_FAILURE_KINDS = [
  'MODEL_ERROR',
  'SERVICE_ERROR',
  'EXPECTED_TRANSFER',
  'UNEXPECTED_TRANSFER',
  'USER_ABANDONED',
  'REPEATED_QUESTION',
  'UNKNOWN',
] as const;
export type FeedbackFailureKind = (typeof FEEDBACK_FAILURE_KINDS)[number];

/** 处理结论；与旧 reviewStatus 双写兼容。 */
export const FEEDBACK_RESOLUTIONS = [
  'OPEN',
  'CONFIRMED',
  'EXCLUDED',
  'ADDED_TO_EVAL',
  'FIXED_PENDING_VERIFY',
  'CLOSED',
  'NO_ISSUE',
] as const;
export type FeedbackResolution = (typeof FEEDBACK_RESOLUTIONS)[number];

const RESOLUTION_TO_REVIEW_STATUS: Record<FeedbackResolution, string> = {
  OPEN: 'PENDING',
  CONFIRMED: 'REVIEWED',
  EXCLUDED: 'IGNORED',
  ADDED_TO_EVAL: 'REVIEWED',
  FIXED_PENDING_VERIFY: 'REVIEWED',
  CLOSED: 'REVIEWED',
  NO_ISSUE: 'REVIEWED',
};

const REVIEW_STATUS_TO_RESOLUTION: Record<string, FeedbackResolution> = {
  PENDING: 'OPEN',
  REVIEWED: 'CONFIRMED',
  IGNORED: 'EXCLUDED',
};

export type FeedbackQueue = 'TODO' | 'SIGNAL';

export interface FeedbackRange {
  from?: string;
  to?: string;
}

/** 日期参数按 UTC 日界处理；完整 ISO 时间也兼容。 */
function buildCreatedAtRange(
  range: FeedbackRange,
): Record<string, Date> | null {
  if (!range.from && !range.to) return null;
  const startOfDay = (value: string) =>
    value.includes('T') ? new Date(value) : new Date(`${value}T00:00:00.000Z`);
  const endOfDay = (value: string) =>
    value.includes('T') ? new Date(value) : new Date(`${value}T23:59:59.999Z`);
  return {
    ...(range.from ? { gte: startOfDay(range.from) } : {}),
    ...(range.to ? { lte: endOfDay(range.to) } : {}),
  };
}

/**
 * 待办：需要人判断的条目（113 §9.1）。
 * 系统信号（转人工/取消/重复追问）默认不进待办。
 */
export function actionableFeedbackWhere(): Record<string, unknown> {
  return {
    resolution: 'OPEN',
    OR: [
      { source: 'explicit', verdict: 'incorrect' },
      { failureKind: 'SERVICE_ERROR' },
      { ownerAdminId: { not: null } },
    ],
  };
}

/** 信号区：隐式线索，且未自动排除、未被人工认领。 */
export function signalFeedbackWhere(): Record<string, unknown> {
  return {
    source: 'implicit',
    resolution: { notIn: ['EXCLUDED', 'NO_ISSUE'] },
    failureKind: { not: 'SERVICE_ERROR' },
    ownerAdminId: null,
  };
}

function mergeWhere(
  createdAt: Record<string, Date> | null,
  extra?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...(createdAt ? { createdAt } : {}),
    ...(extra ?? {}),
  };
}

interface DerivedTriage {
  failureKind: FeedbackFailureKind | null;
  resolution: FeedbackResolution;
  reviewStatus: 'PENDING' | 'REVIEWED' | 'IGNORED';
}

function deriveExplicit(verdict: FeedbackVerdict): DerivedTriage {
  if (verdict === 'correct') {
    return {
      failureKind: null,
      resolution: 'NO_ISSUE',
      reviewStatus: 'REVIEWED',
    };
  }
  return {
    failureKind: 'MODEL_ERROR',
    resolution: 'OPEN',
    reviewStatus: 'PENDING',
  };
}

function deriveImplicit(
  signal: FeedbackSignal,
  metadata?: Record<string, unknown>,
): DerivedTriage {
  const reason = typeof metadata?.reason === 'string' ? metadata.reason : null;
  if (reason === 'ai_error') {
    return {
      failureKind: 'SERVICE_ERROR',
      resolution: 'OPEN',
      reviewStatus: 'PENDING',
    };
  }
  if (reason === 'explicit_request') {
    return {
      failureKind: 'EXPECTED_TRANSFER',
      resolution: 'EXCLUDED',
      reviewStatus: 'IGNORED',
    };
  }
  switch (signal) {
    case 'abandoned':
      return {
        failureKind: 'USER_ABANDONED',
        resolution: 'OPEN',
        reviewStatus: 'PENDING',
      };
    case 'repeated_question':
      return {
        failureKind: 'REPEATED_QUESTION',
        resolution: 'OPEN',
        reviewStatus: 'PENDING',
      };
    case 'transferred':
    default:
      return {
        failureKind: 'UNKNOWN',
        resolution: 'OPEN',
        reviewStatus: 'PENDING',
      };
  }
}

export interface ExplicitFeedbackInput {
  conversationId: string;
  messageId?: string;
  userId?: string;
  verdict: FeedbackVerdict;
  errorType?: FeedbackErrorType;
  note?: string;
  adminId?: string;
}

export interface ImplicitFeedbackInput {
  conversationId: string;
  messageId?: string;
  userId?: string;
  signal: FeedbackSignal;
  metadata?: Record<string, unknown>;
}

/**
 * AI 回答反馈（ai-quality-loop 4.x）
 *
 * 显式与隐式同表、用 source 区分：
 *   - explicit：客服判断（正确 / 有误 + 错误类型）
 *   - implicit：转人工 / 重复追问 / 中途放弃，只是线索
 *
 * 隐式信号做 10 分钟窗口去重，避免同一次异常刷出多条。
 */
@Injectable()
export class AiFeedbackService {
  private readonly logger = new Logger(AiFeedbackService.name);
  private static readonly DEDUPE_WINDOW_MS = 10 * 60 * 1000;

  constructor(private readonly prisma: PrismaService) {}

  async recordExplicit(input: ExplicitFeedbackInput): Promise<{ id: string }> {
    const userInput = await this.resolveUserInput(
      input.conversationId,
      input.messageId,
    );
    const derived = deriveExplicit(input.verdict);
    const row = await this.prisma.aiAnswerFeedback.create({
      data: {
        conversationId: input.conversationId,
        messageId: input.messageId ?? null,
        input: userInput,
        userId: input.userId ?? null,
        source: 'explicit',
        verdict: input.verdict,
        // 只有“有误”才带错误类型
        errorType:
          input.verdict === 'incorrect' ? (input.errorType ?? null) : null,
        note: input.note?.slice(0, 500) ?? null,
        adminId: input.adminId ?? null,
        failureKind: derived.failureKind,
        resolution: derived.resolution,
        reviewStatus: derived.reviewStatus,
      },
      select: { id: true },
    });
    this.logger.log(
      `[Feedback] explicit conv=${input.conversationId} verdict=${input.verdict} type=${input.errorType ?? '-'}`,
    );
    return row;
  }

  async recordImplicit(input: ImplicitFeedbackInput): Promise<void> {
    const since = new Date(Date.now() - AiFeedbackService.DEDUPE_WINDOW_MS);
    const existing = await this.prisma.aiAnswerFeedback.findFirst({
      where: {
        conversationId: input.conversationId,
        source: 'implicit',
        signal: input.signal,
        createdAt: { gte: since },
      },
      select: { id: true },
    });
    if (existing) return;

    const derived = deriveImplicit(input.signal, input.metadata);
    await this.prisma.aiAnswerFeedback.create({
      data: {
        conversationId: input.conversationId,
        messageId: input.messageId ?? null,
        userId: input.userId ?? null,
        source: 'implicit',
        signal: input.signal,
        metadata: (input.metadata ?? undefined) as never,
        failureKind: derived.failureKind,
        resolution: derived.resolution,
        reviewStatus: derived.reviewStatus,
      },
    });
    this.logger.log(
      `[Feedback] implicit conv=${input.conversationId} signal=${input.signal}`,
    );
  }

  /**
   * 重复追问：同用户最近两条消息（不含当前）相似度 >= 0.8 时记录。
   *
   * 用规范化字符集合的 Jaccard，而非 embedding：
   * 这里只要“像不像同一句话”的廉价线索，不值得再调一次模型。
   */
  async recordRepeatedQuestionIfAny(
    conversationId: string,
    userId: string,
    currentMessageId: string,
    currentContent: string,
  ): Promise<void> {
    const recent = await this.prisma.chatMessage.findMany({
      where: {
        conversationId,
        senderId: userId,
        id: { not: currentMessageId },
      },
      orderBy: { seqId: 'desc' },
      take: 1,
      select: { id: true, content: true },
    });
    if (recent.length === 0) return;

    const similarity = jaccard(
      normalize(currentContent),
      normalize(recent[0].content),
    );
    if (similarity < 0.8) return;

    await this.recordImplicit({
      conversationId,
      messageId: currentMessageId,
      userId,
      signal: 'repeated_question',
      metadata: { similarity: Number(similarity.toFixed(2)) },
    });
  }

  /** 找到被评价 AI 消息之前最近一条用户消息，作为回放输入。 */
  private async resolveUserInput(
    conversationId: string,
    messageId?: string,
  ): Promise<string | null> {
    if (!messageId) return null;
    const target = await this.prisma.chatMessage.findUnique({
      where: { id: messageId },
      select: { seqId: true },
    });
    if (!target) return null;
    const prev = await this.prisma.chatMessage.findFirst({
      where: {
        conversationId,
        seqId: { lt: target.seqId },
        source: 'user',
      },
      orderBy: { seqId: 'desc' },
      select: { content: true },
    });
    return prev?.content?.slice(0, 2000) ?? null;
  }

  async list(params: {
    source?: FeedbackSource;
    signal?: FeedbackSignal;
    errorType?: FeedbackErrorType;
    reviewStatus?: 'PENDING' | 'REVIEWED' | 'IGNORED';
    failureKind?: FeedbackFailureKind;
    resolution?: FeedbackResolution;
    queue?: FeedbackQueue;
    from?: string;
    to?: string;
    page?: number;
    pageSize?: number;
  }) {
    const page = Math.max(1, params.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 20));
    const createdAt = buildCreatedAtRange(params);
    const queueWhere =
      params.queue === 'TODO'
        ? actionableFeedbackWhere()
        : params.queue === 'SIGNAL'
          ? signalFeedbackWhere()
          : null;
    const where = {
      ...(params.source ? { source: params.source } : {}),
      ...(params.signal ? { signal: params.signal } : {}),
      ...(params.errorType ? { errorType: params.errorType } : {}),
      ...(params.reviewStatus ? { reviewStatus: params.reviewStatus } : {}),
      ...(params.failureKind ? { failureKind: params.failureKind } : {}),
      ...(params.resolution ? { resolution: params.resolution } : {}),
      ...(createdAt ? { createdAt } : {}),
      ...(queueWhere ? { AND: [queueWhere] } : {}),
    };

    const [list, total] = await this.prisma.$transaction([
      this.prisma.aiAnswerFeedback.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.aiAnswerFeedback.count({ where }),
    ]);

    const withContext = await this.attachMessageContext(list);
    const conversationIds = [
      ...new Set(withContext.map((row) => row.conversationId)),
    ];
    const conversations = conversationIds.length
      ? await this.prisma.conversation.findMany({
          where: { id: { in: conversationIds } },
          select: { id: true, transferReason: true, handlerId: true },
        })
      : [];
    const conversationMap = new Map(
      conversations.map((conversation) => [conversation.id, conversation]),
    );

    return {
      list: withContext.map((row) => ({
        ...row,
        transferReason:
          conversationMap.get(row.conversationId)?.transferReason ?? null,
        handlerId: conversationMap.get(row.conversationId)?.handlerId ?? null,
      })),
      total,
      page,
      pageSize,
    };
  }

  /**
   * 列表默认只带 verdict/signal，分诊时看不出“到底问了什么、AI 答了什么”。
   * 这里按 messageId / createdAt 回查上下文，给前端补 input + answer。
   *
   * 管理端单页最多 100 条，属于低频后台查询；用 Promise.all 并行回查，
   * 避免把 100 条压成串行 N+1。
   */
  private async attachMessageContext<
    T extends {
      conversationId: string;
      messageId: string | null;
      input: string | null;
      source: string;
      createdAt: Date;
    },
  >(rows: T[]) {
    return Promise.all(
      rows.map(async (row) => {
        const linked = row.messageId
          ? await this.prisma.chatMessage.findUnique({
              where: { id: row.messageId },
              select: { content: true, source: true, seqId: true },
            })
          : null;

        let input = row.input;
        let answer: string | null = null;

        if (row.source === 'explicit') {
          // explicit 的 messageId 是被评价的 AI 消息。
          answer = linked?.content ?? null;
          if (!input && linked) {
            const userMessage = await this.prisma.chatMessage.findFirst({
              where: {
                conversationId: row.conversationId,
                source: 'user',
                seqId: { lt: linked.seqId },
              },
              orderBy: { seqId: 'desc' },
              select: { content: true },
            });
            input = userMessage?.content ?? null;
          }
        } else {
          // implicit：messageId 可能是当前用户消息（重复追问），也可能为空。
          if (!input && linked?.source === 'user') input = linked.content;
          if (!input) {
            const userMessage = await this.prisma.chatMessage.findFirst({
              where: {
                conversationId: row.conversationId,
                source: 'user',
                createdAt: { lte: row.createdAt },
              },
              orderBy: { createdAt: 'desc' },
              select: { content: true },
            });
            input = userMessage?.content ?? null;
          }
          const aiMessage = await this.prisma.chatMessage.findFirst({
            where: {
              conversationId: row.conversationId,
              source: 'ai',
              createdAt: { lte: row.createdAt },
            },
            orderBy: { createdAt: 'desc' },
            select: { content: true },
          });
          answer = aiMessage?.content ?? null;
        }

        return { ...row, input, answer };
      }),
    );
  }

  /** 运营首页/质量待办的分组计数。 */
  async summary(query: FeedbackRange = {}) {
    const createdAt = buildCreatedAtRange(query);
    const base = createdAt ? { createdAt } : {};
    const actionable = actionableFeedbackWhere();
    const signal = signalFeedbackWhere();
    const pendingWhere = createdAt
      ? { AND: [{ createdAt }, actionable] }
      : actionable;
    const signalWhere = createdAt ? { AND: [{ createdAt }, signal] } : signal;

    const [total, pending, signals, byFailureKind, byResolution] =
      await Promise.all([
        this.prisma.aiAnswerFeedback.count({ where: base }),
        this.prisma.aiAnswerFeedback.count({ where: pendingWhere as never }),
        this.prisma.aiAnswerFeedback.count({ where: signalWhere as never }),
        this.prisma.aiAnswerFeedback.groupBy({
          by: ['failureKind'],
          where: base,
          _count: { id: true },
        }),
        this.prisma.aiAnswerFeedback.groupBy({
          by: ['resolution'],
          where: base,
          _count: { id: true },
        }),
      ]);
    return {
      total,
      pending,
      signals,
      byFailureKind: byFailureKind.map((row) => ({
        failureKind: row.failureKind,
        count: row._count.id,
      })),
      byResolution: byResolution.map((row) => ({
        resolution: row.resolution,
        count: row._count.id,
      })),
    };
  }

  async updateTriage(
    id: string,
    input: {
      reviewStatus?: 'PENDING' | 'REVIEWED' | 'IGNORED';
      resolution?: FeedbackResolution;
      failureKind?: FeedbackFailureKind;
      verdict?: FeedbackVerdict;
      errorType?: FeedbackErrorType;
      note?: string;
      ownerAdminId?: string;
      linkedEvalCaseId?: string;
    },
    adminId: string,
  ) {
    const existing = await this.prisma.aiAnswerFeedback.findUnique({
      where: { id },
      select: {
        verdict: true,
        failureKind: true,
        resolution: true,
        reviewStatus: true,
      },
    });
    if (!existing) {
      throw new NotFoundException('Feedback not found');
    }

    const nextVerdict = input.verdict ?? existing.verdict;
    const nextFailureKind =
      nextVerdict === 'correct'
        ? null
        : (input.failureKind ?? existing.failureKind);

    // 结论与旧状态必须同时派生，避免 reviewStatus / resolution 分叉（113 §9）。
    let nextResolution: FeedbackResolution | undefined;
    let nextReviewStatus: string | undefined;
    if (input.resolution) {
      nextResolution = input.resolution;
      nextReviewStatus = RESOLUTION_TO_REVIEW_STATUS[input.resolution];
    } else if (input.reviewStatus) {
      nextResolution =
        nextVerdict === 'correct'
          ? 'NO_ISSUE'
          : REVIEW_STATUS_TO_RESOLUTION[input.reviewStatus];
      nextReviewStatus = RESOLUTION_TO_REVIEW_STATUS[nextResolution];
    } else if (input.verdict === 'correct') {
      nextResolution = 'NO_ISSUE';
      nextReviewStatus = 'REVIEWED';
    } else if (input.verdict === 'incorrect' && !existing.resolution) {
      nextResolution = 'OPEN';
      nextReviewStatus = 'PENDING';
    }

    const judgmentProvided = Boolean(
      input.verdict ||
      input.failureKind ||
      input.reviewStatus ||
      input.resolution,
    );
    const judgmentChanged =
      (input.verdict != null && nextVerdict !== existing.verdict) ||
      (input.failureKind != null && nextFailureKind !== existing.failureKind);

    const updated = await this.prisma.aiAnswerFeedback.update({
      where: { id },
      data: {
        ...(nextResolution
          ? { resolution: nextResolution, reviewStatus: nextReviewStatus }
          : {}),
        ...(nextVerdict === 'correct'
          ? { failureKind: null }
          : input.failureKind
            ? { failureKind: input.failureKind }
            : {}),
        ...(input.verdict ? { verdict: input.verdict } : {}),
        ...(input.errorType !== undefined
          ? { errorType: input.errorType ?? null }
          : {}),
        ...(input.note !== undefined ? { note: input.note.slice(0, 500) } : {}),
        ...(input.ownerAdminId !== undefined
          ? { ownerAdminId: input.ownerAdminId }
          : {}),
        ...(input.linkedEvalCaseId !== undefined
          ? { linkedEvalCaseId: input.linkedEvalCaseId }
          : {}),
        ...(judgmentProvided
          ? { reviewedBy: adminId, reviewedAt: new Date() }
          : {}),
      },
    });

    // 只有判定变化才写评分；仅改备注/指派不重复写 HUMAN score。
    if (judgmentChanged) {
      await this.prisma.aiScore
        .create({
          data: {
            conversationId: updated.conversationId,
            messageId: updated.messageId ?? null,
            traceId: updated.traceId ?? null,
            source: 'HUMAN',
            value:
              updated.verdict === 'correct'
                ? 1
                : updated.verdict === 'incorrect'
                  ? 0
                  : null,
            stringValue: updated.failureKind ?? updated.resolution ?? null,
            comment: updated.note ?? null,
            adminId,
            metadata: {
              feedbackId: updated.id,
              resolution: updated.resolution,
              failureKind: updated.failureKind,
            },
          },
        })
        .catch((err) =>
          this.logger.warn(
            `[feedback] score write failed for feedback ${updated.id}: ${err?.message ?? err}`,
          ),
        );
    }

    return updated;
  }
}

function normalize(text: string): Set<string> {
  const cleaned = text.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
  return new Set(Array.from(cleaned));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  for (const ch of a) if (b.has(ch)) intersection += 1;
  return intersection / (a.size + b.size - intersection);
}
