/**
 * INTENT_PROMPT 模板 + Intent Router Logic 自测
 *
 * ── 历史 Bug ──
 * LangChain ChatPromptTemplate.fromMessages() 使用 f-string 风格模板解析，
 * 任何 {content} 模式都会被解析为模板变量引用。当 content 包含逗号时，
 * 会被解析为多个变量名。
 *
 * 例如:  { label: "order", score: 0.92 }
 *     →  解析为变量 " label: \"order\", score: 0.92 "
 *     →  找不到该变量 → "Missing value for input variable"
 *
 * ── 修复方案 ──
 * prompt 字符串中不能出现 { 和 } 包含逗号分隔内容。
 * JSON 示例改用括号写法: (label: "order", score: 0.92)
 *
 * ── 测试分组 ──
 * Group A: 模板解析（验证修复后不会抛 LangChain 解析错误）
 * Group B: 意图路由逻辑（JSON 解析、验证、回退）
 * Group C: 边界情况
 */
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { describe, it, expect } from '@jest/globals';
import { VALID_INTENTS } from '@api/client/ai-customer/graph/agents/prompts/intent-label-categories';

// ============================================================
// Group A: 模板解析 — 修复验证
// ============================================================
describe('Group A: INTENT_PROMPT template parsing', () => {
  /**
   * A1: 使用括号代替花括号的示例不会触发 LangChain 模板变量解析
   */
  it('A1: parentheses in examples should not trigger template variable parsing', async () => {
    const prompt = ChatPromptTemplate.fromMessages([
      [
        'system',
        [
          'You are an e-commerce classifier.',
          'Output JSON with intent and labels.',
          'Example: intent = order, labels = [ (label: order, score: 0.92) ]',
          'prev: {previousIntent}',
          '{conversationContext}',
        ].join('\n'),
      ],
      ['human', '{input}'],
    ]);

    let error: Error | null = null;
    let result: any = null;
    try {
      result = await prompt.formatMessages({
        input: 'hello',
        previousIntent: 'none',
        conversationContext: '(empty)',
      });
    } catch (err: any) {
      error = err;
    }

    expect(error).toBeNull();
    const sysMsg = result[0].content as string;
    expect(sysMsg).toContain('prev: none');
    expect(sysMsg).toContain('(empty)');
    expect(sysMsg).not.toContain('{previousIntent}');
  });

  /**
   * A2: 花括号+逗号内容在 array.join 中也触发错误
   * 说明问题不在字符串构造方式，而在最终字符串内容
   */
  it('A2: curly braces with comma content still fail even with array.join', async () => {
    const prompt = ChatPromptTemplate.fromMessages([
      [
        'system',
        [
          'Example: { label: order, score: 0.92 }',
          'prev: {previousIntent}',
        ].join('\n'),
      ],
      ['human', '{input}'],
    ]);

    let error: Error | null = null;
    try {
      await prompt.formatMessages({
        input: 'test',
        previousIntent: 'none',
      });
    } catch (err: any) {
      error = err;
    }

    expect(error).not.toBeNull();
    expect(error?.message).toContain('Missing value for input variable');
  });

  /**
   * A3: 所有模板变量都被正确替换
   */
  it('A3: template variables should be replaced correctly', async () => {
    const prompt = ChatPromptTemplate.fromMessages([
      ['system', 'A: {previousIntent}\nB: {conversationContext}'],
      ['human', '{input}'],
    ]);

    const result = await prompt.formatMessages({
      input: 'show my orders',
      previousIntent: 'wallet',
      conversationContext: 'User: check balance',
    });

    expect((result[0].content as string)).toBe(
      'A: wallet\nB: User: check balance',
    );
    expect((result[1].content as string)).toBe('show my orders');
  });

  /**
   * A4: 空变量值不会崩溃
   */
  it('A4: empty variables should not crash', async () => {
    const prompt = ChatPromptTemplate.fromMessages([
      ['system', 'prev: {previousIntent}'],
      ['human', '{input}'],
    ]);

    const result = await prompt.formatMessages({
      input: '',
      previousIntent: '',
    });

    expect((result[0].content as string)).toBe('prev: ');
    expect((result[1].content as string)).toBe('');
  });
});

// ============================================================
// Group B: 意图路由逻辑 — JSON 解析与验证
// ============================================================
describe('Group B: Intent Router JSON parsing logic', () => {
  /**
   * 模拟 createIntentRouterNode 中的 JSON 解析逻辑（完全一致）
   * 注意: labels 返回原始顺序（未排序），sortedByScore 仅用于确定 intent
   */
  function parseIntentOutput(
    raw: string,
  ): { intent: string; labels: { label: string; score: number }[] } {
    const trimmed = raw.trim();
    const jsonStr = trimmed
      .replace(/```json\s*/g, '')
      .replace(/```\s*/g, '');
    let parsed: any;
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      const singleWord = trimmed.toLowerCase().trim();
      const validIntents = VALID_INTENTS;
      const fallbackIntent = validIntents.includes(singleWord)
        ? singleWord
        : 'general';
      return {
        intent: fallbackIntent,
        labels: [{ label: fallbackIntent, score: 0.7 }],
      };
    }

    const intent: string = parsed?.intent || 'general';
    let labels: { label: string; score: number }[] = parsed?.labels;

    if (!Array.isArray(labels) || labels.length === 0) {
      labels = [{ label: intent, score: 0.7 }];
    }

    labels = labels.filter(
      (l: any) =>
        typeof l.label === 'string' &&
        typeof l.score === 'number' &&
        l.score >= 0 &&
        l.score <= 1,
    );

    if (labels.length === 0) {
      labels = [{ label: intent, score: 0.7 }];
    }

    // sortedByScore 仅用于确定 primaryIntent，labels 返回原始顺序
    const sortedByScore = [...labels].sort((a, b) => b.score - a.score);
    const primaryIntent = sortedByScore[0].label;

    return { intent: primaryIntent, labels };
  }

  it('B1: single-label JSON', () => {
    const result = parseIntentOutput(
      JSON.stringify({ intent: 'order', labels: [{ label: 'order', score: 0.92 }] }),
    );
    expect(result.intent).toBe('order');
    expect(result.labels).toEqual([{ label: 'order', score: 0.92 }]);
  });

  it('B2: multi-label JSON', () => {
    const result = parseIntentOutput(
      JSON.stringify({
        intent: 'order',
        labels: [
          { label: 'order', score: 0.92 },
          { label: 'coupon', score: 0.75 },
        ],
      }),
    );
    expect(result.intent).toBe('order');
    expect(result.labels).toHaveLength(2);
  });

  it('B3: JSON inside markdown code blocks', () => {
    const raw =
      '```json\n{"intent": "wallet", "labels": [{"label": "wallet", "score": 0.95}]}\n```';
    const result = parseIntentOutput(raw);
    expect(result.intent).toBe('wallet');
    expect(result.labels[0].score).toBe(0.95);
  });

  it('B4: fallback to single word when JSON parse fails', () => {
    const result = parseIntentOutput('order');
    expect(result.intent).toBe('order');
    expect(result.labels[0]).toEqual({ label: 'order', score: 0.7 });
  });

  it('B5: fallback to general for unknown word', () => {
    const result = parseIntentOutput('blahblah');
    expect(result.intent).toBe('general');
  });

  it('B6: empty labels array creates default', () => {
    const result = parseIntentOutput(
      JSON.stringify({ intent: 'coupon', labels: [] }),
    );
    expect(result.intent).toBe('coupon');
    expect(result.labels).toEqual([{ label: 'coupon', score: 0.7 }]);
  });

  it('B7: missing labels field creates default', () => {
    const result = parseIntentOutput(JSON.stringify({ intent: 'product' }));
    expect(result.intent).toBe('product');
    expect(result.labels).toEqual([{ label: 'product', score: 0.7 }]);
  });

  it('B8: filter out invalid label entries', () => {
    const result = parseIntentOutput(
      JSON.stringify({
        intent: 'order',
        labels: [
          { label: 'order', score: 0.9 },
          { label: 'coupon', score: 1.5 }, // out of range
          { label: 'wallet', score: -0.1 }, // out of range
          { label: 123, score: 0.8 }, // non-string label
          { label: 'product', score: 0.7 },
        ],
      }),
    );
    expect(result.labels).toHaveLength(2);
    expect(result.labels.map((l) => l.label).sort()).toEqual(['order', 'product']);
  });

  it('B9: intent is highest-scoring label regardless of input order', () => {
    // Labels in arbitrary order; score 0.9 (order) is highest
    const result = parseIntentOutput(
      JSON.stringify({
        intent: 'order',
        labels: [
          { label: 'general', score: 0.1 },
          { label: 'order', score: 0.9 },
          { label: 'coupon', score: 0.5 },
        ],
      }),
    );
    // intent should be 'order' (highest score = 0.9)
    expect(result.intent).toBe('order');
    // labels returns original order (not sorted)
    expect(result.labels[0]).toEqual({ label: 'general', score: 0.1 });
    expect(result.labels[1]).toEqual({ label: 'order', score: 0.9 });
    expect(result.labels[2]).toEqual({ label: 'coupon', score: 0.5 });
  });

  it('B10: all labels filtered out uses intent default', () => {
    const result = parseIntentOutput(
      JSON.stringify({
        intent: 'wallet',
        labels: [
          { label: 'wallet', score: 999 },
          { label: 'order', score: -5 },
        ],
      }),
    );
    expect(result.intent).toBe('wallet');
    expect(result.labels).toEqual([{ label: 'wallet', score: 0.7 }]);
  });
});

// ============================================================
// Group C: 边界情况
// ============================================================
describe('Group C: Edge cases', () => {
  it('C1: empty string input', async () => {
    const prompt = ChatPromptTemplate.fromMessages([
      ['system', 'test: {previousIntent}'],
      ['human', '{input}'],
    ]);
    const r = await prompt.formatMessages({ input: '', previousIntent: 'general' });
    expect((r[1].content as string)).toBe('');
  });

  it('C2: very long input', async () => {
    const prompt = ChatPromptTemplate.fromMessages([
      ['system', 'test: {previousIntent}'],
      ['human', '{input}'],
    ]);
    const r = await prompt.formatMessages({
      input: 'x'.repeat(5000),
      previousIntent: 'g',
    });
    expect((r[1].content as string).length).toBe(5000);
  });

  it('C3: multi-turn formatMessages works', async () => {
    const prompt = ChatPromptTemplate.fromMessages([
      ['system', 'prev: {previousIntent}'],
      ['human', '{input}'],
    ]);

    const r1 = await prompt.formatMessages({
      input: 'show orders',
      previousIntent: 'none',
    });
    expect((r1[0].content as string)).toBe('prev: none');

    const r2 = await prompt.formatMessages({
      input: 'check balance',
      previousIntent: 'order',
    });
    expect((r2[0].content as string)).toBe('prev: order');
  });
});
