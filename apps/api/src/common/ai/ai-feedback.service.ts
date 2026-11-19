import { Injectable, Logger } from '@nestjs/common';
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

    await this.prisma.aiAnswerFeedback.create({
      data: {
        conversationId: input.conversationId,
        messageId: input.messageId ?? null,
        userId: input.userId ?? null,
        source: 'implicit',
        signal: input.signal,
        metadata: (input.metadata ?? undefined) as never,
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
    page?: number;
    pageSize?: number;
  }) {
    const page = Math.max(1, params.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 20));
    const where = {
      ...(params.source ? { source: params.source } : {}),
      ...(params.signal ? { signal: params.signal } : {}),
      ...(params.errorType ? { errorType: params.errorType } : {}),
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

    return { list, total, page, pageSize };
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
