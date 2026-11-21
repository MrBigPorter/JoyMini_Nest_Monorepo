import { describe, expect, it } from 'vitest';
import { diagnoseFeedbackRow } from '@/lib/ai-ops-feedback-diagnosis';

describe('diagnoseFeedbackRow', () => {
  it('未回复 + 索要卡号 + 无链路', () => {
    const flags = diagnoseFeedbackRow({
      signal: 'abandoned',
      input: '我要提现 500 到银行卡',
      answer: '请提供以下信息：1. 银行卡号 2. 持卡人姓名',
      traceId: null,
    });

    expect(flags.map((f) => f.key)).toEqual([
      'unanswered',
      'sensitive_request',
      'no_trace',
    ]);
    expect(flags[0].severity).toBe('high');
  });

  it('中问英答有链路时只标记语言问题', () => {
    const flags = diagnoseFeedbackRow({
      signal: 'transferred',
      input: '我的券什么时候过期？',
      answer:
        'You currently have 0 coupons in your account. Would you like to see available coupons?',
      traceId: 'trace-1',
    });

    expect(flags.map((f) => f.key)).toEqual(['language_mismatch']);
  });

  it('正常反馈不产生诊断标记', () => {
    const flags = diagnoseFeedbackRow({
      signal: 'transferred',
      input: '订单什么时候发货？',
      answer: '你的订单预计明天发货，请留意物流通知。',
      traceId: 'trace-1',
    });

    expect(flags).toEqual([]);
  });
});
