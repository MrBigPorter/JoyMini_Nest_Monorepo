import { describe, expect, it } from 'vitest';
import type { ChatConversation } from '@/type/types';
import { describeHandoff, formatCountdown, handoffLabel } from './handoff-display';

const base = {
  status: 1,
  handlerId: null,
  handoffState: 'AI_ACTIVE' as const,
  handlerName: null,
  autoReturnAt: null,
};

const labels: Record<string, string> = {
  'customerService.handoffAi': 'AI',
  'customerService.handoffWaiting': '待接入',
  'customerService.handoffHuman': '人工处理中',
  'customerService.handoffAgentPrefix': '客服：',
  'customerService.handoffClosed': '已关闭',
};
const t = (key: string) => labels[key] ?? key;

describe('describeHandoff', () => {
  it('AI 状态', () => {
    expect(describeHandoff(base as ChatConversation)).toMatchObject({ tone: 'ai' });
  });

  it('排队显示待接入和倒计时', () => {
    const now = 1_000_000;
    expect(
      describeHandoff(
        {
          ...base,
          handlerId: 'awaiting_human',
          handoffState: 'WAITING_HUMAN',
          autoReturnAt: now + 90_000,
        } as ChatConversation,
        now,
      ),
    ).toEqual({ tone: 'waiting', countdownSeconds: 90, handlerName: null });
  });

  it('人工显示客服名', () => {
    const display = describeHandoff({
      ...base,
      handlerId: 'admin-1',
      handoffState: 'HUMAN_ACTIVE',
      handlerName: '张三',
    } as ChatConversation);
    expect(display).toMatchObject({ tone: 'human', handlerName: '张三' });
    expect(handoffLabel(display, t)).toBe('客服：张三');
  });

  it('关闭优先', () => {
    expect(
      describeHandoff({ ...base, status: 2, handlerId: 'admin-1' } as ChatConversation),
    ).toMatchObject({ tone: 'closed' });
  });

  it('倒计时格式化', () => {
    expect(formatCountdown(90)).toBe('1:30');
    expect(formatCountdown(null)).toBeNull();
  });
});
