import { ensureHandler } from '@langchain/core/callbacks/manager';
import {
  addUsageSnapshot,
  emptyUsageSnapshot,
  LlmUsageCollector,
  readLlmUsage,
} from './usage-collector';

/**
 * 用量采集器契约（eval-ingestion-hardening D5）：
 * 真实 → 回退 → 不可得三档，失败调用计调用数但不计 token。
 */

const messageOutput = (usage: Record<string, unknown>) => ({
  generations: [[{ text: 'x', message: { usage_metadata: usage } }]],
});

describe('readLlmUsage', () => {
  it('优先读消息的 usage_metadata', () => {
    expect(
      readLlmUsage(
        messageOutput({ input_tokens: 10, output_tokens: 5, total_tokens: 15 }),
      ),
    ).toEqual({ promptTokens: 10, completionTokens: 5, totalTokens: 15 });
  });

  it('缺 total_tokens 时由输入输出求和', () => {
    expect(
      readLlmUsage(messageOutput({ input_tokens: 4, output_tokens: 6 })),
    ).toEqual({ promptTokens: 4, completionTokens: 6, totalTokens: 10 });
  });

  it('回退 llmOutput.tokenUsage', () => {
    expect(
      readLlmUsage({
        generations: [[{ text: 'x' }]],
        llmOutput: {
          tokenUsage: { promptTokens: 7, completionTokens: 3 },
        },
      }),
    ).toEqual({ promptTokens: 7, completionTokens: 3, totalTokens: 10 });
  });

  it('两处都没有用量返回 null', () => {
    expect(readLlmUsage({ generations: [[{ text: 'x' }]], llmOutput: {} })).toBeNull();
    expect(readLlmUsage(undefined)).toBeNull();
    expect(readLlmUsage({})).toBeNull();
  });
});

describe('LlmUsageCollector', () => {
  it('三种输入分别记入：真实、回退真实、不可得', () => {
    const collector = new LlmUsageCollector('judge');

    collector.handleLLMEnd(
      messageOutput({ input_tokens: 10, output_tokens: 5, total_tokens: 15 }),
    );
    collector.handleLLMEnd({
      generations: [[{ text: 'x' }]],
      llmOutput: { tokenUsage: { promptTokens: 2, completionTokens: 3 } },
    });
    collector.handleLLMEnd({ generations: [[{ text: 'x' }]], llmOutput: {} });

    expect(collector.snapshot()).toEqual({
      role: 'judge',
      calls: 3,
      measuredCalls: 2,
      unavailableCalls: 1,
      promptTokens: 12,
      completionTokens: 8,
      totalTokens: 20,
    });
  });

  it('失败调用计入调用数，但不产生 token', () => {
    const collector = new LlmUsageCollector('chat');

    collector.handleLLMError(new Error('timeout'));

    expect(collector.snapshot()).toEqual({
      role: 'chat',
      calls: 1,
      measuredCalls: 0,
      unavailableCalls: 1,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    });
  });

  it('多次尝试求和：两成一败时 token 只来自成功调用', () => {
    const collector = new LlmUsageCollector('judge');

    collector.handleLLMEnd(
      messageOutput({ input_tokens: 10, output_tokens: 5, total_tokens: 15 }),
    );
    collector.handleLLMError(new Error('400 bad request'));
    collector.handleLLMEnd(
      messageOutput({ input_tokens: 20, output_tokens: 5, total_tokens: 25 }),
    );

    const snapshot = collector.snapshot();
    expect(snapshot.calls).toBe(3);
    expect(snapshot.unavailableCalls).toBe(1);
    expect(snapshot.totalTokens).toBe(40);
  });

  it('被 LangChain 回调管理器原样接受（不带 name 会被包装掉原型方法）', () => {
    const collector = new LlmUsageCollector('judge');

    // ensureHandler 对没有 name 的对象做 Object.assign(this, methods)：
    // 只复制自有属性，原型上的 handleLLMEnd 会丢，用量永远记不上。
    expect(ensureHandler(collector as any)).toBe(collector);
  });

  it('角色随构造传入，快照自带角色', () => {
    expect(new LlmUsageCollector('chat').snapshot().role).toBe('chat');
    expect(new LlmUsageCollector('judge').snapshot().role).toBe('judge');
  });

  it('异常输出不抛错（回调失败不能打断模型链）', () => {
    const collector = new LlmUsageCollector('judge');

    expect(() => collector.handleLLMEnd(null)).not.toThrow();
    expect(() => collector.handleLLMError()).not.toThrow();
    expect(collector.snapshot().calls).toBe(2);
    expect(collector.snapshot().unavailableCalls).toBe(2);
  });
});

describe('用量账本累加', () => {
  it('空账本：角色正确、全部为 0', () => {
    expect(emptyUsageSnapshot('chat')).toEqual({
      role: 'chat',
      calls: 0,
      measuredCalls: 0,
      unavailableCalls: 0,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    });
  });

  it('累加快照：逐项求和（判官多次尝试跨用例）', () => {
    const target = emptyUsageSnapshot('judge');
    addUsageSnapshot(target, {
      role: 'judge',
      calls: 3,
      measuredCalls: 2,
      unavailableCalls: 1,
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
    });
    addUsageSnapshot(target, {
      role: 'judge',
      calls: 1,
      measuredCalls: 1,
      unavailableCalls: 0,
      promptTokens: 2,
      completionTokens: 3,
      totalTokens: 5,
    });

    expect(target).toMatchObject({
      calls: 4,
      measuredCalls: 3,
      unavailableCalls: 1,
      promptTokens: 12,
      completionTokens: 8,
      totalTokens: 20,
    });
  });

  it('没有快照时累加是空操作（该用例没调判官）', () => {
    const target = emptyUsageSnapshot('judge');
    addUsageSnapshot(target, undefined);
    addUsageSnapshot(target, null);
    expect(target.calls).toBe(0);
  });
});
