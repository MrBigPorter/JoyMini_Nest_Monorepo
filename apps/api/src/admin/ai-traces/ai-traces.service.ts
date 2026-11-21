import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@api/common/prisma/prisma.service';

/** 单条 span 的写入入参，调用方只需给业务字段，时间由服务兜底。 */
export interface RecordTraceSpanInput {
  type: string;
  name: string;
  status?: string;
  input?: Record<string, any> | null;
  output?: Record<string, any> | null;
  error?: string | null;
  startedAt?: Date | string;
  endedAt?: Date | string | null;
  durationMs?: number | null;
  metadata?: Record<string, any> | null;
}

/** 一次 AI 回复的链路记录入参。字段均可缺省，避免调用方为埋点做额外查询。 */
export interface RecordTraceInput {
  conversationId: string;
  triggerMessageId?: string | null;
  aiMessageId?: string | null;
  userId?: string | null;
  source?: string;
  intent?: string | null;
  input?: string | null;
  output?: string | null;
  status?: string;
  latencyMs?: number | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
  promptName?: string | null;
  promptVersion?: number | null;
  metadata?: Record<string, any> | null;
  spans?: RecordTraceSpanInput[];
}

export interface ListTraceInput {
  conversationId?: string;
  intent?: string;
  page?: number;
  pageSize?: number;
}

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
const MAX_INPUT_LENGTH = 1000;
const MAX_OUTPUT_LENGTH = 2000;
const MAX_ERROR_LENGTH = 500;

/**
 * AiTrace / AiSpan 的读写入口。
 *
 * 写入是「尽力而为」：埋点失败绝不能反向影响用户对话，
 * 因此 recordTrace 内部消化所有异常，只记一条 warn 日志。
 */
@Injectable()
export class TraceService {
  private readonly logger = new Logger(TraceService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 每天 03:00 UTC 清理过期链路。
   * 只删 trace 与其分数；spans 通过外键级联删除。
   * 多实例重复执行是幂等的。
   */
  @Cron('0 3 * * *', { timeZone: 'UTC' })
  async purgeExpired(): Promise<void> {
    const days = Number(process.env.AI_TRACE_RETENTION_DAYS ?? 30);
    if (!Number.isFinite(days) || days <= 0) return;
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    try {
      // 只清理链路上的 LLM 分数；HUMAN 分数是运营记录，长期保留。
      const scores = await this.prisma.aiScore.deleteMany({
        where: { createdAt: { lt: cutoff }, source: 'LLM' },
      });
      const traces = await this.prisma.aiTrace.deleteMany({
        where: { createdAt: { lt: cutoff } },
      });
      if (scores.count > 0 || traces.count > 0) {
        this.logger.log(
          `[trace-retention] removed traces=${traces.count}, scores=${scores.count} (older than ${days}d)`,
        );
      }
    } catch (err: any) {
      this.logger.warn(
        `[trace-retention] purge failed: ${err?.message ?? err}`,
      );
    }
  }

  /**
   * 创建一条 trace 及其 spans。
   * 失败时返回 null，不向调用方抛错。
   */
  async recordTrace(input: RecordTraceInput) {
    try {
      if (!input?.conversationId) return null;

      const spans = Array.isArray(input.spans) ? input.spans : [];
      const trace = await this.prisma.aiTrace.create({
        data: {
          conversationId: input.conversationId,
          triggerMessageId: input.triggerMessageId ?? null,
          aiMessageId: input.aiMessageId ?? null,
          userId: input.userId ?? null,
          source: input.source ?? 'production',
          intent: input.intent ?? null,
          input: truncate(input.input, MAX_INPUT_LENGTH),
          output: truncate(input.output, MAX_OUTPUT_LENGTH),
          status: input.status ?? 'SUCCESS',
          latencyMs: input.latencyMs ?? null,
          promptTokens: input.promptTokens ?? null,
          completionTokens: input.completionTokens ?? null,
          promptName: input.promptName ?? null,
          promptVersion: input.promptVersion ?? null,
          ...(input.metadata ? { metadata: toJson(input.metadata) } : {}),
          ...(spans.length > 0
            ? {
                spans: {
                  create: spans.map((span) => ({
                    type: span.type,
                    name: span.name,
                    status: span.status ?? 'OK',
                    ...(span.input ? { input: toJson(span.input) } : {}),
                    ...(span.output ? { output: toJson(span.output) } : {}),
                    error: truncate(span.error, MAX_ERROR_LENGTH),
                    startedAt: span.startedAt
                      ? new Date(span.startedAt)
                      : new Date(),
                    endedAt: span.endedAt ? new Date(span.endedAt) : null,
                    durationMs: span.durationMs ?? null,
                    ...(span.metadata
                      ? { metadata: toJson(span.metadata) }
                      : {}),
                  })),
                },
              }
            : {}),
        },
        include: { spans: true },
      });

      return trace;
    } catch (err: any) {
      this.logger.warn(
        `[recordTrace] failed (conversationId=${input?.conversationId ?? 'n/a'}): ${
          err?.message ?? err
        }`,
      );
      return null;
    }
  }

  /** 分页查询链路列表，按创建时间倒序。 */
  async list(input: ListTraceInput = {}) {
    const page = Math.max(1, Math.floor(input.page ?? 1));
    const pageSize = Math.min(
      MAX_PAGE_SIZE,
      Math.max(1, Math.floor(input.pageSize ?? DEFAULT_PAGE_SIZE)),
    );

    const where: Prisma.AiTraceWhereInput = {};
    if (input.conversationId) where.conversationId = input.conversationId;
    if (input.intent) where.intent = input.intent;

    const [list, total] = await Promise.all([
      this.prisma.aiTrace.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.aiTrace.count({ where }),
    ]);

    return { list, total, page, pageSize };
  }

  /** 详情：附上 span 时间线，按开始时间升序。 */
  async get(id: string) {
    const [trace, scores] = await Promise.all([
      this.prisma.aiTrace.findUnique({
        where: { id },
        include: {
          spans: { orderBy: [{ startedAt: 'asc' }, { id: 'asc' }] },
        },
      }),
      this.prisma.aiScore.findMany({
        where: { traceId: id },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    if (!trace) throw new NotFoundException('Trace not found');
    return { ...trace, scores };
  }
}

function truncate(value: string | null | undefined, max: number) {
  if (value === null || value === undefined) return null;
  const text = String(value);
  if (!text) return null;
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/**
 * 把任意对象转成 Prisma Json 可接受的结构。
 * 埋点数据来自运行时状态，可能带 undefined / 不可序列化值，
 * 出错时宁可不写该字段，也不要污染或阻断主链路。
 */
function toJson(value: Record<string, any>): Prisma.InputJsonValue {
  try {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  } catch {
    // 循环引用等不可序列化值：只丢这一个 JSON 字段，不影响整条 trace。
    return {};
  }
}
