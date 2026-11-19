import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@api/common/prisma/prisma.service';

/** 日 token 配额超限。调用方应转为人工/友好提示，而不是当成模型故障重试。 */
export class QuotaExceededError extends Error {
  readonly code = 'AI_DAILY_TOKEN_LIMIT_EXCEEDED';

  constructor(
    readonly limit: number,
    readonly used: number,
  ) {
    super(`Daily AI token limit exceeded: used ${used}/${limit}`);
    this.name = 'QuotaExceededError';
  }
}

/**
 * AI token 用量与日配额。
 *
 * 用量按「用户 + UTC 日期」聚合到 ai_usage_daily；
 * 配额默认 200k tokens/天，可用 AI_DAILY_TOKEN_LIMIT 覆盖；
 * 设为 0 或负数时关闭配额（只记录，不拦截）。
 */
@Injectable()
export class AiUsageService {
  private readonly logger = new Logger(AiUsageService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** UTC 当天 00:00，作为 @db.Date 的唯一键。 */
  private todayUtc(): Date {
    const now = new Date();
    return new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
  }

  private dailyLimit(): number {
    const raw = process.env.AI_DAILY_TOKEN_LIMIT;
    if (raw === undefined || raw === '') return 200_000;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : 200_000;
  }

  /**
   * 记录一次对话的 token 用量。
   * 失败只由调用方决定是否吞掉；这里不静默。
   */
  async recordUsage(
    userId: string,
    promptTokens: number,
    completionTokens: number,
    requests = 1,
  ): Promise<void> {
    const prompt = Math.max(0, Math.trunc(promptTokens));
    const completion = Math.max(0, Math.trunc(completionTokens));
    const count = Math.max(0, Math.trunc(requests));
    if (prompt === 0 && completion === 0 && count === 0) return;

    const date = this.todayUtc();
    await this.prisma.aiUsageDaily.upsert({
      where: { userId_date: { userId, date } },
      create: {
        userId,
        date,
        promptTokens: prompt,
        completionTokens: completion,
        totalTokens: prompt + completion,
        requests: count,
      },
      update: {
        promptTokens: { increment: prompt },
        completionTokens: { increment: completion },
        totalTokens: { increment: prompt + completion },
        requests: { increment: count },
      },
    });
  }

  async getTodayUsage(userId: string): Promise<{
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    requests: number;
  } | null> {
    const usage = await this.prisma.aiUsageDaily.findUnique({
      where: { userId_date: { userId, date: this.todayUtc() } },
      select: {
        promptTokens: true,
        completionTokens: true,
        totalTokens: true,
        requests: true,
      },
    });
    return usage ?? null;
  }

  /**
   * 配额检查。超限抛 QuotaExceededError；limit <= 0 表示关闭配额。
   */
  async assertWithinQuota(userId: string): Promise<void> {
    const limit = this.dailyLimit();
    if (limit <= 0) return;

    const usage = await this.getTodayUsage(userId);
    if (usage && usage.totalTokens >= limit) {
      this.logger.warn(
        `[AiUsage] quota exceeded: userId=${userId}, used=${usage.totalTokens}, limit=${limit}`,
      );
      throw new QuotaExceededError(limit, usage.totalTokens);
    }
  }
}
