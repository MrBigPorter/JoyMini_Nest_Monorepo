import { runStandardAgent } from './agent-factory';

jest.mock('@api/client/ai-customer/graph/llm-factory', () => ({
  createLLM: jest.fn(() => ({ bindTools: jest.fn(() => ({})) })),
}));

jest.mock('@api/client/ai-customer/graph/agents/agent-runner', () => ({
  runAgentLoop: jest.fn(async () => ({
    content: 'ok',
    currentMessages: [],
    agentSteps: [],
    totalToolCalls: 0,
    iterations: 1,
    lastToolCallInfo: null,
    pendingToolCall: null,
  })),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  runAgentLoop,
} = require('@api/client/ai-customer/graph/agents/agent-runner');

function makeRegistry() {
  return {
    getToolsByTag: jest.fn((tag: string) =>
      tag === 'flow'
        ? [{ name: 'updateFlowData' }, { name: 'updateFlowStatus' }]
        : [{ name: 'getWalletBalance' }],
    ),
    getWriteToolNames: jest.fn(() => []),
  };
}

const promptConfig = {
  role: 'You are wallet assistant.',
  domainName: 'wallet',
  workflow: 'Collect info.',
  examples: 'User: balance',
  scopeRestriction: { domain: 'wallet', handles: ['balance'], outside: [] },
  flowContext: true,
};

describe('runStandardAgent · flowState 接通', () => {
  beforeEach(() => jest.clearAllMocks());

  it('注入 flow 工具，并把 accumulator 传给 runAgentLoop', async () => {
    const accumulator = {
      flowData: { amount: '500' },
      flowType: 'WITHDRAWAL' as const,
      flowStatus: 'FILLING' as const,
    };
    const registry = makeRegistry();

    const result = await runStandardAgent({
      userId: 'u1',
      messages: [],
      promptConfig: promptConfig as any,
      tag: 'wallet',
      agentName: 'wallet',
      llmConfig: {} as any,
      registry: registry as any,
      logger: { log: jest.fn(), error: jest.fn() } as any,
      flowDataAccumulator: accumulator,
    });

    const loopOptions = (runAgentLoop as jest.Mock).mock.calls[0][0];
    expect(loopOptions.tools.map((t: any) => t.name)).toEqual([
      'getWalletBalance',
      'updateFlowData',
      'updateFlowStatus',
    ]);
    expect(loopOptions.flowDataAccumulator).toBe(accumulator);
    expect(result.flowDataAccumulator).toBe(accumulator);
  });

  it('结构化上下文作为独立 system 消息注入，不写进历史消息', async () => {
    const registry = makeRegistry();

    await runStandardAgent({
      userId: 'u1',
      messages: [],
      promptConfig: promptConfig as any,
      tag: 'wallet',
      agentName: 'wallet',
      llmConfig: {} as any,
      registry: registry as any,
      logger: { log: jest.fn(), error: jest.fn() } as any,
      contextState: {
        activeEntity: '包包',
        slots: {},
        corrections: [{ from: '苹果手机', to: '包包', at: 1 }],
        unresolved: [],
      },
    });

    const initialMessages = (runAgentLoop as jest.Mock).mock.calls[0][0]
      .initialMessages;
    expect(initialMessages[0].content).toContain('You are wallet assistant');
    expect(initialMessages[1].content).toContain('activeEntity: 包包');
    expect(initialMessages[1].content).toContain('苹果手机 -> 包包');
  });

  it('不再强制关闭 flowContext：prompt 里出现当前流程状态', async () => {
    const registry = makeRegistry();

    await runStandardAgent({
      userId: 'u1',
      messages: [],
      promptConfig: promptConfig as any,
      tag: 'wallet',
      agentName: 'wallet',
      llmConfig: {} as any,
      registry: registry as any,
      logger: { log: jest.fn(), error: jest.fn() } as any,
      flowDataAccumulator: {
        flowData: {},
        flowType: 'WITHDRAWAL',
        flowStatus: 'FILLING',
      },
    });

    const initialMessages = (runAgentLoop as jest.Mock).mock.calls[0][0]
      .initialMessages;
    expect(initialMessages[0].content).toContain('Current Flow Context');
    expect(initialMessages[0].content).toContain('WITHDRAWAL');
    expect(initialMessages[0].content).toContain('FILLING');
  });
});
