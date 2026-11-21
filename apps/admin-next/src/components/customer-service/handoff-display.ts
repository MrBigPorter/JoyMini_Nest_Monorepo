import type { ChatConversation } from '@/type/types';

export type HandoffTone = 'ai' | 'waiting' | 'human' | 'closed';

export interface HandoffDisplay {
  tone: HandoffTone;
  countdownSeconds: number | null;
  handlerName: string | null;
}

export function describeHandoff(
  conv: Pick<
    ChatConversation,
    'status' | 'handlerId' | 'handoffState' | 'handlerName' | 'autoReturnAt'
  >,
  now = Date.now(),
): HandoffDisplay {
  if (conv.status === 2 || conv.handoffState === 'CLOSED') {
    return { tone: 'closed', countdownSeconds: null, handlerName: null };
  }
  if (conv.handoffState === 'WAITING_HUMAN' || conv.handlerId === 'awaiting_human') {
    return {
      tone: 'waiting',
      countdownSeconds: conv.autoReturnAt
        ? Math.max(0, Math.ceil((conv.autoReturnAt - now) / 1000))
        : null,
      handlerName: null,
    };
  }
  if (conv.handlerId) {
    return {
      tone: 'human',
      countdownSeconds: conv.autoReturnAt
        ? Math.max(0, Math.ceil((conv.autoReturnAt - now) / 1000))
        : null,
      handlerName: conv.handlerName ?? null,
    };
  }
  return { tone: 'ai', countdownSeconds: null, handlerName: null };
}

export function handoffLabel(
  display: HandoffDisplay,
  t: (key: string) => string,
): string {
  switch (display.tone) {
    case 'waiting':
      return t('customerService.handoffWaiting');
    case 'human':
      return display.handlerName
        ? `${t('customerService.handoffAgentPrefix')}${display.handlerName}`
        : t('customerService.handoffHuman');
    case 'closed':
      return t('customerService.handoffClosed');
    case 'ai':
    default:
      return t('customerService.handoffAi');
  }
}

export function formatCountdown(seconds: number | null): string | null {
  if (seconds === null) return null;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
