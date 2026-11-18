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
});
