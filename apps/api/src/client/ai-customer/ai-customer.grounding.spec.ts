import { AiCustomerService } from './ai-customer.service';
import { NO_EVIDENCE_HANDOFF_REPLY } from './graph/nodes/orchestrator-utils/grounding-gate';

jest.mock('uuid', () => ({ v4: jest.fn(() => 'test-token') }));
jest.mock('meilisearch', () => ({ Meilisearch: class {} }));
jest.mock('./ai-reply-publisher', () => ({
  publishAiReply: jest.fn(async () => {}),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { publishAiReply } = require('./ai-reply-publisher');

/**
 * 依据门禁 —— 发布点三态开关。
 *
 * off     : 行为与上线前完全一致
 * shadow  : 不改回复，只把决定写进 state（随后落 trace）
 * enforce : 业务意图 + 完全无依据 + 非澄清 → 换成转人工话术
 *
 * 澄清追问和闲聊必须放行，否则用户感知是「AI 突然变笨」。
 */
function makeService(values: Record<string, any>) {
  const prisma = {
    $executeRaw: jest.fn(async () => 1),
    conversation: {
      findFirst: jest.fn(async () => ({ id: 'conv-1' })),
      findUnique: jest.fn(async () => ({ aiMetadata: null })),
      update: jest.fn(async () => ({ id: 'conv-1' })),
    },
    chatMessage: { findFirst: jest.fn(async () => null) },
  };
  const gateway = { dispatchToConversation: jest.fn() };
  const eventEmitter = { emit: jest.fn() };
  const unused = () => ({}) as any;

  const service = new AiCustomerService(
    { get: jest.fn(() => undefined) } as any,
    unused(),
    unused(),
    prisma as any,
    unused(),
    unused(),
    unused(),
    unused(),
    gateway as any,
    unused(),
    unused(),
    unused(),
    unused(),
    unused(),
    unused(),
    unused(),
    unused(),
    eventEmitter as any,
    { recordImplicit: jest.fn(async () => undefined) } as any,
    { ensureBindingQuietly: jest.fn(async () => undefined) } as any,
    unused(),
    undefined,
    undefined,
    undefined,
  );

  (service as any).compiledGraph = {
    getState: jest.fn(async () => ({ values })),
  };
  (service as any).guardCompletionClaims = jest.fn(
    async (_conversationId: string, _startedAt: number, messages: any[]) =>
      messages,
  );

  return { service, prisma, gateway };
}

function callFinalize(
  service: AiCustomerService,
  _newMessages: any[],
  streamUsage?: any,
  /** 用户本轮提问；降级话术跟随它的语言 */
  userText = '退款多久到账？',
) {
  const callbacks = { onDone: jest.fn(), onTransfer: jest.fn() };
  return (service as any)
    .finalizeAfterStream(
      'thread-1',
      0,
      'user-1',
      'conv-1',
      callbacks,
      Date.now() - 10,
      10,
      ['user-1'],
      'msg-1',
      streamUsage,
      userText,
    )
    .then((result: any) => ({ result, callbacks }));
}

describe('依据门禁 · 发布点', () => {
  const originalMode = process.env.AI_GROUNDING_GATE;

  afterEach(() => {
    if (originalMode === undefined) delete process.env.AI_GROUNDING_GATE;
    else process.env.AI_GROUNDING_GATE = originalMode;
    jest.clearAllMocks();
  });

  it('off：完全不改行为，也不记录决定', async () => {
    process.env.AI_GROUNDING_GATE = 'off';
    const reply = [{ type: 'ai', content: '退款需要 3-5 个工作日。' }];
    const values = { intent: 'order', messages: reply };
    const { service } = makeService(values);

    const { result } = await callFinalize(service, reply);

    expect(result.status).toBe('SUCCESS');
    expect(values).not.toHaveProperty('groundingGate');
    expect(publishAiReply).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      'conv-1',
      reply,
      'user-1',
      ['user-1'],
      undefined,
      'msg-1',
    );
  });

  it('shadow：记录 degrade 决定，但回复原样发布', async () => {
    process.env.AI_GROUNDING_GATE = 'shadow';
    const reply = [{ type: 'ai', content: '退款需要 3-5 个工作日。' }];
    const values = { intent: 'order', messages: reply };
    const { service } = makeService(values);

    const { result } = await callFinalize(service, reply);

    expect(result.status).toBe('SUCCESS');
    expect((values as any).groundingGate).toMatchObject({
      mode: 'shadow',
      decision: 'degrade',
      grounding: 'none',
      intent: 'order',
      clarificationOnly: false,
    });
    expect(result.newMessages).toEqual(reply);
    expect(publishAiReply).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      'conv-1',
      reply,
      'user-1',
      ['user-1'],
      undefined,
      'msg-1',
    );
  });

  it('enforce：无依据的业务回答换成转人工话术', async () => {
    process.env.AI_GROUNDING_GATE = 'enforce';
    const reply = [{ type: 'ai', content: '退款需要 3-5 个工作日。' }];
    const values = { intent: 'order', messages: reply };
    const { service } = makeService(values);

    const { result } = await callFinalize(service, reply);

    expect(result.status).toBe('TRANSFERRED');
    expect(result.transferReason).toBe('no_evidence');
    expect(result.newMessages).toEqual([
      { type: 'ai', content: NO_EVIDENCE_HANDOFF_REPLY },
    ]);
    expect(values).toMatchObject({
      transferToHuman: true,
      transferReason: 'no_evidence',
    });
    expect(publishAiReply).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      'conv-1',
      [{ type: 'ai', content: NO_EVIDENCE_HANDOFF_REPLY }],
      'user-1',
      ['user-1'],
      undefined,
      'msg-1',
    );
  });

  it('enforce：英文问句降级时话术也是英文', async () => {
    process.env.AI_GROUNDING_GATE = 'enforce';
    const reply = [
      { type: 'ai', content: 'Refunds take 3-5 business days.' },
    ];
    const values = { intent: 'order', messages: reply };
    const { service } = makeService(values);

    const { result } = await callFinalize(
      service,
      reply,
      undefined,
      'How long does a refund take?',
    );

    expect(result.status).toBe('TRANSFERRED');
    const replacement = result.newMessages[0].content as string;
    expect(replacement).not.toMatch(/[一-鿿]/);
    expect(replacement).toContain('human agent');
  });

  it('enforce：无依据但没有事实断言的流程性回复不降级', async () => {
    process.env.AI_GROUNDING_GATE = 'enforce';
    // 动作流里等待确认卡的文字回复：既没工具结果也没检索，但也没断言任何事实
    const reply = [{ type: 'ai', content: '好的，我马上帮您创建这个收货地址。' }];
    const values = { intent: 'user', messages: reply };
    const { service } = makeService(values);

    const { result } = await callFinalize(service, reply);

    expect(result.status).toBe('SUCCESS');
    expect(result.newMessages).toEqual(reply);
    expect((values as any).groundingGate).toMatchObject({
      decision: 'allow',
      factualAssertion: false,
    });
  });

  it('enforce：纯澄清追问不降级', async () => {
    process.env.AI_GROUNDING_GATE = 'enforce';
    const reply = [{ type: 'ai', content: '请问您的订单号是多少？' }];
    const values = { intent: 'order', messages: reply };
    const { service } = makeService(values);

    const { result } = await callFinalize(service, reply);

    expect(result.status).toBe('SUCCESS');
    expect(result.newMessages).toEqual(reply);
    expect((values as any).groundingGate).toMatchObject({
      decision: 'allow',
      clarificationOnly: true,
    });
  });

  it('enforce：闲聊不受门禁影响', async () => {
    process.env.AI_GROUNDING_GATE = 'enforce';
    const reply = [{ type: 'ai', content: '你好呀，今天想了解点什么？' }];
    const values = { intent: 'general', messages: reply };
    const { service } = makeService(values);

    const { result } = await callFinalize(service, reply);

    expect(result.status).toBe('SUCCESS');
    expect(result.newMessages).toEqual(reply);
    expect((values as any).groundingGate).toMatchObject({ decision: 'allow' });
  });

  it('enforce：有工具事实的回答不降级', async () => {
    process.env.AI_GROUNDING_GATE = 'enforce';
    const reply = [{ type: 'ai', content: '您的余额是 100 元。' }];
    const values = { intent: 'wallet', messages: reply };
    const { service } = makeService(values);

    const { result } = await callFinalize(service, reply, {
      totalTokens: 10,
      promptTokens: 5,
      completionTokens: 5,
      toolSpans: [
        {
          name: 'getWalletBalance',
          status: 'OK',
          durationMs: 5,
          argsSummary: null,
          startedAt: Date.now(),
        },
      ],
    });

    expect(result.status).toBe('SUCCESS');
    expect((values as any).groundingGate).toMatchObject({
      decision: 'allow',
      grounding: 'tool',
    });
  });
});
