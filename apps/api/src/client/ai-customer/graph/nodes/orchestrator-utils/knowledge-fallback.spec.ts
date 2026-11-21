import { shouldUseKnowledgeFallback } from './knowledge-fallback';

describe('shouldUseKnowledgeFallback', () => {
  it('信息题 + Agent 说不在范围 → 走知识兜底', () => {
    expect(
      shouldUseKnowledgeFallback('团购要怎么参加？', [
        {
          content:
            '关于团购的参与方式，这属于下单购买流程，不在我的服务范围内，我这边无法为您处理。',
        },
      ]),
    ).toBe(true);
  });

  it('动作请求不兜底', () => {
    expect(
      shouldUseKnowledgeFallback('帮我提现 500 到银行卡', [
        { content: '不在我的服务范围，我这边无法为您处理。' },
      ]),
    ).toBe(false);
  });

  it('正常回答不兜底', () => {
    expect(
      shouldUseKnowledgeFallback('团购要怎么参加？', [
        { content: '先选择商品，然后开团或加入已有团。' },
      ]),
    ).toBe(false);
  });

  it('多 Agent 只要有一个正常回答就不兜底', () => {
    expect(
      shouldUseKnowledgeFallback('团购怎么参加，顺便看余额', [
        { content: '不在我的服务范围内。' },
        { content: '您的余额是 ₱100。' },
      ]),
    ).toBe(false);
  });
});
