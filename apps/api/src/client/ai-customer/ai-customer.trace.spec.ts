import { AiCustomerService } from './ai-customer.service';
import { renderMetrics, resetMetricsForTest } from '@api/common/metrics/metrics';

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
});
