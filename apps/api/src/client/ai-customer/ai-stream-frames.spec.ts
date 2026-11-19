import { isAllowedSseType, sanitizeStepFrame } from './ai-stream-frames';

describe('ai-stream-frames', () => {
  it('只允许协议内 SSE 类型', () => {
    for (const type of ['token', 'step', 'done', 'error', 'transfer']) {
      expect(isAllowedSseType(type)).toBe(true);
    }
    for (const type of ['debug', 'decision', 'internal', '']) {
      expect(isAllowedSseType(type)).toBe(false);
    }
  });

  it('step 帧只保留 step/content/tool，丢弃内部字段', () => {
    const frame = sanitizeStepFrame('tool_start', {
      tool: 'getUserOrders',
      content: 'Looking up your orders...',
      args: { userId: 'user-1' },
      decision: { intent: 'order', scores: [0.9] },
      prompt: 'internal prompt',
    });

    expect(frame).toEqual({
      step: 'tool_start',
      tool: 'getUserOrders',
      content: 'Looking up your orders...',
    });
  });

  it('非字符串字段不会出网', () => {
    const frame = sanitizeStepFrame('thinking', {
      content: 123 as any,
      tool: { name: 'x' } as any,
    });

    expect(frame).toEqual({ step: 'thinking' });
  });
});
