import { AiCustomerService } from './ai-customer.service';
import {
  renderMetrics,
  resetMetricsForTest,
} from '@api/common/metrics/metrics';

jest.mock('uuid', () => ({ v4: jest.fn(() => 'test-token') }));
jest.mock('meilisearch', () => ({ Meilisearch: class {} }));

/**
 * 链路覆盖的前置条件：一次 AI 回复必须尝试写一条 trace，
 * 且写入结果要能在 /metrics 看到，否则「没有链路」永远无法被发现。
 */
function makeService(recordTrace: jest.Mock) {
  const unused = () => ({}) as any;
  const prisma = {
    chatMessage: { findFirst: jest.fn(async () => ({ id: 'ai-msg-1' })) },
  };
  const service = new AiCustomerService(
    unused(),
    unused(),
    unused(),
    prisma as any,
    unused(),
    unused(),
    unused(),
    unused(),
    unused(),
    unused(),
    unused(),
    unused(),
    unused(),
    unused(),
    unused(),
    unused(),
    unused(),
    unused(),
    unused(),
    unused(),
    unused(),
    { recordTrace } as any,
  );
  return { service, prisma };
}

describe('AiCustomerService · trace coverage', () => {
  beforeEach(() => resetMetricsForTest());

  it('成功回复写一条 trace，并带上意图/RAG/LLM 三段 span', async () => {
    const recordTrace = jest.fn(async (_input: any) => ({ id: 'trace-1' }));
    const { service, prisma } = makeService(recordTrace);

    await (service as any).recordReplyTrace({
      message: '我要提现 500 到银行卡',
      userId: 'u1',
      conversationId: 'c1',
      triggerMessageId: 'm1',
      startedAt: Date.now() - 30,
      status: 'SUCCESS',
      finalState: {
        values: {
          intent: 'wallet',
          previousIntent: 'wallet',
          flowState: { activeFlow: 'BALANCE_QUERY', step: 'COMPLETED' },
        },
      },
      newMessages: [{ content: '好的' }],
      ragSources: [],
      streamUsage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
    });

    expect(prisma.chatMessage.findFirst).toHaveBeenCalled();
    expect(recordTrace).toHaveBeenCalledTimes(1);
    const input = recordTrace.mock.calls[0]![0] as any;
    expect(input).toMatchObject({
      conversationId: 'c1',
      triggerMessageId: 'm1',
      aiMessageId: 'ai-msg-1',
      status: 'SUCCESS',
      intent: 'wallet',
    });
    expect(input.spans.map((span: any) => span.type)).toEqual([
      'intent',
      'rag',
      'llm',
    ]);
    expect(renderMetrics()).toContain(
      'ai_trace_recorded_total{path="reply",result="ok"} 1',
    );
  });

  it('trace 写入失败不影响对话，并记录 error 指标', async () => {
    const recordTrace = jest.fn(async (_input: any) => {
      throw new Error('db down');
    });
    const { service } = makeService(recordTrace);

    await expect(
      (service as any).recordReplyTrace({
        message: '你好',
        userId: 'u1',
        conversationId: 'c1',
        startedAt: Date.now(),
        status: 'SUCCESS',
        finalState: { values: {} },
        newMessages: [{ content: '你好' }],
        ragSources: [],
      }),
    ).resolves.toBeUndefined();

    expect(renderMetrics()).toContain(
      'ai_trace_recorded_total{path="reply",result="error"} 1',
    );
  });

  it('收尾前失败补写 ERROR trace', async () => {
    const recordTrace = jest.fn(async (_input: any) => ({ id: 'trace-2' }));
    const { service } = makeService(recordTrace);

    await (service as any).recordErrorTrace({
      message: '我要退款',
      userId: 'u1',
      conversationId: 'c1',
      triggerMessageId: 'm2',
      startedAt: Date.now() - 10,
      error: new Error('llm timeout'),
    });

    const input = recordTrace.mock.calls[0]![0] as any;
    expect(input.status).toBe('ERROR');
    expect(input.spans[0]).toMatchObject({ type: 'llm', status: 'ERROR' });
    expect(renderMetrics()).toContain(
      'ai_trace_recorded_total{path="error",result="ok"} 1',
    );
  });

  it('工具调用成功与失败各写一条 type=tool span', async () => {
    const recordTrace = jest.fn(async (_input: any) => ({ id: 'trace-3' }));
    const { service } = makeService(recordTrace);
    const now = Date.now();

    await (service as any).recordReplyTrace({
      message: '帮我领券',
      userId: 'u1',
      conversationId: 'c1',
      triggerMessageId: 'm1',
      startedAt: now - 100,
      status: 'SUCCESS',
      finalState: { values: { intent: 'coupon' } },
      newMessages: [{ content: '已领取' }],
      ragSources: [],
      streamUsage: {
        promptTokens: 1,
        completionTokens: 2,
        totalTokens: 3,
        toolSpans: [
          {
            name: 'claimCoupon',
            status: 'OK',
            durationMs: 12,
            argsSummary: '{"couponId":"c1"}',
            startedAt: now - 50,
          },
          {
            name: 'getUserCoupons',
            status: 'ERROR',
            durationMs: 7,
            argsSummary: '{"page":1}',
            startedAt: now - 40,
          },
        ],
      },
    });

    const input = recordTrace.mock.calls[0]![0] as any;
    const toolSpans = input.spans.filter((span: any) => span.type === 'tool');
    expect(toolSpans).toHaveLength(2);
    expect(toolSpans[0]).toMatchObject({
      type: 'tool',
      name: 'claimCoupon',
      status: 'OK',
      durationMs: 12,
      input: { argsSummary: '{"couponId":"c1"}' },
    });
    expect(toolSpans[1]).toMatchObject({
      type: 'tool',
      name: 'getUserCoupons',
      status: 'ERROR',
    });
  });
});

describe('AiCustomerService · 依据分型落库', () => {
  beforeEach(() => resetMetricsForTest());

  const reply = (content: string) => [{ type: 'ai', content }];
  const toolSpan = (status: 'OK' | 'ERROR') => ({
    name: 'getWalletBalance',
    status,
    durationMs: 5,
    argsSummary: null,
    startedAt: Date.now(),
  });

  async function record(options: {
    content: string;
    ragSourceCount?: number;
    toolSpans?: any[];
    retrievalMeta?: any;
  }) {
    const recordTrace = jest.fn(async (_input: any) => ({ id: 'trace-1' }));
    const { service } = makeService(recordTrace);
    await (service as any).recordReplyTrace({
      message: '问题',
      userId: 'u1',
      conversationId: 'c1',
      triggerMessageId: 'm1',
      startedAt: Date.now() - 10,
      status: 'SUCCESS',
      finalState: {
        values: {
          intent: 'order',
          messages: reply(options.content),
          retrievalMeta: options.retrievalMeta,
        },
      },
      newMessages: reply(options.content),
      ragSources: Array.from(
        { length: options.ragSourceCount ?? 0 },
        (_, n) => ({ docId: `doc-${n}`, content: 'x' }),
      ),
      streamUsage: {
        promptTokens: 1,
        completionTokens: 1,
        totalTokens: 2,
        toolSpans: options.toolSpans,
      },
    });
    return (recordTrace.mock.calls[0]![0] as any).metadata;
  }

  it('检索到知识库 → kb', async () => {
    const metadata = await record({ content: '3-5 天', ragSourceCount: 2 });
    expect(metadata).toMatchObject({ grounding: 'kb', toolCallCount: 0 });
  });

  it('工具成功调用 → tool', async () => {
    const metadata = await record({
      content: '余额 100 元',
      toolSpans: [toolSpan('OK')],
    });
    expect(metadata).toMatchObject({ grounding: 'tool', toolCallCount: 1 });
  });

  it('工具全失败 → 不算依据，落 none', async () => {
    const metadata = await record({
      content: '稍等',
      toolSpans: [toolSpan('ERROR')],
    });
    expect(metadata).toMatchObject({ grounding: 'none', toolCallCount: 0 });
  });

  it('既没检索也没工具 → none', async () => {
    const metadata = await record({ content: '退款需要 3-5 个工作日。' });
    expect(metadata).toMatchObject({ grounding: 'none', toolCallCount: 0 });
  });

  it('兜底话术 → fallback（即使调过工具）', async () => {
    const metadata = await record({
      content: '抱歉，我这边暂时处理不了你的问题，已经帮你转接人工客服，请稍等。',
      toolSpans: [toolSpan('OK')],
    });
    expect(metadata.grounding).toBe('fallback');
  });

  it('检索跳过原因写进 metadata.retrieval', async () => {
    const metadata = await record({
      content: '你好',
      retrievalMeta: { attempted: false, skipReason: 'pending_confirm' },
    });
    expect(metadata.retrieval).toEqual({
      attempted: false,
      skipReason: 'pending_confirm',
      timedOut: false,
    });
  });

  it('预取超时写进 metadata.retrieval.timedOut', async () => {
    const metadata = await record({
      content: '好的，我马上为您处理。',
      retrievalMeta: { attempted: true, skipReason: null, timedOut: true },
    });
    expect(metadata.retrieval).toEqual({
      attempted: true,
      skipReason: null,
      timedOut: true,
    });
  });
});

/**
 * 提示词归因落库 —— trace 的 prompt_name / prompt_version 是「回答→提示词」
 * 的唯一连接点。列只存主绑定，全部绑定留在 metadata 供多 agent 下钻。
 */
describe('AiCustomerService · 提示词归因落库', () => {
  beforeEach(() => resetMetricsForTest());

  async function record(values: Record<string, unknown>) {
    const recordTrace = jest.fn(async (_input: any) => ({ id: 'trace-1' }));
    const { service } = makeService(recordTrace);
    await (service as any).recordReplyTrace({
      message: '我的余额是多少',
      userId: 'u1',
      conversationId: 'c1',
      triggerMessageId: 'm1',
      startedAt: Date.now() - 10,
      status: 'SUCCESS',
      finalState: { values: { intent: 'wallet', ...values } },
      newMessages: [{ content: '余额 100 元' }],
      ragSources: [],
    });
    return recordTrace.mock.calls[0]![0] as any;
  }

  it('DB 覆盖：主绑定写列，全部绑定写 metadata', async () => {
    const input = await record({
      promptBinding: {
        name: 'wallet',
        version: 3,
        source: 'db',
        agent: 'walletAgent',
      },
      promptBindings: [
        { name: 'wallet', version: 3, source: 'db', agent: 'walletAgent' },
        { name: 'coupon', version: null, source: 'code', agent: 'couponAgent' },
      ],
    });

    expect(input.promptName).toBe('wallet');
    expect(input.promptVersion).toBe(3);
    expect(input.metadata).toMatchObject({ promptSource: 'db' });
    expect(input.metadata.promptBindings).toHaveLength(2);
    expect(input.metadata.promptBindings[1]).toMatchObject({
      name: 'coupon',
      source: 'code',
    });
  });

  it('代码内置：列存 tag，version 为 null，source=code', async () => {
    const input = await record({
      promptBinding: {
        name: 'general-chat',
        version: null,
        source: 'code',
        agent: 'general-chat',
      },
      promptBindings: [
        {
          name: 'general-chat',
          version: null,
          source: 'code',
          agent: 'general-chat',
        },
      ],
    });

    expect(input.promptName).toBe('general-chat');
    expect(input.promptVersion).toBeNull();
    expect(input.metadata).toMatchObject({ promptSource: 'code' });
  });

  it('本轮没有绑定：列与 metadata 都不残留', async () => {
    const input = await record({});

    expect(input.promptName).toBeNull();
    expect(input.promptVersion).toBeNull();
    expect(input.metadata).toMatchObject({ promptSource: null });
    expect(input.metadata.promptBindings).toBeUndefined();
  });
});
