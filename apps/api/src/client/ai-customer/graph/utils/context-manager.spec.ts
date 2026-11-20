import {
  estimateTokens,
  formatContextSummary,
  groupMessages,
  trimContextToBudget,
} from './context-manager';

const human = (content: string) => ({ type: 'human', content });
const ai = (content: string, toolCalls?: any[]) => ({
  type: 'ai',
  content,
  tool_calls: toolCalls,
});
const tool = (content: string) => ({ type: 'tool', content });

describe('context-manager · token 预算裁剪', () => {
  it('按预算丢弃更早的消息，保留最近消息', () => {
    const messages = Array.from({ length: 20 }, (_, i) =>
      human(`message-${i}-${'x'.repeat(200)}`),
    );

    const trimmed = trimContextToBudget(messages, {
      maxTokens: 500,
      minRecent: 2,
    });

    expect(trimmed.length).toBeLessThan(messages.length);
    expect(trimmed[trimmed.length - 1].content).toContain('message-19');
  });

  it('工具调用与结果成组：要么都保留，要么都裁掉', () => {
    const messages = [
      human('old'),
      ai('', [{ name: 'search', args: { q: 'x' }, id: 'call-1' }]),
      tool('result-1'),
      human('recent question'),
    ];

    const groups = groupMessages(messages);
    expect(groups).toHaveLength(3);
    expect(groups[1]).toHaveLength(2);

    const trimmed = trimContextToBudget(messages, {
      maxTokens: 20,
      minRecent: 1,
    });
    expect(trimmed.map((m: any) => m.type)).toEqual(['human']);
    // 被裁掉的 AI 不会留下孤立 ToolMessage
    expect(trimmed.some((m: any) => m.type === 'tool')).toBe(false);
  });

  it('单个超长工具组仍保留（不能切开），由调用方决定后续压缩', () => {
    const messages = [
      human('old'),
      ai('', [{ name: 'search', args: {}, id: 'call-1' }]),
      tool('x'.repeat(5000)),
    ];

    const trimmed = trimContextToBudget(messages, {
      maxTokens: 100,
      minRecent: 1,
    });

    expect(trimmed[0].type).toBe('ai');
    expect(trimmed[1].type).toBe('tool');
  });

  it('输入以孤立 ToolMessage 开头时丢弃它', () => {
    const trimmed = trimContextToBudget([tool('orphan'), human('hello')], {
      maxTokens: 1000,
    });
    expect(trimmed.map((m: any) => m.type)).toEqual(['human']);
  });

  it('token 估算随内容增长', () => {
    expect(estimateTokens(human('x'.repeat(100)))).toBeGreaterThan(
      estimateTokens(human('short')),
    );
  });
});

describe('context-manager · 结构化摘要', () => {
  it('包含 activeEntity / corrections / unresolved / pendingConfirm', () => {
    const summary = formatContextSummary(
      {
        activeEntity: '包包',
        slots: { color: 'black' },
        corrections: [{ from: '苹果手机', to: '包包', at: Date.now() }],
        unresolved: ['确认用户当前要找的是包包'],
      },
      { action: 'withdraw' },
    );

    expect(summary).toContain('activeEntity: 包包');
    expect(summary).toContain('苹果手机 -> 包包');
    expect(summary).toContain('unresolved');
    expect(summary).toContain('pendingConfirm: withdraw');
  });

  it('没有状态时不注入空摘要', () => {
    expect(
      formatContextSummary({
        activeEntity: '',
        slots: {},
        corrections: [],
        unresolved: [],
      }),
    ).toBe('');
  });
});
