import { buildConversationDiagnosis } from './conversation-diagnosis';

const base = {
  flowState: {},
  hasTrace: true,
  now: new Date('2026-11-21T10:00:00.000Z'),
};

describe('buildConversationDiagnosis', () => {
  it('提现会话：识别交易意图与查询流程错位、敏感信息索要、无链路', () => {
    const diagnosis = buildConversationDiagnosis({
      ...base,
      hasTrace: false,
      flowState: { activeFlow: 'BALANCE_QUERY', step: 'COMPLETED' },
      messages: [
        {
          type: 'human',
          content: '我要提现 500 到银行卡',
          createdAt: '2026-11-21T09:58:00.000Z',
        },
        {
          type: 'ai',
          content:
            '为您找到可用的提现渠道，请再提供以下信息：1. 银行卡号 2. 持卡人姓名',
          createdAt: '2026-11-21T09:58:30.000Z',
        },
      ],
    });

    expect(diagnosis.unanswered).toBe(false);
    expect(diagnosis.sensitiveRequest).toBe(true);
    expect(diagnosis.intentFlowMismatch).toBe(true);
    expect(diagnosis.flags.map((f) => f.key)).toEqual([
      'sensitive_request',
      'intent_flow_mismatch',
      'no_trace',
    ]);
  });

  it('交易词出现在最后一条用户消息时标记意图流程错位', () => {
    const diagnosis = buildConversationDiagnosis({
      ...base,
      flowState: { activeFlow: 'BALANCE_QUERY', step: 'COMPLETED' },
      messages: [
        { type: 'ai', content: '请问需要什么帮助？', createdAt: null },
        {
          type: 'human',
          content: '我要提现 500 到银行卡',
          createdAt: '2026-11-21T09:30:00.000Z',
        },
      ],
    });

    expect(diagnosis.unanswered).toBe(true);
    expect(diagnosis.intentFlowMismatch).toBe(true);
    expect(diagnosis.idleMinutes).toBe(30);
  });

  it('优惠券会话：识别未回复与中问英答', () => {
    const diagnosis = buildConversationDiagnosis({
      ...base,
      hasTrace: false,
      flowState: { activeFlow: 'COUPON_QUERY', step: 'COMPLETED' },
      messages: [
        {
          type: 'ai',
          content:
            'You currently have 0 coupons in your account. Would you like to see available coupons?',
          createdAt: '2026-11-20T12:10:00.000Z',
        },
        {
          type: 'human',
          content: '我的券什么时候过期？',
          createdAt: '2026-11-20T12:10:25.000Z',
        },
      ],
    });

    expect(diagnosis.unanswered).toBe(true);
    expect(diagnosis.languageMismatch).toBe(true);
    expect(diagnosis.flags.map((f) => f.key)).toEqual([
      'unanswered',
      'language_mismatch',
      'no_trace',
    ]);
    expect(diagnosis.flags[0].detail).toContain('21 小时');
  });

  it('正常已回复会话不产生异常标记', () => {
    const diagnosis = buildConversationDiagnosis({
      ...base,
      flowState: { activeFlow: 'GENERAL', step: 'COMPLETED' },
      messages: [
        { type: 'human', content: '你好', createdAt: '2026-11-21T09:59:00.000Z' },
        { type: 'ai', content: '你好呀！有什么可以帮你？', createdAt: '2026-11-21T09:59:05.000Z' },
      ],
    });

    expect(diagnosis.flags).toEqual([]);
  });
});
