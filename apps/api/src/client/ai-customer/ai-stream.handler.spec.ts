import { handleEventStream } from './ai-stream.handler';
import {
  getRequestUserId,
  getTraceId,
  runWithTrace,
} from '@api/common/logger/trace-context';

/**
 * 锁住 Agent 运行时边界的上下文传递：
 * handleEventStream 必须在进入 LangGraph 之前绑定 userId，
 * 并且不能把外层已有的 traceId 冲掉。
 */
describe('ai-stream.handler 请求上下文', () => {
  const registry = {
    getDisplayName: jest.fn().mockReturnValue('Fake Tool'),
  } as any;
  const gateway = {
    dispatchToConversation: jest.fn(),
  } as any;
  const callbacks = { onToken: jest.fn(), onStep: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('工具执行时能读到 userId，且保留外层 traceId', async () => {
    const seen: Array<{ userId?: string; traceId?: string }> = [];

    const graph = {
      // 用 async generator 模拟 LangGraph streamEvents：
      // 生成器体在 next() 时才执行，正好覆盖"上下文是否跨迭代传递"。
      streamEvents: () =>
        (async function* () {
          seen.push({ userId: getRequestUserId(), traceId: getTraceId() });
          yield {
            event: 'on_tool_start',
            data: {},
            name: 'fakeTool',
            metadata: { langgraph_node: 'orchestrator' },
            run_id: 'run-1',
          };
          yield {
            event: 'on_tool_end',
            data: {},
            name: 'fakeTool',
            metadata: { langgraph_node: 'orchestrator' },
            run_id: 'run-1',
          };
        })(),
    };

    await runWithTrace('trace-1', () =>
      handleEventStream(
        graph as any,
        'thread-1',
        'hello',
        'user-42',
        undefined,
        undefined,
        undefined,
        registry,
        gateway,
        callbacks,
      ),
    );

    expect(seen).toEqual([{ userId: 'user-42', traceId: 'trace-1' }]);
  });

  it('把 AbortSignal 作为 RunnableConfig.signal 传给 LangGraph', async () => {
    const controller = new AbortController();
    let captured: any;

    const graph = {
      streamEvents: jest.fn(async (_input: any, config: any) => {
        captured = config;
        return (async function* () {
          yield {
            event: 'on_chat_model_end',
            data: {},
            name: 'fakeModel',
            metadata: { langgraph_node: 'orchestrator' },
            run_id: 'run-1',
          };
        })();
      }),
    };

    await handleEventStream(
      graph as any,
      'thread-1',
      'hello',
      'user-42',
      undefined,
      undefined,
      undefined,
      registry,
      gateway,
      callbacks,
      [],
      controller.signal,
    );

    expect(captured.version).toBe('v2');
    expect(captured.configurable).toEqual({ thread_id: 'thread-1' });
    // 关键断言：signal 必须原样出现在 streamEvents 的 config 上
    expect(captured.signal).toBe(controller.signal);
  });

  it('signal 已 abort 时不再消费事件（兜底停止）', async () => {
    const controller = new AbortController();
    controller.abort();

    const graph = {
      streamEvents: jest.fn(async () =>
        (async function* () {
          yield {
            event: 'on_chat_model_stream',
            data: { chunk: { content: 'should-not-arrive' } },
            name: 'fakeModel',
            metadata: { langgraph_node: 'orchestrator' },
            run_id: 'run-1',
          };
        })(),
      ),
    };

    await handleEventStream(
      graph as any,
      'thread-1',
      'hello',
      'user-42',
      undefined,
      undefined,
      undefined,
      registry,
      gateway,
      callbacks,
      [],
      controller.signal,
    );

    expect(callbacks.onToken).not.toHaveBeenCalled();
    expect(gateway.dispatchToConversation).not.toHaveBeenCalled();
  });

  it('收集工具 span：成功与失败各一条，参数脱敏', async () => {
    const graph = {
      streamEvents: () =>
        (async function* () {
          yield {
            event: 'on_tool_start',
            data: { input: { phone: '09991234567' } },
            name: 'sendOtp',
            metadata: { langgraph_node: 'wallet' },
            run_id: 'run-ok',
          };
          yield {
            event: 'on_tool_end',
            data: { output: '{"ok":true,"data":{}}' },
            name: 'sendOtp',
            metadata: { langgraph_node: 'wallet' },
            run_id: 'run-ok',
          };
          yield {
            event: 'on_tool_start',
            data: { input: { couponId: 'c1' } },
            name: 'claimCoupon',
            metadata: { langgraph_node: 'coupon' },
            run_id: 'run-fail',
          };
          yield {
            event: 'on_tool_end',
            data: { output: 'Error: sold out' },
            name: 'claimCoupon',
            metadata: { langgraph_node: 'coupon' },
            run_id: 'run-fail',
          };
        })(),
    };

    const summary = await handleEventStream(
      graph as any,
      'thread-1',
      'hello',
      'user-42',
      undefined,
      undefined,
      undefined,
      registry,
      gateway,
      callbacks,
    );

    expect(summary.toolSpans).toHaveLength(2);
    expect(summary.toolSpans![0]).toMatchObject({
      name: 'sendOtp',
      status: 'OK',
    });
    expect(summary.toolSpans![0].argsSummary).not.toContain('09991234567');
    expect(summary.toolSpans![1]).toMatchObject({
      name: 'claimCoupon',
      status: 'ERROR',
    });
  });
});
