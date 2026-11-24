import {
  isInformationalQuestion,
  shouldUseKnowledgeFallback,
} from './knowledge-fallback';

describe('isInformationalQuestion', () => {
  it.each([
    '退款流程是怎样的？',
    '要上传哪些材料',
    '提现需要什么材料',
    '退款要几天到账',
  ])('中文信息题：%s', (input) => {
    expect(isInformationalQuestion(input)).toBe(true);
  });

  it.each([
    'How do I contact customer support?',
    'What is the refund policy?',
    'Where can I find my coupons?',
    'Do I need to upload documents?',
  ])('英文信息题：%s', (input) => {
    expect(isInformationalQuestion(input)).toBe(true);
  });

  it.each(['你好', '帮我提现 500 到银行卡', 'Show me the product list'])(
    '非信息题：%s',
    (input) => {
      expect(isInformationalQuestion(input)).toBe(false);
    },
  );
});

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

  it('“没有直接信息/怕误导”这类软拒绝也兜底', () => {
    expect(
      shouldUseKnowledgeFallback('你们的隐私政策在哪里看？', [
        {
          content:
            '关于隐私政策的具体位置，我这边没有直接的信息可以查询，怕说错了误导你。',
        },
      ]),
    ).toBe(true);
  });

  it('只给页脚/人工客服的软回答也兜底', () => {
    expect(
      shouldUseKnowledgeFallback('你们的隐私政策在哪里看？', [
        {
          content:
            '您可以在网站或 App 的页面底部找到「隐私政策」链接，如果找不到建议联系人工客服。',
        },
      ]),
    ).toBe(true);
  });

  it('“没有查看/解释功能”也兜底', () => {
    expect(
      shouldUseKnowledgeFallback('我的个人数据会怎么使用？', [
        {
          content:
            '我这边没有权限查看或解释隐私政策的具体条款，建议你通过 App 内或人工客服确认。',
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
