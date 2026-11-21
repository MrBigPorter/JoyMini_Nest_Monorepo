import { describe, expect, it } from 'vitest';
import { describeHandoff, formatCountdown } from './handoff-display';

const base = {
  status: 1,
  handlerId: null,
  handoffState: 'AI_ACTIVE' as const,
  handlerName: null,
  autoReturnAt: null,
};

describe('describeHandoff', () => {
  it('AI 状态', () => {
    expect(describeHandoff(base)).toMatchObject({ tone: 'ai', label: 'AI' });
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
        },
        now,
      ),
    ).toEqual({ tone: 'waiting', label: '待接入', countdownSeconds: 90 });
  });

  it('人工显示客服名', () => {
    expect(
      describeHandoff({
        ...base,
        handlerId: 'admin-1',
        handoffState: 'HUMAN_ACTIVE',
        handlerName: '张三',
      }),
    ).toMatchObject({ tone: 'human', label: '客服：张三' });
  });

  it('关闭优先', () => {
    expect(
      describeHandoff({ ...base, status: 2, handlerId: 'admin-1' }),
    ).toMatchObject({ tone: 'closed' });
  });

  it('倒计时格式化', () => {
    expect(formatCountdown(90)).toBe('1:30');
    expect(formatCountdown(null)).toBeNull();
  });
});
