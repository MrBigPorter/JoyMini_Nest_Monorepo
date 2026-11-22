import { buildAgentInjectedMessages } from './agent-factory';

describe('buildAgentInjectedMessages', () => {
  it('把最近动作状态注入为独立 system 消息', () => {
    const messages = buildAgentInjectedMessages({
      actionContext: {
        requestId: 'a1',
        action: 'withdraw',
        status: 'CONFIRM_CREATED',
        summary: { amount: 100 },
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        expired: false,
      },
    });

    const text = messages.map((message) => String(message.content)).join('\n');
    expect(text).toContain('lastAction: withdraw');
    expect(text).toContain('需要在卡片上点击确认');
  });

  it('过期动作提示重新发起', () => {
    const messages = buildAgentInjectedMessages({
      actionContext: {
        requestId: 'a1',
        action: 'withdraw',
        status: 'EXPIRED',
        summary: {},
        expiresAt: new Date(Date.now() - 1000).toISOString(),
        expired: true,
      },
    });

    const text = messages.map((message) => String(message.content)).join('\n');
    expect(text).toContain('lastActionStatus: EXPIRED');
    expect(text).toContain('重新发起');
  });

  it('没有上下文时不注入任何消息', () => {
    expect(buildAgentInjectedMessages({})).toHaveLength(0);
  });

  it('contextState 与 actionContext 同时存在时分开注入', () => {
    const messages = buildAgentInjectedMessages({
      contextState: {
        activeEntity: 'Big Spender',
        slots: {},
        corrections: [],
        unresolved: [],
      },
      actionContext: {
        requestId: 'a1',
        action: 'claim_coupon',
        status: 'CONFIRM_CREATED',
        summary: {},
        expiresAt: null,
        expired: false,
      },
    });

    expect(messages).toHaveLength(2);
    expect(String(messages[0].content)).toContain('activeEntity: Big Spender');
    expect(String(messages[1].content)).toContain('lastAction: claim_coupon');
  });
});
