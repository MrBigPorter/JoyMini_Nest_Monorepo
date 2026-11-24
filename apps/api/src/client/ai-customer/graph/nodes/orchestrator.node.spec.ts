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

jest.mock('@api/client/ai-customer/graph/llm-factory', () => {
  // 必须包成真正的 Runnable：LangChain 的 pipe 只接受 Runnable，
  // 裸 `{ invoke }` 对象不会被当成模型调用，链路会把模型对象本身当输出。
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { RunnableLambda } = require('@langchain/core/runnables');
  return { createLLM: jest.fn(() => RunnableLambda.from(invokeMock)) };
});

jest.mock('./orchestrator-utils/direct-handlers', () => ({
  handleGeneralChat: jest.fn(async () => ({
    messages: [],
    labels: [],
    pendingConfirm: null,
  })),
  handleRagQuery: jest.fn(),
  retrieveKnowledge: jest.fn(async () => []),
}));

// 只包一层 spy，内部仍执行真实实现：用于断言「哪些输出进入了最终合成」。
jest.mock('./orchestrator-utils/result-utils', () => {
  const actual = jest.requireActual('./orchestrator-utils/result-utils');
  return { ...actual, synthesizeAnswers: jest.fn(actual.synthesizeAnswers) };
});

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

  it('纠正后再提旧实体：先澄清，不执行 Agent', async () => {
    const nodeWithContext = createOrchestratorNode({} as any, {} as any);
    (runStandardAgent as jest.Mock).mockClear();

    const result = await nodeWithContext(
      makeState('说说手机', [{ label: 'order', score: 0.95 }], {
        intent: 'order',
        contextState: {
          activeEntity: '包包',
          slots: {},
          corrections: [{ from: '苹果手机', to: '包包', at: Date.now() }],
          unresolved: [],
        },
      }),
    );

    const last = result.messages[result.messages.length - 1];
    expect(String(last.content)).toContain('苹果手机');
    expect(String(last.content)).toContain('包包');
    expect(runStandardAgent).not.toHaveBeenCalled();
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

/**
 * 强制检索：业务意图 + 信息类问题，回答前必须先问知识库。
 * 这里只验证「有没有发起检索、跳过原因是什么」；生成质量由端到端验收覆盖。
 */
describe('orchestrator · 信息类问题强制检索', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const {
    retrieveKnowledge,
    handleRagQuery,
  } = require('./orchestrator-utils/direct-handlers');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { synthesizeAnswers } = require('./orchestrator-utils/result-utils');

  const ragChunk = {
    chunkId: 'c1',
    chunkIndex: 0,
    content: 'Provincial delivery takes 5-8 business days.',
    documentId: 'd1',
    title: 'Shipping Policy',
    domain: 'order',
    docId: 'shipping-policy',
    keywords: [],
    priority: 'P0',
    contentType: 'faq',
    score: 0.8,
  };

  const buildNode = (options: { withRag?: boolean } = {}) => {
    const ragService =
      options.withRag === false ? undefined : { retrieve: jest.fn() };
    const rewriteService = {
      rewrite: jest.fn(async () => 'how long is shipping'),
    };
    return {
      ragService,
      rewriteService,
      node: createOrchestratorNode(
        {} as any,
        {} as any,
        ragService as any,
        undefined,
        undefined,
        rewriteService as any,
      ),
    };
  };

  beforeEach(() => {
    jest.clearAllMocks();
    retrieveKnowledge.mockResolvedValue([]);
  });

  it('业务意图 + 信息类问题 → 先检索，再把结果交给 RAG 生成', async () => {
    const { node, ragService, rewriteService } = buildNode();
    retrieveKnowledge.mockResolvedValue([ragChunk]);
    handleRagQuery.mockResolvedValue({
      messages: [{ content: '偏远地区 5-8 个工作日。' }],
      ragSources: [{ docId: 'shipping-policy' }],
    });

    const result = await node(
      makeState('宿务要几天才能送到', [{ label: 'order', score: 0.9 }]),
    );

    expect(retrieveKnowledge).toHaveBeenCalledWith(
      '宿务要几天才能送到',
      ragService,
      rewriteService,
    );
    expect(handleRagQuery).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      ragService,
      null,
      expect.objectContaining({ prefetchedResults: [ragChunk] }),
    );
    expect(result.retrievalMeta).toEqual({ attempted: true, skipReason: null });
    expect(result.ragSources).toEqual([{ docId: 'shipping-policy' }]);

    // 工具事实不能被知识库覆盖：两条输出都要进入合成
    const synthOutputs = synthesizeAnswers.mock.calls.at(-1)?.[1] ?? [];
    expect(synthOutputs.map((o: any) => o.label)).toEqual([
      'orderAgent',
      'rag',
    ]);
  });

  it('检索了但 0 候选 → attempted=true，与「没检索」可区分', async () => {
    const { node } = buildNode();
    retrieveKnowledge.mockResolvedValue([]);

    const result = await node(
      makeState('多久发货', [{ label: 'order', score: 0.9 }]),
    );

    expect(retrieveKnowledge).toHaveBeenCalledTimes(1);
    expect(result.retrievalMeta).toEqual({ attempted: true, skipReason: null });
  });

  it('预取超时 → 有界等待后按无候选继续，并记 timedOut', async () => {
    // p95 预算：检索比 Agent 慢时不能把收尾拖成串行（见 await-with-timeout.ts）
    const prev = process.env.AI_GROUNDING_PREFETCH_WAIT_MS;
    process.env.AI_GROUNDING_PREFETCH_WAIT_MS = '20';
    try {
      const { node } = buildNode();
      retrieveKnowledge.mockImplementation(() => new Promise(() => undefined));

      const result = await node(
        makeState('宿务要几天才能送到', [{ label: 'order', score: 0.9 }]),
      );

      expect(result.retrievalMeta).toEqual({
        attempted: true,
        skipReason: null,
        timedOut: true,
      });
      expect(handleRagQuery).not.toHaveBeenCalled();
    } finally {
      if (prev === undefined) delete process.env.AI_GROUNDING_PREFETCH_WAIT_MS;
      else process.env.AI_GROUNDING_PREFETCH_WAIT_MS = prev;
    }
  });

  it('信息类问句但意图不属于业务域 → 记 general_chat', async () => {
    const { node } = buildNode();

    const result = await node(
      makeState('怎么申请退款', [{ label: 'general', score: 0.9 }]),
    );

    expect(retrieveKnowledge).not.toHaveBeenCalled();
    expect(result.retrievalMeta).toEqual({
      attempted: false,
      skipReason: 'general_chat',
    });
    expect(handleGeneralChat).toHaveBeenCalledTimes(1);
  });

  it('非信息类问题不检索', async () => {
    const { node } = buildNode();

    const result = await node(
      makeState('我的余额是多少', [{ label: 'wallet', score: 0.9 }]),
    );

    expect(retrieveKnowledge).not.toHaveBeenCalled();
    expect(result.retrievalMeta).toEqual({
      attempted: false,
      skipReason: 'not_informational',
    });
  });

  it('待确认动作时跳过检索', async () => {
    const { node } = buildNode();

    const result = await node(
      makeState('多久能到账', [{ label: 'order', score: 0.9 }], {
        pendingConfirm: { action: 'claim_coupon', params: {} },
      }),
    );

    expect(retrieveKnowledge).not.toHaveBeenCalled();
    expect(result.retrievalMeta).toEqual({
      attempted: false,
      skipReason: 'pending_confirm',
    });
  });

  it('意图本身就是 rag 时不重复预取', async () => {
    const { node } = buildNode();
    handleRagQuery.mockResolvedValue({
      messages: [{ content: '规则如下。' }],
      ragSources: [{ docId: 'rules' }],
    });

    // 非信息类问句也照样算「检索过」：rag handler 自己会检索
    const result = await node(
      makeState('我的优惠券', [{ label: 'rag', score: 0.9 }]),
    );

    expect(retrieveKnowledge).not.toHaveBeenCalled();
    expect(result.retrievalMeta).toEqual({ attempted: true, skipReason: null });
  });

  it('检索服务不可用 → 不检索并记录原因', async () => {
    const { node } = buildNode({ withRag: false });

    const result = await node(
      makeState('多久发货', [{ label: 'order', score: 0.9 }]),
    );

    expect(result.retrievalMeta).toEqual({
      attempted: false,
      skipReason: 'service_unavailable',
    });
  });

  it('预取抛错 → 不阻塞回答，记录 service_error', async () => {
    const { node } = buildNode();
    retrieveKnowledge.mockRejectedValue(new Error('db down'));

    const result = await node(
      makeState('多久发货', [{ label: 'order', score: 0.9 }]),
    );

    expect(result.retrievalMeta).toEqual({
      attempted: false,
      skipReason: 'service_error',
    });
    expect(result.messages?.length).toBeGreaterThan(0);
  });
});

/**
 * 闲聊兜底前的知识库兜底。
 *
 * 2026-11-24 shadow 全量发现：29 条「无依据作答」里有 7 条是
 * 「意图是业务/知识类 + 问句是信息题，但向量分数低于执行门槛 → 落到闲聊」。
 * 这时候模型凭自带知识答政策题，正是要治的场景。
 */
describe('orchestrator · 闲聊兜底前的知识库检索', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { handleRagQuery } = require('./orchestrator-utils/direct-handlers');
  const { INTENT_LLM_FALLBACK_SCORE } = jest.requireActual(
    '@api/client/ai-customer/graph/config/intent-thresholds',
  );

  const buildNode = () => {
    const ragService = { retrieve: jest.fn() };
    const rewriteService = {
      rewrite: jest.fn(async () => 'coupon not working'),
    };
    return {
      ragService,
      rewriteService,
      node: createOrchestratorNode(
        {} as any,
        {} as any,
        ragService as any,
        undefined,
        undefined,
        rewriteService as any,
      ),
    };
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('无向量标签 + 业务意图 + 信息题 → 用知识库回答，不走闲聊', async () => {
    const { node, ragService, rewriteService } = buildNode();
    handleRagQuery.mockResolvedValue({
      messages: [{ content: '优惠券无法使用时请检查有效期。' }],
      ragSources: [{ docId: 'coupon-faq' }],
    });

    const result = await node(
      makeState('优惠券用不了怎么办？', [], { intent: 'rag' }),
    );

    expect(handleRagQuery).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      ragService,
      null,
      expect.objectContaining({ queryRewriteService: rewriteService }),
    );
    expect(handleGeneralChat).not.toHaveBeenCalled();
    expect(result.ragSources).toEqual([{ docId: 'coupon-faq' }]);
    expect(result.retrievalMeta).toEqual({ attempted: true, skipReason: null });
  });

  it('分数低于执行门槛 + 信息题 → 同样先用知识库', async () => {
    const { node } = buildNode();
    const inGap = (INTENT_LLM_FALLBACK_SCORE + INTENT_EXECUTION_MIN_SCORE) / 2;
    handleRagQuery.mockResolvedValue({
      messages: [{ content: '一般 5-8 个工作日送达。' }],
      ragSources: [{ docId: 'shipping' }],
    });

    const result = await node(
      makeState('多久能送到', [{ label: 'order', score: inGap }], {
        intent: 'order',
      }),
    );

    expect(handleGeneralChat).not.toHaveBeenCalled();
    expect(result.ragSources).toHaveLength(1);
    expect(result.retrievalMeta).toEqual({ attempted: true, skipReason: null });
  });

  it('检索了但 0 候选 → 回落到闲聊，并标记已检索', async () => {
    const { node } = buildNode();
    handleRagQuery.mockResolvedValue({
      messages: [{ content: '嗯嗯' }],
      ragSources: [],
    });

    const result = await node(
      makeState('优惠券用不了怎么办？', [], { intent: 'rag' }),
    );

    expect(handleGeneralChat).toHaveBeenCalledTimes(1);
    expect(result.retrievalMeta).toEqual({ attempted: true, skipReason: null });
  });

  it('意图不是业务/知识类 → 不检索', async () => {
    const { node } = buildNode();

    const result = await node(
      makeState('优惠券用不了怎么办？', [], { intent: 'general' }),
    );

    expect(handleRagQuery).not.toHaveBeenCalled();
    expect(handleGeneralChat).toHaveBeenCalledTimes(1);
    expect(result.retrievalMeta).toEqual({
      attempted: false,
      skipReason: 'not_informational',
    });
  });
});

/**
 * 提示词归因 —— 回答必须能追到「哪份提示词的哪个版本」。
 *
 * 归因错了比没有归因更糟：会把提示词优化/回滚的结论建立在假数据上。
 * 所以这里锁四件事：DB 覆盖、代码内置回退、多 agent 主绑定、跨轮不残留。
 */
describe('orchestrator · 提示词归因', () => {
  const makeNode = (promptResolver?: any) =>
    createOrchestratorNode({} as any, {} as any, undefined, promptResolver);

  const agentOk = (content = '好的') => ({
    result: { content, error: undefined },
    tools: [],
    contextMessagesCount: 0,
  });

  const walletState = () =>
    makeState('我的余额是多少', [{ label: 'wallet', score: 0.95 }], {
      intent: 'wallet',
    });

  beforeEach(() => {
    jest.clearAllMocks();
    (runStandardAgent as jest.Mock).mockReset();
    (runStandardAgent as jest.Mock).mockResolvedValue(agentOk());
  });

  it('DB 覆盖：记录真实 promptName/version，source=db', async () => {
    const promptResolver = {
      mergeConfig: jest.fn(async (tag: string) => ({
        config: {},
        version: 7,
        promptName: tag,
      })),
      recordEval: jest.fn(async () => undefined),
    };
    const result = await makeNode(promptResolver)(walletState());

    expect(promptResolver.mergeConfig).toHaveBeenCalledWith(
      'wallet',
      expect.anything(),
    );
    expect(result.promptBinding).toEqual({
      name: 'wallet',
      version: 7,
      source: 'db',
      agent: 'walletAgent',
    });
    expect(result.promptBindings).toEqual([result.promptBinding]);
  });

  it('无 DB 覆盖：name 回退 tag，version=null，source=code', async () => {
    const promptResolver = {
      mergeConfig: jest.fn(async () => ({
        config: {},
        version: null,
        promptName: null,
      })),
    };
    const result = await makeNode(promptResolver)(walletState());

    expect(result.promptBinding).toEqual({
      name: 'wallet',
      version: null,
      source: 'code',
      agent: 'walletAgent',
    });
  });

  it('多 agent：主绑定取第一个成功的，全部绑定都记录', async () => {
    // 分数接近 → 编排让 LLM 决定；这里明确回答 all，两个 agent 都执行。
    invokeMock.mockResolvedValueOnce({ content: 'all' });
    const result = await makeNode()(
      makeState(
        '我的余额和优惠券',
        [
          { label: 'wallet', score: 0.95 },
          { label: 'coupon', score: 0.9 },
        ],
        { intent: 'wallet' },
      ),
    );

    expect(result.promptBindings).toHaveLength(2);
    expect(
      result.promptBindings?.map((binding: any) => binding.agent).sort(),
    ).toEqual(['couponAgent', 'walletAgent']);
    // 主绑定 = 第一个成功执行的标准 agent（= 收集顺序的第一条）
    expect(result.promptBinding).toEqual(result.promptBindings?.[0]);
  });

  it('失败的 agent 不占主绑定', async () => {
    invokeMock.mockResolvedValueOnce({ content: 'all' });
    (runStandardAgent as jest.Mock).mockImplementation(async (opts: any) => {
      if (opts.tag === 'coupon') throw new Error('boom');
      return agentOk('余额 100 元');
    });

    const result = await makeNode()(
      makeState(
        '我的余额和优惠券',
        [
          { label: 'wallet', score: 0.95 },
          { label: 'coupon', score: 0.9 },
        ],
        { intent: 'wallet' },
      ),
    );

    expect(result.promptBinding).toMatchObject({
      name: 'wallet',
      agent: 'walletAgent',
    });
    expect(result.promptBindings?.map((binding: any) => binding.agent)).toEqual(
      ['walletAgent'],
    );
  });

  it('跨轮不残留：上一轮 DB 覆盖不会带到下一轮的代码内置', async () => {
    const mergeConfig = jest
      .fn()
      .mockResolvedValueOnce({ config: {}, version: 5, promptName: 'wallet' })
      .mockResolvedValueOnce({
        config: {},
        version: null,
        promptName: null,
      });
    const node = makeNode({
      mergeConfig,
      recordEval: jest.fn(async () => undefined),
    });

    const first = await node(walletState());
    expect(first.promptBinding).toEqual({
      name: 'wallet',
      version: 5,
      source: 'db',
      agent: 'walletAgent',
    });

    const second = await node(walletState());
    expect(second.promptBinding).toEqual({
      name: 'wallet',
      version: null,
      source: 'code',
      agent: 'walletAgent',
    });
    expect(second.promptBindings).toHaveLength(1);
  });
});
