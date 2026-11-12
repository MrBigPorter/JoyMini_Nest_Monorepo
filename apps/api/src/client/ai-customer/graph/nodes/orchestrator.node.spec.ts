import { HumanMessage } from '@langchain/core/messages';
import type { AgentState } from '../state';

/**
 * N-7 回归测试 —— 转人工必须在所有 fallback 之前
 *
 * 修复前的 bug：detectTransferRequest 判在 `labels.length === 0` 和 MIN_SCORE
 * 两条 fallback 之后。而"我要转人工"这种短句意图分数天然很低，
 * 于是先被当成闲聊 return，永远转不出去。
 *
 * 所以这里刻意把 labels 传成空数组（= 分数门槛必挂的场景）：
 *   - 修复前：走 handleGeneralChat，返回里没有 transferToHuman ❌
 *   - 修复后：走转人工分支，transferToHuman=true ✅
 * 没有这条用例，谁再把检测挪回 fallback 后面都不会有人发现。
 */

const invokeMock = jest.fn(async () => ({ content: 'I will transfer you now.' }));

jest.mock('@api/client/ai-customer/graph/llm-factory', () => ({
  createLLM: jest.fn(() => ({ invoke: invokeMock })),
}));

jest.mock('./orchestrator-utils/direct-handlers', () => ({
  handleGeneralChat: jest.fn(async () => ({
    messages: [],
    labels: [],
    pendingConfirm: null,
  })),
  handleRagQuery: jest.fn(),
}));

// 工具侧转人工：agent 的输出里带 [TRANSFER_TO_HUMAN] 标记时，
// pushAgentResult 会把 forceTransfer 置 true（result-utils.ts:80）
jest.mock('@api/client/ai-customer/graph/nodes/agent-factory', () => ({
  runStandardAgent: jest.fn(async () => ({
    result: { content: '已为您转接人工 [TRANSFER_TO_HUMAN]', error: undefined },
    tools: [],
    contextMessagesCount: 0,
  })),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createOrchestratorNode } = require('./orchestrator.node');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { handleGeneralChat } = require('./orchestrator-utils/direct-handlers');

function makeState(
  userText: string,
  labels: { label: string; score: number }[],
  overrides: Record<string, unknown> = {},
) {
  return {
    messages: [new HumanMessage(userText)],
    labels,
    intent: '',
    previousIntent: '',
    repeatCount: 0,
    userId: 'test-user',
    ...overrides,
  } as unknown as typeof AgentState.State;
}

describe('orchestrator · 转人工排序（N-7 回归）', () => {
  const node = createOrchestratorNode({} as any, {} as any);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('labels 为空时，"我要转人工" 仍然转人工，而不是落进 no_labels 闲聊', async () => {
    const result = await node(makeState('我要转人工', []));

    expect(result.transferToHuman).toBe(true);
    expect(result.transferReason).toBe('explicit_request');
    expect(handleGeneralChat).not.toHaveBeenCalled();
  });

  it('情绪词也能转，并带上真实原因', async () => {
    const result = await node(makeState('你们的客服气死我了', []));

    expect(result.transferToHuman).toBe(true);
    expect(result.transferReason).toBe('negative_sentiment');
  });

  it('普通问候 + 空 labels → 走 no_labels 闲聊，不转人工', async () => {
    const result = await node(makeState('你好', []));

    expect(result.transferToHuman).toBeFalsy();
    expect(handleGeneralChat).toHaveBeenCalledTimes(1);
  });

  it('转人工分支要同时发出 intent 和 transfer 两个事件（否则意图分布漏掉转人工）', async () => {
    const writes: string[] = [];
    const spy = jest
      .spyOn(process.stdout, 'write')
      .mockImplementation((chunk: any) => {
        writes.push(String(chunk));
        return true;
      });

    try {
      await node(makeState('我要转人工', []));
    } finally {
      spy.mockRestore();
    }

    const events = writes
      .filter((line) => line.trim().startsWith('{'))
      .map((line) => JSON.parse(line));

    const intent = events.find((e) => e.stage === 'intent');
    const transfer = events.find((e) => e.stage === 'transfer');

    expect(intent).toMatchObject({
      intent: 'transfer',
      fallback: 'transfer_request',
    });
    expect(transfer).toMatchObject({
      source: 'orchestrator',
      reason: 'explicit_request',
    });
  });

  it('agent 返回 [TRANSFER_TO_HUMAN] 时，也要补一条 transfer 事件（agent_request）', async () => {
    // 这是第二条转人工出口：工具/agent 自己判定要转人工。
    // 以前只置了 transferToHuman + transferReason，没发 transfer 事件，
    // 按 reason 统计转人工来源时这条出口完全看不见。
    const writes: string[] = [];
    const spy = jest
      .spyOn(process.stdout, 'write')
      .mockImplementation((chunk: any) => {
        writes.push(String(chunk));
        return true;
      });

    let result: any;
    try {
      result = await node(
        makeState('帮我查订单', [{ label: 'order', score: 0.95 }], {
          intent: 'order',
        }),
      );
    } finally {
      spy.mockRestore();
    }

    expect(result.transferToHuman).toBe(true);
    expect(result.transferReason).toBe('agent_request');

    const events = writes
      .filter((line) => line.trim().startsWith('{'))
      .map((line) => JSON.parse(line));

    expect(events.find((e) => e.stage === 'transfer')).toMatchObject({
      source: 'agent',
      reason: 'agent_request',
    });
  });
});
