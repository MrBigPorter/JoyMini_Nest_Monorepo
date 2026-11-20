import { Injectable } from '@nestjs/common';
import { PrismaService } from '@api/common/prisma/prisma.service';
import { QueryAiUsageDto } from './dto/query-ai-usage.dto';

const DEFAULT_DAYS = 30;

@Injectable()
export class AiUsageService {
  constructor(private readonly prisma: PrismaService) {}

  async summary(from?: string, to?: string) {
    const range = this.parseRange(from, to);
    const where = { date: { gte: range.from, lte: range.to } };

    const [totals, daily, distinctUsers] = await Promise.all([
      this.prisma.aiUsageDaily.aggregate({
        where,
        _sum: {
          promptTokens: true,
          completionTokens: true,
          totalTokens: true,
          requests: true,
        },
      }),
      this.prisma.aiUsageDaily.groupBy({
        by: ['date'],
        where,
        _sum: {
          promptTokens: true,
          completionTokens: true,
          totalTokens: true,
          requests: true,
        },
        orderBy: { date: 'asc' },
      }),
      this.prisma.aiUsageDaily.findMany({
        where,
        distinct: ['userId'],
        select: { userId: true },
      }),
    ]);

    const dailyLimit = this.numberEnv('AI_DAILY_TOKEN_LIMIT', 200_000);
    const sessionLimit = this.numberEnv('AI_SESSION_TOKEN_LIMIT', 50_000);
    const dailyCostLimit = this.numberEnv('AI_DAILY_COST_LIMIT', 0);
    const pricing = this.getPricing();
    const cost = this.calculateCost(
      totals._sum.promptTokens ?? 0,
      totals._sum.completionTokens ?? 0,
      pricing,
    );

    return {
      range: {
        from: range.from.toISOString().slice(0, 10),
        to: range.to.toISOString().slice(0, 10),
        timezone: 'UTC',
      },
      coverage: {
        scope: 'ai-customer-main-path',
        note: '仅 AI 客服主链路、成功流、UTC 日期；不含 blog-ai / embedding / eval / 失败或取消流。',
      },
      totals: {
        promptTokens: totals._sum.promptTokens ?? 0,
        completionTokens: totals._sum.completionTokens ?? 0,
        totalTokens: totals._sum.totalTokens ?? 0,
        requests: totals._sum.requests ?? 0,
        users: distinctUsers.length,
      },
      pricing,
      cost,
      quota: {
        dailyTokenLimit: dailyLimit,
        sessionTokenLimit: sessionLimit,
        dailyCostLimit,
      },
      daily: daily.map((row) => ({
        date: row.date.toISOString().slice(0, 10),
        promptTokens: row._sum.promptTokens ?? 0,
        completionTokens: row._sum.completionTokens ?? 0,
        totalTokens: row._sum.totalTokens ?? 0,
        requests: row._sum.requests ?? 0,
        ...this.calculateCost(
          row._sum.promptTokens ?? 0,
          row._sum.completionTokens ?? 0,
          pricing,
        ),
      })),
    };
  }

  async users(query: QueryAiUsageDto) {
    const range = this.parseRange(query.from, query.to);
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where: any = { date: { gte: range.from, lte: range.to } };

    if (query.keyword?.trim()) {
      const keyword = query.keyword.trim();
      const matched = await this.prisma.user.findMany({
        where: {
          OR: [
            { nickname: { contains: keyword, mode: 'insensitive' } },
            { phone: { contains: keyword } },
            { id: keyword },
          ],
        },
        select: { id: true },
        take: 200,
      });
      if (matched.length === 0) {
        return { list: [], total: 0, page, pageSize };
      }
      where.userId = { in: matched.map((u) => u.id) };
    }

    const [groups, distinctUsers] = await Promise.all([
      this.prisma.aiUsageDaily.groupBy({
        by: ['userId'],
        where,
        _sum: {
          promptTokens: true,
          completionTokens: true,
          totalTokens: true,
          requests: true,
        },
        orderBy: { _sum: { totalTokens: 'desc' } },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.aiUsageDaily.findMany({
        where,
        distinct: ['userId'],
        select: { userId: true },
      }),
    ]);

    const pageUserIds = groups.map((g) => g.userId);
    const [users, dailyRows] = await Promise.all([
      this.prisma.user.findMany({
        where: { id: { in: pageUserIds } },
        select: { id: true, nickname: true, phone: true, avatar: true },
      }),
      pageUserIds.length > 0
        ? this.prisma.aiUsageDaily.groupBy({
            by: ['userId', 'date'],
            where: { ...where, userId: { in: pageUserIds } },
            _sum: { totalTokens: true },
          })
        : Promise.resolve([] as Array<{ userId: string; _sum: any }>),
    ]);
    const userMap = new Map(users.map((u) => [u.id, u]));
    const maxDailyByUser = new Map<string, number>();
    for (const row of dailyRows) {
      const dayTokens = row._sum.totalTokens ?? 0;
      const current = maxDailyByUser.get(row.userId) ?? 0;
      if (dayTokens > current) maxDailyByUser.set(row.userId, dayTokens);
    }
    const dailyLimit = this.numberEnv('AI_DAILY_TOKEN_LIMIT', 200_000);

    return {
      list: groups.map((g) => {
        const user = userMap.get(g.userId);
        const totalTokens = g._sum.totalTokens ?? 0;
        const maxDailyTokens = maxDailyByUser.get(g.userId) ?? 0;
        const cost = this.calculateCost(
          g._sum.promptTokens ?? 0,
          g._sum.completionTokens ?? 0,
        );
        return {
          userId: g.userId,
          nickname: user?.nickname ?? null,
          phoneMasked: this.maskPhone(user?.phone),
          avatar: user?.avatar ?? null,
          promptTokens: g._sum.promptTokens ?? 0,
          completionTokens: g._sum.completionTokens ?? 0,
          totalTokens,
          requests: g._sum.requests ?? 0,
          maxDailyTokens,
          estimatedCost: cost.totalCost,
          costCurrency: cost.currency,
          overDailyLimit: dailyLimit > 0 && maxDailyTokens >= dailyLimit,
        };
      }),
      total: distinctUsers.length,
      page,
      pageSize,
    };
  }

  async userDetail(userId: string, from?: string, to?: string) {
    const range = this.parseRange(from, to);
    const where = {
      userId,
      date: { gte: range.from, lte: range.to },
    };
    const [user, rows, totals] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, nickname: true, phone: true, avatar: true },
      }),
      this.prisma.aiUsageDaily.findMany({
        where,
        orderBy: { date: 'asc' },
        select: {
          date: true,
          promptTokens: true,
          completionTokens: true,
          totalTokens: true,
          requests: true,
        },
      }),
      this.prisma.aiUsageDaily.aggregate({
        where,
        _sum: {
          promptTokens: true,
          completionTokens: true,
          totalTokens: true,
          requests: true,
        },
      }),
    ]);

    const dailyLimit = this.numberEnv('AI_DAILY_TOKEN_LIMIT', 200_000);
    return {
      user: user
        ? { ...user, phone: this.maskPhone(user.phone) }
        : { id: userId },
      totals: {
        promptTokens: totals._sum.promptTokens ?? 0,
        completionTokens: totals._sum.completionTokens ?? 0,
        totalTokens: totals._sum.totalTokens ?? 0,
        requests: totals._sum.requests ?? 0,
      },
      cost: this.calculateCost(
        totals._sum.promptTokens ?? 0,
        totals._sum.completionTokens ?? 0,
      ),
      quota: { dailyTokenLimit: dailyLimit },
      daily: rows.map((row) => ({
        date: row.date.toISOString().slice(0, 10),
        promptTokens: row.promptTokens,
        completionTokens: row.completionTokens,
        totalTokens: row.totalTokens,
        requests: row.requests,
        overDailyLimit: dailyLimit > 0 && row.totalTokens >= dailyLimit,
      })),
    };
  }

  private parseRange(from?: string, to?: string) {
    const end = to ? new Date(`${to}T23:59:59.999Z`) : new Date();
    const start = from
      ? new Date(`${from}T00:00:00.000Z`)
      : new Date(end.getTime() - DEFAULT_DAYS * 24 * 60 * 60 * 1000);
    return { from: start, to: end };
  }

  private getPricing() {
    const inputPer1M = this.numberEnv('AI_PRICE_INPUT_PER_1M', 0);
    const outputPer1M = this.numberEnv('AI_PRICE_OUTPUT_PER_1M', 0);
    return {
      inputPer1M,
      outputPer1M,
      currency: process.env.AI_COST_CURRENCY ?? 'USD',
      configured: inputPer1M > 0 || outputPer1M > 0,
    };
  }

  private calculateCost(
    promptTokens: number,
    completionTokens: number,
    pricing = this.getPricing(),
  ) {
    const inputCost = (promptTokens / 1_000_000) * pricing.inputPer1M;
    const outputCost = (completionTokens / 1_000_000) * pricing.outputPer1M;
    return {
      inputCost: Number(inputCost.toFixed(6)),
      outputCost: Number(outputCost.toFixed(6)),
      totalCost: Number((inputCost + outputCost).toFixed(6)),
      currency: pricing.currency,
      configured: pricing.configured,
    };
  }

  private numberEnv(key: string, fallback: number): number {
    const value = Number(process.env[key]);
    return Number.isFinite(value) ? value : fallback;
  }

  private maskPhone(phone?: string | null): string | null {
    if (!phone) return null;
    if (phone.length <= 4) return '****';
    return `${phone.slice(0, 3)}****${phone.slice(-4)}`;
  }
}
