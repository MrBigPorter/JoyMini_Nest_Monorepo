import { evaluateTurnFailure, nextRepeatCount } from './turn-failure';

describe('evaluateTurnFailure', () => {
  const base = {
    userInput: '团购要怎么参加？',
    ragSourceCount: 0,
    hasAgentError: false,
  };

  it('Agent 抛错优先判 tool_error', () => {
    expect(
      evaluateTurnFailure({
        ...base,
        hasAgentError: true,
        outputs: [{ content: '先选商品再开团' }],
      }),
    ).toEqual({ failed: true, reason: 'tool_error' });
  });

  it('工具结果 success=false 也算 tool_error', () => {
    expect(
      evaluateTurnFailure({
        ...base,
        outputs: [{ content: '查不到', success: false }],
      }),
    ).toEqual({ failed: true, reason: 'tool_error' });
  });

  it('全部输出是拒绝 → refusal', () => {
    expect(
      evaluateTurnFailure({
        ...base,
        outputs: [
          { content: '这不在我的服务范围内，请使用对应功能。' },
          { content: '我这边只能查询订单，无法处理。' },
        ],
      }),
    ).toEqual({ failed: true, reason: 'refusal' });
  });

  it('信息题、无 RAG、只说查不到 → no_evidence', () => {
    expect(
      evaluateTurnFailure({
        ...base,
        outputs: [{ content: '我这边没有找到相关信息，建议联系人工客服。' }],
      }),
    ).toEqual({ failed: true, reason: 'no_evidence' });
  });

  it('正常回答不失败', () => {
    expect(
      evaluateTurnFailure({
        ...base,
        outputs: [{ content: '先选择商品，然后开团或加入已有团。' }],
      }),
    ).toEqual({ failed: false, reason: null });
  });

  it('RAG 有来源时即使话术普通也不算失败', () => {
    expect(
      evaluateTurnFailure({
        ...base,
        ragSourceCount: 3,
        outputs: [{ content: '根据退款政策，签收后 7 天内可退。' }],
      }),
    ).toEqual({ failed: false, reason: null });
  });
});

describe('nextRepeatCount', () => {
  const same = { intent: 'coupon', previousIntent: 'coupon', repeatCount: 1 };
  const changed = { intent: 'order', previousIntent: 'coupon', repeatCount: 4 };

  it('同意图失败 +1', () => {
    expect(nextRepeatCount(same, true)).toBe(2);
  });

  it('成功清零', () => {
    expect(nextRepeatCount(same, false)).toBe(0);
  });

  it('换意图清零', () => {
    expect(nextRepeatCount(changed, true)).toBe(0);
  });

  it('强制清零（转人工/回 AI）', () => {
    expect(nextRepeatCount(same, true, true)).toBe(0);
  });
});
