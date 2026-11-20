import { HumanMessage } from '@langchain/core/messages';
import {
  INTENT_EXECUTION_MIN_SCORE,
  INTENT_LLM_FALLBACK_SCORE,
} from '@api/client/ai-customer/graph/config/intent-thresholds';
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

const invokeMock = jest.fn(async () => ({
  content: 'I will transfer you now.',
}));

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
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { runStandardAgent } = require('./agent-factory');

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

  it('0.5-0.7 区间：有分数但低于执行门槛 → 明确降级闲聊并记录 warn', async () => {
    // 分数高于 LLM fallback 门槛、低于执行门槛：有信号，但不值得派 Agent。
    // 这条路径过去只是 logger.log 一句，看起来像无痕变闲聊；
    // 现在必须发出结构化 warn，带分数/阈值/去向。
    const inGap = (INTENT_LLM_FALLBACK_SCORE + INTENT_EXECUTION_MIN_SCORE) / 2;

    const writes: string[] = [];
    const spy = jest
      .spyOn(process.stdout, 'write')
      .mockImplementation((chunk: any) => {
        writes.push(String(chunk));
        return true;
      });

    try {
      await node(
        makeState('hello there', [
          { label: 'order', score: inGap },
          { label: 'coupon', score: inGap - 0.01 },
        ]),
      );
    } finally {
      spy.mockRestore();
    }

    // 没被执行，落到闲聊
    expect(handleGeneralChat).toHaveBeenCalledTimes(1);

    const events = writes
      .filter((line) => line.trim().startsWith('{'))
      .map((line) => JSON.parse(line));
    const intent = events.find((e) => e.stage === 'intent');

    expect(intent).toMatchObject({
      intent: 'general',
      fallback: 'below_min_score',
      level: 'warn',
      score: Number(inGap.toFixed(2)),
      threshold: INTENT_EXECUTION_MIN_SCORE,
      destination: 'general_chat',
    });
    // 日志不能带用户原文
    expect(JSON.stringify(intent)).not.toContain('hello there');
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

  it('两轮对话：第一轮写入的 flowType/step/data 第二轮仍能读到', async () => {
    const nodeWithFlow = createOrchestratorNode({} as any, {} as any);

    // 模拟真实 factory：把 accumulator 写回给 orchestrator。
    (runStandardAgent as jest.Mock).mockImplementationOnce(
      async (opts: any) => {
        opts.flowDataAccumulator.flowType = 'WITHDRAWAL';
        opts.flowDataAccumulator.flowStatus = 'FILLING';
        opts.flowDataAccumulator.flowData.amount = '500';
        return {
          result: { content: 'How would you like to receive it?' },
          tools: [],
          contextMessagesCount: 1,
          flowDataAccumulator: opts.flowDataAccumulator,
        };
      },
    );

    const first = await nodeWithFlow(
      makeState('我要提现 500', [{ label: 'wallet', score: 0.95 }], {
        intent: 'wallet',
        flowState: { activeFlow: '', step: '', data: {} },
      }),
    );

    expect(first.flowState).toMatchObject({
      activeFlow: 'WITHDRAWAL',
      step: 'FILLING',
      data: { amount: '500' },
    });

    // 第二轮：新 state 只带上一轮的 flowState，不重新提供 amount。
    // 第二轮 agent 没有再调用 updateFlowData，但 accumulator 必须从 state 恢复。
    let seenAccumulator: any;
    (runStandardAgent as jest.Mock).mockImplementationOnce(
      async (opts: any) => {
        seenAccumulator = opts.flowDataAccumulator;
        return {
          result: { content: 'Confirm?' },
          tools: [],
          contextMessagesCount: 1,
          flowDataAccumulator: opts.flowDataAccumulator,
        };
      },
    );

    const second = await nodeWithFlow(
      makeState('继续', [{ label: 'wallet', score: 0.95 }], {
        intent: 'wallet',
        flowState: first.flowState,
      }),
    );

    expect(seenAccumulator).toMatchObject({
      flowType: 'WITHDRAWAL',
      flowStatus: 'FILLING',
      flowData: { amount: '500' },
    });
    expect(second.flowState).toMatchObject({
      activeFlow: 'WITHDRAWAL',
      step: 'FILLING',
      data: { amount: '500' },
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
