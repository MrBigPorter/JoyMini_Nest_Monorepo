import { HumanMessage } from '@langchain/core/messages';
import { detectTransferRequest } from './transfer-detector';
import type { AgentState } from '../../state';

/**
 * 这些用例的由来（#87 N-7 / N-10）
 *
 * 转人工检测从"分数门槛之后"前移到"函数开头"之后，它会检查**每一条**消息。
 * 而它是 `includes()` 子串匹配，所以必须锁住两类案例：
 *   ① 明确的转人工请求 —— 必须命中（前移就是为了救它）
 *   ② 带同字/同词的正常提问 —— 绝不能命中（前移会放大误判成本）
 * 其中 ② 里的 "麻烦" / "没用过" 曾经真的会触发 transfer。
 */
function makeState(userText: string, overrides: Record<string, unknown> = {}) {
  return {
    messages: [new HumanMessage(userText)],
    intent: '',
    previousIntent: '',
    repeatCount: 0,
    ...overrides,
  } as unknown as typeof AgentState.State;
}

describe('detectTransferRequest', () => {
  describe('明确要求转人工 → 必须命中', () => {
    it.each([
      '我要转人工',
      '转人工',
      '请帮我找客服',
      '我要人工',
      'I want to talk to human',
    ])('%s', (text) => {
      const decision = detectTransferRequest(text, makeState(text));
      expect(decision.shouldTransfer).toBe(true);
      expect(decision.reason).toBe('explicit_request');
    });
  });

  describe('子串误判 → 绝不能命中', () => {
    it.each([
      '麻烦帮我查一下订单',
      '麻烦看一下这个优惠券',
      '这个券我没用过',
      '这个功能我没用过，怎么用',
      '您好，咨询一下拼团规则',
      'hello, where is my order',
    ])('%s', (text) => {
      const decision = detectTransferRequest(text, makeState(text));
      expect(decision.shouldTransfer).toBe(false);
      expect(decision.reason).toBe('none');
    });
  });

  describe('商品词里的"垃圾"不是骂人', () => {
    it.each([
      '这个垃圾袋还有货吗',
      '垃圾桶怎么用优惠券买',
      '垃圾分类的产品有吗',
    ])('%s', (text) => {
      const decision = detectTransferRequest(text, makeState(text));
      expect(decision.shouldTransfer).toBe(false);
      expect(decision.reason).toBe('none');
    });

    it('真的在骂人的"垃圾"仍然转人工', () => {
      const decision = detectTransferRequest('垃圾，三天就坏了', makeState('垃圾，三天就坏了'));
      expect(decision.shouldTransfer).toBe(true);
      expect(decision.reason).toBe('negative_sentiment');
    });
  });

  describe('负面情绪 → 命中', () => {
    it.each([
      // 强词：单个即转
      '我要投诉',
      '这个客服态度差劲',
      '气死了',
      '你们这是骗子吧',
      // 弱词：累计 2 个才转
      '好烦啊，快递太慢了',
    ])('%s', (text) => {
      const decision = detectTransferRequest(text, makeState(text));
      expect(decision.shouldTransfer).toBe(true);
      expect(decision.reason).toBe('negative_sentiment');
    });
  });

  describe('单个弱情绪词 → 先交给 AI 安抚，不直接转', () => {
    it.each(['太慢了', '好烦', '这个券没有用'])('%s', (text) => {
      const decision = detectTransferRequest(text, makeState(text));
      expect(decision.shouldTransfer).toBe(false);
      expect(decision.reason).toBe('none');
    });
  });

  describe('默认不转', () => {
    it('普通问候不转', () => {
      const decision = detectTransferRequest('你好', makeState('你好'));
      expect(decision).toEqual({ shouldTransfer: false, reason: 'none' });
    });
  });
});
