import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '@api/common/prisma/prisma.service';
import { RedisLockService } from '@api/common/redis/redis-lock.service';
import { redactPiiText } from '@api/common/utils/pii-redaction';
import { AiEvalDatasetService } from '@api/admin/ai-eval/ai-eval-dataset.service';

export type ProblemEventType =
  | 'EXPLICIT_NEGATIVE'
  | 'SERVICE_ERROR'
  | 'ZERO_HIT'
  | 'REPEATED_QUESTION'
  | 'USER_ABANDONED'
  | 'UNEXPECTED_TRANSFER'
  | 'EVAL_UNSOLVED'
  | 'SECURITY_HIT';

interface EventDraft {
  occurredAt: Date;
  type: ProblemEventType;
  severity: number;
  confidence: number;
  source: string;
  sourceId: string;
  conversationId?: string | null;
  messageId?: string | null;
  traceId?: string | null;
  intent?: string | null;
  domain?: string | null;
  failureKind?: string | null;
  metadata?: Record<string, unknown> | null;
}

interface MetricDraft {
  metric: string;
  dimension: 'ALL' | 'INTENT';
  dimensionValue: string;
  numerator: number;
  denominator: number;
}

@Injectable()
export class AiAnalysisService {
  private readonly logger = new Logger(AiAnalysisService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly locks: RedisLockService,
    private readonly evalDatasets: AiEvalDatasetService,
  ) {}

  /** 手动/定时跑一个 UTC 日窗口；幂等，可重跑覆盖同一窗口。 */
  async runWindow(date?: string, createdBy?: string) {
    const window = this.resolveWindow(date);
    try {
      return await this.locks.runWithLock(
        `ai:analysis:${window.start.toISOString()}`,
        30 * 60 * 1000,
        () => this.executeWindow(window, createdBy),
        true,
      );
    } catch (err: any) {
      if (String(err?.message ?? '').startsWith('Lock busy')) {
        throw new ConflictException('Another analysis run is in progress');
      }
      throw err;
    }
  }

  private async executeWindow(
    window: { start: Date; end: Date },
    createdBy?: string,
  ) {
    const run = await this.prisma.aiAnalysisRun.upsert({
      where: {
        jobType_windowStart: {
          jobType: 'EVENT_BUILD',
          windowStart: window.start,
        },
      },
      create: {
        jobType: 'EVENT_BUILD',
        windowStart: window.start,
        windowEnd: window.end,
        status: 'RUNNING',
        metadata: { createdBy: createdBy ?? null },
      },
      update: {
        status: 'RUNNING',
        startedAt: new Date(),
        finishedAt: null,
        error: null,
        processed: 0,
        createdEvents: 0,
      },
    });

    try {
      const events = await this.collectEvents(window.start, window.end);
      await this.persistEvents(window.start, events);
      const createdClusters = await this.clusterWindow(window.start);
      const metrics = await this.collectMetrics(
        window.start,
        window.end,
        events,
      );
      await this.persistMetrics(window.start, metrics);
      await this.evaluateAlerts(window.start, metrics);
      return await this.prisma.aiAnalysisRun.update({
        where: { id: run.id },
        data: {
          status: 'COMPLETED',
          finishedAt: new Date(),
          processed: events.length,
          createdEvents: events.length,
          createdClusters,
        },
      });
    } catch (err: any) {
      await this.prisma.aiAnalysisRun.update({
        where: { id: run.id },
        data: {
          status: 'FAILED',
          finishedAt: new Date(),
          error: String(err?.message ?? err).slice(0, 1000),
        },
      });
      throw err;
    }
  }

  /** 每天 02:00 UTC 跑前一天；拿不到锁直接跳过。 */
  @Cron('0 2 * * *', { timeZone: 'UTC' })
  async dailyRun() {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    try {
      await this.runWindow(yesterday, 'system');
    } catch (err: any) {
      this.logger.warn(`[analysis] daily run failed: ${err?.message ?? err}`);
    }
  }

  async listRuns(limit = 20) {
    return this.prisma.aiAnalysisRun.findMany({
      orderBy: { windowStart: 'desc' },
      take: Math.min(Math.max(limit, 1), 100),
    });
  }

  async listMetrics(date?: string) {
    const window = date ? this.resolveWindow(date) : await this.latestWindow();
    if (!window) return { windowStart: null, metrics: [] };
    const metrics = await this.prisma.aiMetricWindow.findMany({
      where: { windowStart: window.start, windowType: 'DAY' },
      orderBy: [{ metric: 'asc' }, { dimension: 'asc' }],
    });
    return { windowStart: window.start, metrics };
  }

  async listEvents(input: {
    date?: string;
    type?: string;
    page?: number;
    pageSize?: number;
  }) {
    const window = input.date
      ? this.resolveWindow(input.date)
      : await this.latestWindow();
    if (!window) return { windowStart: null, list: [], total: 0 };
    const page = Math.max(1, input.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, input.pageSize ?? 20));
    const where = {
      windowStart: window.start,
      ...(input.type ? { type: input.type } : {}),
    };
    const [list, total] = await Promise.all([
      this.prisma.aiProblemEvent.findMany({
        where,
        orderBy: [{ severity: 'desc' }, { occurredAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.aiProblemEvent.count({ where }),
    ]);
    return { windowStart: window.start, list, total, page, pageSize };
  }

  private resolveWindow(date?: string) {
    const day = date?.trim() || new Date().toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
      throw new BadRequestException('date must be YYYY-MM-DD');
    }
    const start = new Date(`${day}T00:00:00.000Z`);
    if (Number.isNaN(start.getTime())) {
      throw new BadRequestException('invalid date');
    }
    return { start, end: new Date(start.getTime() + 24 * 60 * 60 * 1000) };
  }

  private async latestWindow() {
    const latest = await this.prisma.aiAnalysisRun.findFirst({
      where: { status: 'COMPLETED' },
      orderBy: { windowStart: 'desc' },
      select: { windowStart: true },
    });
    return latest ? { start: latest.windowStart } : null;
  }

  private async collectEvents(start: Date, end: Date): Promise<EventDraft[]> {
    const events: EventDraft[] = [];

    const feedback = await this.prisma.aiAnswerFeedback.findMany({
      where: { createdAt: { gte: start, lt: end } },
      select: {
        id: true,
        conversationId: true,
        messageId: true,
        traceId: true,
        source: true,
        verdict: true,
        signal: true,
        failureKind: true,
        input: true,
        createdAt: true,
      },
    });
    const feedbackTraceIds = new Set<string>();
    for (const row of feedback) {
      if (row.traceId) feedbackTraceIds.add(row.traceId);
      const preview = redactPiiText(row.input)?.slice(0, 200) ?? null;
      const base = {
        occurredAt: row.createdAt,
        source: 'feedback',
        sourceId: row.id,
        conversationId: row.conversationId,
        messageId: row.messageId ?? null,
        traceId: row.traceId ?? null,
        failureKind: row.failureKind ?? null,
        metadata: preview ? { questionPreview: preview } : null,
      };
      if (row.failureKind === 'SERVICE_ERROR') {
        events.push({
          ...base,
          type: 'SERVICE_ERROR',
          severity: 3,
          confidence: 0.95,
        });
        continue;
      }
      if (row.source === 'explicit' && row.verdict === 'incorrect') {
        events.push({
          ...base,
          type: 'EXPLICIT_NEGATIVE',
          severity: 3,
          confidence: 0.9,
        });
        continue;
      }
      if (row.signal === 'repeated_question') {
        events.push({
          ...base,
          type: 'REPEATED_QUESTION',
          severity: 2,
          confidence: 0.6,
        });
        continue;
      }
      if (row.signal === 'abandoned') {
        events.push({
          ...base,
          type: 'USER_ABANDONED',
          severity: 1,
          confidence: 0.6,
        });
        continue;
      }
      if (row.failureKind === 'UNEXPECTED_TRANSFER') {
        events.push({
          ...base,
          type: 'UNEXPECTED_TRANSFER',
          severity: 2,
          confidence: 0.7,
        });
      }
    }

    const traces = await this.prisma.aiTrace.findMany({
      where: { createdAt: { gte: start, lt: end } },
      select: {
        id: true,
        conversationId: true,
        triggerMessageId: true,
        intent: true,
        status: true,
        input: true,
        createdAt: true,
        spans: { select: { type: true, output: true } },
      },
    });
    for (const trace of traces) {
      const preview = redactPiiText(trace.input)?.slice(0, 200) ?? null;
      const base = {
        occurredAt: trace.createdAt,
        source: 'trace',
        sourceId: trace.id,
        conversationId: trace.conversationId,
        messageId: trace.triggerMessageId ?? null,
        traceId: trace.id,
        intent: trace.intent ?? null,
        metadata: preview ? { questionPreview: preview } : null,
      };
      if (trace.status === 'ERROR' && !feedbackTraceIds.has(trace.id)) {
        events.push({
          ...base,
          type: 'SERVICE_ERROR',
          severity: 3,
          confidence: 0.95,
        });
      }
      const rag = trace.spans.find((span) => span.type === 'rag');
      const sourceCount = (rag?.output as Record<string, unknown> | null)
        ?.sourceCount;
      if (typeof sourceCount === 'number' && sourceCount === 0) {
        events.push({
          ...base,
          type: 'ZERO_HIT',
          severity: 1,
          confidence: 0.7,
        });
      }
    }

    const security = await this.prisma.aiSecurityEvent.findMany({
      where: { createdAt: { gte: start, lt: end }, status: 'NEW' },
      select: {
        id: true,
        conversationId: true,
        type: true,
        createdAt: true,
      },
    });
    for (const row of security) {
      events.push({
        occurredAt: row.createdAt,
        type: 'SECURITY_HIT',
        severity: 2,
        confidence: 0.4,
        source: 'security',
        sourceId: row.id,
        conversationId: row.conversationId ?? null,
        metadata: { securityType: row.type },
      });
    }

    const evalResults = await this.prisma.aiEvalResult.findMany({
      where: {
        createdAt: { gte: start, lt: end },
        verdict: 'unsolved',
      },
      select: {
        id: true,
        runId: true,
        caseId: true,
        createdAt: true,
        case: { select: { expect: true, expected: true } },
      },
    });
    for (const row of evalResults) {
      const hasExpectation =
        this.hasKeys(row.case?.expect) ||
        (typeof row.case?.expected === 'string' &&
          row.case.expected.trim().length > 0) ||
        this.hasKeys(row.case?.expected);
      if (!hasExpectation) continue;
      events.push({
        occurredAt: row.createdAt,
        type: 'EVAL_UNSOLVED',
        severity: 2,
        confidence: 0.7,
        source: 'eval',
        sourceId: row.id,
        metadata: { runId: row.runId, caseId: row.caseId },
      });
    }

    return events;
  }

  private async persistEvents(
    windowStart: Date,
    events: EventDraft[],
  ): Promise<void> {
    for (const chunk of this.chunk(events, 100)) {
      await this.prisma.$transaction(
        chunk.map((event) =>
          this.prisma.aiProblemEvent.upsert({
            where: {
              type_sourceId: {
                type: event.type,
                sourceId: event.sourceId,
              },
            },
            create: {
              occurredAt: event.occurredAt,
              windowStart,
              windowType: 'DAY',
              type: event.type,
              severity: event.severity,
              confidence: event.confidence,
              source: event.source,
              sourceId: event.sourceId,
              conversationId: event.conversationId ?? null,
              messageId: event.messageId ?? null,
              traceId: event.traceId ?? null,
              intent: event.intent ?? null,
              domain: event.domain ?? null,
              failureKind: event.failureKind ?? null,
              metadata: (event.metadata ?? undefined) as never,
            },
            update: {
              occurredAt: event.occurredAt,
              severity: event.severity,
              confidence: event.confidence,
              conversationId: event.conversationId ?? null,
              messageId: event.messageId ?? null,
              traceId: event.traceId ?? null,
              intent: event.intent ?? null,
              domain: event.domain ?? null,
              failureKind: event.failureKind ?? null,
              metadata: (event.metadata ?? undefined) as never,
            },
          }),
        ),
      );
    }
  }

  private async collectMetrics(
    start: Date,
    end: Date,
    events: EventDraft[],
  ): Promise<MetricDraft[]> {
    const [replies, ragEligible, conversations, tracesByIntent] =
      await Promise.all([
        this.prisma.aiTrace.count({
          where: { createdAt: { gte: start, lt: end } },
        }),
        this.prisma.aiTrace.count({
          where: {
            createdAt: { gte: start, lt: end },
            spans: { some: { type: 'rag' } },
          },
        }),
        this.prisma.conversation.count({
          where: { createdAt: { gte: start, lt: end } },
        }),
        this.prisma.aiTrace.groupBy({
          by: ['intent'],
          where: {
            createdAt: { gte: start, lt: end },
            intent: { not: null },
          },
          _count: { id: true },
        }),
      ]);

    const counts = this.countByType(events);
    const rows: MetricDraft[] = [];
    const add = (
      metric: string,
      dimension: MetricDraft['dimension'],
      dimensionValue: string,
      numerator: number,
      denominator: number,
    ) =>
      rows.push({ metric, dimension, dimensionValue, numerator, denominator });

    add('problem_rate', 'ALL', 'ALL', events.length, replies);
    add('service_error_rate', 'ALL', 'ALL', counts.SERVICE_ERROR ?? 0, replies);
    add(
      'zero_hit_rate',
      'ALL',
      'ALL',
      counts.ZERO_HIT ?? 0,
      ragEligible,
    );
    add(
      'explicit_negative_rate',
      'ALL',
      'ALL',
      counts.EXPLICIT_NEGATIVE ?? 0,
      replies,
    );
    add(
      'repeat_rate',
      'ALL',
      'ALL',
      counts.REPEATED_QUESTION ?? 0,
      conversations,
    );

    const eventsByIntent = new Map<string, number>();
    for (const event of events) {
      if (!event.intent) continue;
      eventsByIntent.set(
        event.intent,
        (eventsByIntent.get(event.intent) ?? 0) + 1,
      );
    }
    for (const row of tracesByIntent) {
      if (!row.intent) continue;
      const denominator = row._count.id;
      add(
        'problem_rate',
        'INTENT',
        row.intent,
        eventsByIntent.get(row.intent) ?? 0,
        denominator,
      );
    }
    return rows;
  }

  private async persistMetrics(
    windowStart: Date,
    metrics: MetricDraft[],
  ): Promise<void> {
    await this.prisma.aiMetricWindow.deleteMany({
      where: { windowStart, windowType: 'DAY' },
    });
    if (metrics.length === 0) return;
    await this.prisma.aiMetricWindow.createMany({
      data: metrics.map((row) => ({
        windowStart,
        windowType: 'DAY',
        metric: row.metric,
        dimension: row.dimension,
        dimensionValue: row.dimensionValue,
        numerator: row.numerator,
        denominator: row.denominator,
        value:
          row.denominator > 0
            ? Number((row.numerator / row.denominator).toFixed(4))
            : 0,
        sampleSize: row.denominator,
      })),
    });
  }

  /** 每小时刷新当天窗口，让问题簇/指标不必等到第二天。 */
  @Cron('5 * * * *', { timeZone: 'UTC' })
  async hourlyRun(): Promise<void> {
    const today = new Date().toISOString().slice(0, 10);
    try {
      await this.runWindow(today, 'system');
    } catch (err: any) {
      this.logger.warn(
        `[analysis] hourly run failed: ${err?.message ?? err}`,
      );
    }
  }

  /** 按签名聚类；重复跑同一窗口只会覆盖计数，不累加。 */
  private async clusterWindow(windowStart: Date): Promise<number> {
    const rows = await this.prisma.aiProblemEvent.findMany({
      where: { windowStart },
      select: {
        id: true,
        type: true,
        intent: true,
        domain: true,
        severity: true,
        occurredAt: true,
        metadata: true,
      },
    });

    const groups = new Map<
      string,
      {
        preview: string;
        ids: string[];
        types: Set<string>;
        severity: number;
        intent?: string;
        domain?: string;
        first: Date;
        last: Date;
      }
    >();

    for (const row of rows) {
      const metadata = row.metadata as Record<string, unknown> | null;
      const raw = metadata?.questionPreview;
      if (typeof raw !== 'string') continue;
      const preview = raw.trim();
      if (!preview) continue;
      const normalized = preview
        .toLowerCase()
        .replace(/[\s\p{P}\p{S}]+/gu, '');
      if (!normalized) continue;
      const signature = createHash('sha256')
        .update(normalized)
        .digest('hex')
        .slice(0, 64);
      const existing = groups.get(signature);
      if (existing) {
        existing.ids.push(row.id);
        existing.types.add(row.type);
        existing.severity = Math.max(existing.severity, row.severity);
        existing.intent = existing.intent ?? row.intent ?? undefined;
        existing.domain = existing.domain ?? row.domain ?? undefined;
        if (row.occurredAt < existing.first) existing.first = row.occurredAt;
        if (row.occurredAt > existing.last) existing.last = row.occurredAt;
      } else {
        groups.set(signature, {
          preview,
          ids: [row.id],
          types: new Set([row.type]),
          severity: row.severity,
          intent: row.intent ?? undefined,
          domain: row.domain ?? undefined,
          first: row.occurredAt,
          last: row.occurredAt,
        });
      }
    }

    for (const [signature, group] of groups) {
      const cluster = await this.prisma.aiProblemCluster.upsert({
        where: { signature },
        create: {
          signature,
          representativeText: group.preview,
          count: 0,
          severity: group.severity,
          intent: group.intent ?? null,
          domain: group.domain ?? null,
          suggestedCause: this.suggestCause(group.types),
          firstSeenAt: group.first,
          lastSeenAt: group.last,
        },
        update: {
          severity: group.severity,
          lastSeenAt: group.last,
          suggestedCause: this.suggestCause(group.types),
          ...(group.intent ? { intent: group.intent } : {}),
          ...(group.domain ? { domain: group.domain } : {}),
        },
      });

      await this.prisma.aiProblemEvent.updateMany({
        where: { id: { in: group.ids } },
        data: { clusterId: cluster.id },
      });

      const total = await this.prisma.aiProblemEvent.count({
        where: { clusterId: cluster.id },
      });
      await this.prisma.aiProblemCluster.update({
        where: { id: cluster.id },
        data: { count: total },
      });

      await this.prisma.aiProblemClusterDay.upsert({
        where: {
          clusterId_day: { clusterId: cluster.id, day: windowStart },
        },
        create: {
          clusterId: cluster.id,
          day: windowStart,
          count: group.ids.length,
        },
        update: { count: group.ids.length },
      });
    }

    return groups.size;
  }

  private suggestCause(types: Set<string>): string {
    if (types.has('SERVICE_ERROR')) return 'SERVICE';
    if (types.has('ZERO_HIT')) return 'KNOWLEDGE_GAP';
    if (types.has('UNEXPECTED_TRANSFER')) return 'ROUTING';
    if (types.has('EVAL_UNSOLVED')) return 'MODEL';
    if (types.has('SECURITY_HIT')) return 'SECURITY';
    if (types.has('USER_ABANDONED') || types.has('REPEATED_QUESTION')) {
      return 'UX';
    }
    if (types.has('EXPLICIT_NEGATIVE')) return 'MODEL';
    return 'UNKNOWN';
  }

  /** 与过去 7 天同指标均值比较；样本太少不告警。 */
  private async evaluateAlerts(
    windowStart: Date,
    metrics: MetricDraft[],
  ): Promise<void> {
    const candidates = metrics.filter(
      (row) => row.dimension === 'ALL' && row.denominator >= 5,
    );
    for (const row of candidates) {
      const previous = await this.prisma.aiMetricWindow.findMany({
        where: {
          metric: row.metric,
          dimension: row.dimension,
          dimensionValue: row.dimensionValue,
          windowStart: { lt: windowStart },
          windowType: 'DAY',
        },
        orderBy: { windowStart: 'desc' },
        take: 7,
        select: { value: true },
      });
      if (previous.length < 3) continue;
      const baseline =
        previous.reduce((sum, item) => sum + item.value, 0) /
        previous.length;
      const value =
        row.denominator > 0 ? row.numerator / row.denominator : 0;
      if (value <= 0.05) continue;
      if (value <= baseline * 1.5 && value < 0.2) continue;
      const severity = value > Math.max(baseline * 2, 0.3) ? 'HIGH' : 'MEDIUM';
      const message = `${row.metric} ${(value * 100).toFixed(1)}% 高于近 7 天基线 ${(baseline * 100).toFixed(1)}%（样本 ${row.denominator}）`;
      await this.prisma.aiAnalysisAlert.upsert({
        where: {
          windowStart_metric_dimension_dimensionValue: {
            windowStart,
            metric: row.metric,
            dimension: row.dimension,
            dimensionValue: row.dimensionValue,
          },
        },
        create: {
          windowStart,
          metric: row.metric,
          dimension: row.dimension,
          dimensionValue: row.dimensionValue,
          value,
          baseline,
          sampleSize: row.denominator,
          severity,
          message,
        },
        update: {
          value,
          baseline,
          sampleSize: row.denominator,
          severity,
          message,
        },
      });
    }
  }

  async listClusters(input: {
    status?: string;
    page?: number;
    pageSize?: number;
  }) {
    const page = Math.max(1, input.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, input.pageSize ?? 20));
    const where = input.status ? { status: input.status } : {};
    const [list, total] = await Promise.all([
      this.prisma.aiProblemCluster.findMany({
        where,
        orderBy: [{ severity: 'desc' }, { count: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.aiProblemCluster.count({ where }),
    ]);
    return { list, total, page, pageSize };
  }

  async getCluster(id: string) {
    const cluster = await this.prisma.aiProblemCluster.findUnique({
      where: { id },
    });
    if (!cluster) throw new BadRequestException('Cluster not found');
    const days = await this.prisma.aiProblemClusterDay.findMany({
      where: { clusterId: id },
      orderBy: { day: 'asc' },
      take: 30,
    });
    return { ...cluster, days };
  }

  async updateCluster(
    id: string,
    input: {
      status?: string;
      ownerAdminId?: string | null;
      fixType?: string | null;
      suggestedCause?: string | null;
    },
  ) {
    const allowedStatus = [
      'NEW',
      'ASSIGNED',
      'FIXING',
      'VERIFYING',
      'CLOSED',
      'IGNORED',
    ];
    if (input.status && !allowedStatus.includes(input.status)) {
      throw new BadRequestException('invalid cluster status');
    }
    const existing = await this.prisma.aiProblemCluster.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing) throw new BadRequestException('Cluster not found');
    await this.prisma.aiProblemCluster.update({
      where: { id },
      data: {
        ...(input.status ? { status: input.status } : {}),
        ...(input.ownerAdminId !== undefined
          ? { ownerAdminId: input.ownerAdminId }
          : {}),
        ...(input.fixType !== undefined ? { fixType: input.fixType } : {}),
        ...(input.suggestedCause !== undefined
          ? { suggestedCause: input.suggestedCause }
          : {}),
      },
    });
    return this.getCluster(id);
  }

  async createRegressionFromCluster(
    id: string,
    datasetId: string,
    expected: string,
  ) {
    const cluster = await this.prisma.aiProblemCluster.findUnique({
      where: { id },
      select: { id: true, representativeText: true },
    });
    if (!cluster) throw new BadRequestException('Cluster not found');
    if (!expected.trim()) {
      throw new BadRequestException('expected answer is required');
    }
    await this.evalDatasets.addCases(datasetId, {
      cases: [
        {
          question: cluster.representativeText,
          answer: '',
          expect: { mustMention: [expected.trim()] },
          expected: expected.trim(),
          source: 'cluster',
          metadata: { clusterId: id },
          tags: ['from-cluster'],
        },
      ],
    });
    await this.prisma.aiProblemCluster.update({
      where: { id },
      data: { status: 'FIXING' },
    });
    return this.getCluster(id);
  }

  async listAlerts(input: {
    status?: string;
    page?: number;
    pageSize?: number;
  }) {
    const page = Math.max(1, input.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, input.pageSize ?? 20));
    const where = input.status ? { status: input.status } : {};
    const [list, total] = await Promise.all([
      this.prisma.aiAnalysisAlert.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.aiAnalysisAlert.count({ where }),
    ]);
    return { list, total, page, pageSize };
  }

  async ackAlert(id: string) {
    const existing = await this.prisma.aiAnalysisAlert.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing) throw new BadRequestException('Alert not found');
    return this.prisma.aiAnalysisAlert.update({
      where: { id },
      data: { status: 'ACK' },
    });
  }

  /** Phase 5：事件 180 天、运行 90 天、簇日 365 天、告警 180 天。 */
  @Cron('0 4 * * *', { timeZone: 'UTC' })
  async purgeExpired(): Promise<void> {
    const now = Date.now();
    const daysAgo = (days: number) =>
      new Date(now - days * 24 * 60 * 60 * 1000);
    try {
      await this.prisma.aiProblemEvent.deleteMany({
        where: { occurredAt: { lt: daysAgo(180) } },
      });
      await this.prisma.aiAnalysisRun.deleteMany({
        where: { startedAt: { lt: daysAgo(90) } },
      });
      await this.prisma.aiProblemClusterDay.deleteMany({
        where: { day: { lt: daysAgo(365) } },
      });
      await this.prisma.aiAnalysisAlert.deleteMany({
        where: { createdAt: { lt: daysAgo(180) } },
      });
    } catch (err: any) {
      this.logger.warn(
        `[analysis] retention purge failed: ${err?.message ?? err}`,
      );
    }
  }

  private countByType(
    events: EventDraft[],
  ): Partial<Record<ProblemEventType, number>> {
    const counts: Partial<Record<ProblemEventType, number>> = {};
    for (const event of events) {
      counts[event.type] = (counts[event.type] ?? 0) + 1;
    }
    return counts;
  }

  private hasKeys(value: unknown): boolean {
    return (
      !!value &&
      typeof value === 'object' &&
      Object.keys(value as Record<string, unknown>).length > 0
    );
  }

  private chunk<T>(items: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < items.length; i += size) {
      chunks.push(items.slice(i, i + size));
    }
    return chunks;
  }
}
