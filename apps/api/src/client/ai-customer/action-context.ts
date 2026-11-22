import { Injectable, Logger } from '@nestjs/common';
// 注意：这里必须是值导入，不能用 `import type`。
// Nest 的 DI 依赖 emitDecoratorMetadata 记录构造函数参数类型；
// `import type` 会被擦除，元数据退化成 Object，运行时报
// "Nest can't resolve dependencies of AiActionContextService".
import { PrismaService } from '@api/common/prisma/prisma.service';

export type ActionContextStatus =
  | 'CONFIRM_CREATED'
  | 'CONFIRMED'
  | 'EXECUTED'
  | 'EXPIRED'
  | 'CANCELLED'
  | 'FAILED'
  | 'TRANSFERRED';

export interface ActionContext {
  requestId: string;
  action: string;
  status: ActionContextStatus;
  /** 已掩码的展示摘要；可注入提示词。 */
  summary: Record<string, unknown>;
  /**
   * 服务端执行参数（未脱敏）。只允许用于「文字确认后重发卡片」与执行，
   * 绝不注入提示词（formatActionContext 不会读取它）。
   */
  params?: Record<string, unknown>;
  expiresAt: string | null;
  expired: boolean;
}

const MASKED_KEYS = new Set(['account', 'phone']);

function maskValue(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (trimmed.length <= 4) return '****';
  return `****${trimmed.slice(-4)}`;
}

/**
 * 卡片摘要里的收款账号/手机号只保留后四位。
 * 不修改入参：调用方可能仍需要原始值做执行。
 */
export function maskActionSummary(
  summary: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  if (!summary || typeof summary !== 'object' || Array.isArray(summary)) {
    return {};
  }
  const masked: Record<string, unknown> = { ...summary };
  for (const key of MASKED_KEYS) {
    if (key in masked) masked[key] = maskValue(masked[key]);
  }
  return masked;
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function hintFor(status: ActionContextStatus, expired: boolean): string {
  if (expired || status === 'EXPIRED') {
    return '该动作已过期；如果用户还想执行，需要请其重新发起。';
  }
  switch (status) {
    case 'CONFIRM_CREATED':
      return '用户需要在卡片上点击确认；用户打字“确认”不会执行动作。';
    case 'CONFIRMED':
      return '动作已确认，正在等待短信验证码；不要声称已经执行完成。';
    case 'EXECUTED':
      return '该动作已执行完成。';
    case 'CANCELLED':
      return '该动作已被用户取消。';
    case 'FAILED':
      return '该动作执行失败；如需重试，请让用户重新发起。';
    case 'TRANSFERRED':
      return '会话已转人工，AI 不应继续执行该动作。';
    default:
      return '';
  }
}

/** 作为独立 system 段落注入，强调「状态以服务端为准」。 */
export function formatActionContext(ctx: ActionContext | null): string {
  if (!ctx) return '';
  const lines = [
    '## Last Action',
    `lastAction: ${ctx.action}`,
    `lastActionStatus: ${ctx.status}`,
    `lastActionExpired: ${ctx.expired}`,
  ];
  if (Object.keys(ctx.summary).length > 0) {
    lines.push(`lastActionSummary: ${JSON.stringify(ctx.summary)}`);
  }
  const hint = hintFor(ctx.status, ctx.expired);
  if (hint) lines.push(`actionHint: ${hint}`);
  return lines.join('\n');
}

/**
 * 读取会话最近一次写操作，作为每轮的权威动作上下文。
 *
 * 为什么不从 graph state / 聊天文本推断：那条状态在 rollback、handoff reset
 * 和新消息过期时都会分叉；DB 的 ai_action_requests 才是执行判据。
 */
@Injectable()
export class AiActionContextService {
  private readonly logger = new Logger(AiActionContextService.name);

  constructor(private readonly prisma: PrismaService) {}

  async loadLatest(conversationId: string): Promise<ActionContext | null> {
    try {
      const row = await this.prisma.aiActionRequest.findFirst({
        where: { conversationId },
        orderBy: { createdAt: 'desc' },
      });
      if (!row) return null;

      const expiresAt = row.expiresAt ? new Date(row.expiresAt) : null;
      const expired =
        row.status === 'CONFIRM_CREATED' &&
        expiresAt != null &&
        expiresAt.getTime() <= Date.now();

      return {
        requestId: row.id,
        action: row.action,
        status: row.status as ActionContextStatus,
        summary: maskActionSummary(toRecord(row.summary)),
        params: toRecord(row.params),
        expiresAt: expiresAt ? expiresAt.toISOString() : null,
        expired,
      };
    } catch (err: any) {
      // 读不到动作上下文不能阻断对话：返回 null，正文仍能回答。
      this.logger.warn(
        `[action-context] load failed: conv=${conversationId}, reason=${err?.message ?? err}`,
      );
      return null;
    }
  }
}
