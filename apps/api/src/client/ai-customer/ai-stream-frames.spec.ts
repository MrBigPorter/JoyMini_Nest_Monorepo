import {
  buildStepFrame,
  isAllowedSseType,
  isStreamFrameWhitelistEnabled,
  sanitizeStepFrame,
} from './ai-stream-frames';

describe('ai-stream-frames', () => {
  const originalWhitelistFlag = process.env.AI_STREAM_FRAME_WHITELIST_ENABLED;

  afterEach(() => {
    if (originalWhitelistFlag === undefined) {
      delete process.env.AI_STREAM_FRAME_WHITELIST_ENABLED;
    } else {
      process.env.AI_STREAM_FRAME_WHITELIST_ENABLED = originalWhitelistFlag;
    }
  });

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

  describe('开关 AI_STREAM_FRAME_WHITELIST_ENABLED（3.4）', () => {
    it('默认开启，仅显式 "false" 关闭', () => {
      delete process.env.AI_STREAM_FRAME_WHITELIST_ENABLED;
      expect(isStreamFrameWhitelistEnabled()).toBe(true);

      process.env.AI_STREAM_FRAME_WHITELIST_ENABLED = 'true';
      expect(isStreamFrameWhitelistEnabled()).toBe(true);

      // 拼写/取值错误时不静默削弱安全边界
      process.env.AI_STREAM_FRAME_WHITELIST_ENABLED = '0';
      expect(isStreamFrameWhitelistEnabled()).toBe(true);

      process.env.AI_STREAM_FRAME_WHITELIST_ENABLED = 'FALSE';
      expect(isStreamFrameWhitelistEnabled()).toBe(true);

      process.env.AI_STREAM_FRAME_WHITELIST_ENABLED = 'false';
      expect(isStreamFrameWhitelistEnabled()).toBe(false);
    });

    it('开关开启时 step 帧只保留白名单字段', () => {
      process.env.AI_STREAM_FRAME_WHITELIST_ENABLED = 'true';

      const frame = buildStepFrame('tool_start', {
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

    it('开关关闭时 step 帧按变更前形态原样透传', () => {
      process.env.AI_STREAM_FRAME_WHITELIST_ENABLED = 'false';
      const data = {
        tool: 'getUserOrders',
        args: { userId: 'user-1' },
        decision: { intent: 'order', scores: [0.9] },
        prompt: 'internal prompt',
      };

      expect(buildStepFrame('tool_start', data)).toEqual({
        step: 'tool_start',
        ...data,
      });
    });

    it('开关关闭且无 data 时与变更前一致', () => {
      process.env.AI_STREAM_FRAME_WHITELIST_ENABLED = 'false';
      expect(buildStepFrame('thinking')).toEqual({ step: 'thinking' });
      delete process.env.AI_STREAM_FRAME_WHITELIST_ENABLED;
      expect(buildStepFrame('thinking')).toEqual({ step: 'thinking' });
    });
  });
});
