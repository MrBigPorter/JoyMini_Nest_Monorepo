import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@api/common/prisma/prisma.service';
import { RedisService } from '@api/common/redis/redis.service';

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
 * 单会话 token 配额超限。
 *
 * 与日配额的区别：日配额超限拒绝的是「这个用户今天还能不能继续聊」；
 * 会话配额超限只把「这一条对话」降级为静态回复 + 转人工，
 * 用户开新会话或人工处理后仍可继续。
 */
export class SessionQuotaExceededError extends Error {
  readonly code = 'AI_SESSION_TOKEN_LIMIT_EXCEEDED';

  constructor(
    readonly limit: number,
    readonly used: number,
  ) {
    super(`Session AI token limit exceeded: used ${used}/${limit}`);
    this.name = 'SessionQuotaExceededError';
  }
}

/**
 * 会话配额的日期桶（Asia/Manila，业务时区）。
 * 返回 YYYY-MM-DD；跨天自动切到新 key，旧桶由 TTL 清理。
 */
export function sessionDayKey(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
  }).format(now);
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

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

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

  // ══════════════════════════════════════════════════════════════
  //  会话级配额（reliable-ai-runtime 5.x）
  //
  //  存在 Redis 而不是 DB：
  //    - 只活一条对话的生命周期（TTL 24h），不需要进报表；
  //    - 每条消息都要读，放 Redis 避免给 PG 增加热路径查询。
  //  多实例安全：INCRBY 是原子的，两个副本同时加不会丢计数。
  // ══════════════════════════════════════════════════════════════

  private sessionLimit(): number {
    const raw = process.env.AI_SESSION_TOKEN_LIMIT;
    if (raw === undefined || raw === '') return 50_000;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : 50_000;
  }

  /**
   * 会话配额按「自然日 + 会话」分桶。
   *
   * 旧实现 key 只含 conversationId，并且每条消息都把 TTL 续到 24h：
   * 会话是永久的（ai_chat:{userId}），只要用户每天说话，计数器永远不过期，
   * 攒够阈值后 AI 对该用户永久不可用。日期桶让计数每天归零。
   */
  private sessionKey(
    conversationId: string,
    day: string = sessionDayKey(),
  ): string {
    return `ai:session:tokens:${conversationId}:${day}`;
  }

  /** 会话累计 token 超限抛 SessionQuotaExceededError；limit <= 0 关闭。 */
  async assertWithinSessionQuota(conversationId?: string): Promise<void> {
    if (!conversationId) return;
    const limit = this.sessionLimit();
    if (limit <= 0) return;

    const raw = await this.redis.get(this.sessionKey(conversationId));
    const used = raw ? Number(raw) : 0;
    if (Number.isFinite(used) && used >= limit) {
      this.logger.warn(
        `[AiUsage] session quota exceeded: conv=${conversationId}, used=${used}, limit=${limit}`,
      );
      throw new SessionQuotaExceededError(limit, used);
    }
  }

  /**
   * 累加会话 token 用量。
   * Redis 故障只 warn，不能因为记账失败打断已经完成的对话。
   */
  async recordSessionUsage(
    conversationId: string | undefined,
    totalTokens: number,
  ): Promise<void> {
    if (!conversationId) return;
    const tokens = Math.max(0, Math.trunc(totalTokens));
    if (tokens === 0) return;

    try {
      const key = this.sessionKey(conversationId);
      await this.redis.incrBy(key, tokens);
      // 日期桶本身每天换 key；48h 只是清理旧桶，不再靠续期重置配额。
      await this.redis.expire(key, 48 * 60 * 60);
    } catch (err: any) {
      this.logger.warn(
        `[AiUsage] session usage record failed: conv=${conversationId}, reason=${err?.message ?? err}`,
      );
    }
  }
}
