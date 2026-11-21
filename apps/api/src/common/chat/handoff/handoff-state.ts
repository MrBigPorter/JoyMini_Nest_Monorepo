import { ConversationStatus } from '@lucky/shared';
import { AWAITING_HUMAN } from '@api/common/chat/support-handler.service';

/**
 * 交接四态。
 *
 * 判定只看两个字段：
 *   - status      ARCHIVED(2) 优先 → CLOSED
 *   - handlerId   null → AI_ACTIVE；awaiting_human → WAITING_HUMAN；其余 → HUMAN_ACTIVE
 *
 * 这里不查库，所有调用方都基于同一份会话快照判定，避免各模块各写一套。
 */
export type HandoffState =
  | 'AI_ACTIVE'
  | 'WAITING_HUMAN'
  | 'HUMAN_ACTIVE'
  | 'CLOSED';

export type HandoffReturnReason =
  | 'waiting_timeout'
  | 'inactive_timeout'
  | 'admin_return'
  | 'closed_reopen';

export function deriveHandoffState(conv: {
  status: number;
  handlerId: string | null;
}): HandoffState {
  if (conv.status === ConversationStatus.ARCHIVED) return 'CLOSED';
  if (conv.handlerId === AWAITING_HUMAN) return 'WAITING_HUMAN';
  if (conv.handlerId != null) return 'HUMAN_ACTIVE';
  return 'AI_ACTIVE';
}

/** 自动回 AI 后由 AI 回合消费的复位标记 */
export interface HandoffResetPending {
  /** ISO 字符串，便于直接落 JSON 与前端展示 */
  at: string;
  reason: HandoffReturnReason;
}

/** aiMetadata.handoffHistory 的单条审计记录，最多保留 10 条 */
export interface HandoffHistoryEntry {
  from: HandoffState;
  to: HandoffState;
  reason: HandoffReturnReason;
  actor: string;
  at: string;
}

/** 系统消息文案：所有用户可见内容为中文 */
export const HANDOFF_RETURN_MESSAGE = '人工服务已结束，AI 继续为您服务。';
export const HANDOFF_REOPEN_MESSAGE = '会话已重新打开，智能助手继续';
