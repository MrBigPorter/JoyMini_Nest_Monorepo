import type { ChatConversation } from '@/type/types';

export type HandoffTone = 'ai' | 'waiting' | 'human' | 'closed';

export interface HandoffDisplay {
  tone: HandoffTone;
  label: string;
  countdownSeconds: number | null;
}

export function describeHandoff(
  conv: Pick<
    ChatConversation,
    'status' | 'handlerId' | 'handoffState' | 'handlerName' | 'autoReturnAt'
  >,
  now = Date.now(),
): HandoffDisplay {
  if (conv.status === 2 || conv.handoffState === 'CLOSED') {
    return { tone: 'closed', label: '已关闭', countdownSeconds: null };
  }
  if (conv.handoffState === 'WAITING_HUMAN' || conv.handlerId === 'awaiting_human') {
    return {
      tone: 'waiting',
      label: '待接入',
      countdownSeconds: conv.autoReturnAt
        ? Math.max(0, Math.ceil((conv.autoReturnAt - now) / 1000))
        : null,
    };
  }
  if (conv.handlerId) {
    return {
      tone: 'human',
      label: conv.handlerName ? `客服：${conv.handlerName}` : '人工处理中',
      countdownSeconds: conv.autoReturnAt
        ? Math.max(0, Math.ceil((conv.autoReturnAt - now) / 1000))
        : null,
    };
  }
  return { tone: 'ai', label: 'AI', countdownSeconds: null };
}

export function formatCountdown(seconds: number | null): string | null {
  if (seconds === null) return null;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
