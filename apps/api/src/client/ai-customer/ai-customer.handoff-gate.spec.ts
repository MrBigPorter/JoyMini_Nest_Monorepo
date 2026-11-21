import { ConversationStatus } from '@lucky/shared';
import { AiCustomerService } from './ai-customer.service';
import { ChatService } from '@api/common/chat/chat.service';
import { EventsGateway } from '@api/common/events/events.gateway';

// 依赖链里的纯 ESM 包在 Jest CJS 下无法直接加载；本套用例不触达它们。
jest.mock('uuid', () => ({ v4: jest.fn(() => 'test-uuid') }));
jest.mock('meilisearch', () => ({ Meilisearch: class {} }));
jest.mock('redis', () => ({ createClient: jest.fn() }));
jest.mock('@socket.io/redis-adapter', () => ({ createAdapter: jest.fn() }));

const unused = () => ({}) as any;

/**
 * Task 5 —— AI 门禁、复位消费与关闭重开。
 *
 * 三个关键行为：
 *   1. 人工处理中（handlerId != null）或非 NORMAL 的会话，消息照常落库，
 *      但不再跑图、不写 trace；
 *   2. 自动回 AI 后留下的 handoffResetPending 只消费一次，
 *      重置重复失败计数但保留上下文；
 *   3. 已归档的 SUPPORT 会话收到用户消息时，先按 CAS 重开，再走 AI。
 */

function makeAiService() {
  const prisma = {
    $executeRaw: jest.fn(async () => 1),
    conversation: {
      findUnique: jest.fn(),
      updateMany: jest.fn(),
    },
    chatMember: { findMany: jest.fn(async () => []) },
    chatMessage: {
      findFirst: jest.fn(async () => ({ id: 'ai-msg-1' })),
      delete: jest.fn(),
    },
  };
  const trace = { recordTrace: jest.fn(async () => ({ id: 'trace-1' })) };
  const gateway = { dispatchToConversation: jest.fn(), dispatch: jest.fn() };

  const service = new AiCustomerService(
    { get: jest.fn() } as any, // ConfigService
    unused(), // ToolRegistryService
    unused(), // AiService
    prisma as any, // PrismaService
    unused(), // RagRetrievalService
    unused(), // PromptResolverService
    unused(), // MeilisearchService
    unused(), // AiMemoryService
    gateway as any, // EventsGateway
    unused(), // AiActionConfirmService
    unused(), // AiUsageService
    unused(), // ClientWalletService
    unused(), // ClientCouponService
    unused(), // LuckyDrawService
    unused(), // AddressService
    unused(), // OtpService
    unused(), // RedisService
    { emit: jest.fn() } as any, // EventEmitter2
    unused(), // AiFeedbackService
    { registerStateRollbackHandler: jest.fn() } as any, // FlowStateVersioningService
    { registerInspector: jest.fn() } as any, // AiConversationDebugService
    trace as any, // TraceService (optional)
  );

  // chatStream 只依赖这个对象是否存在；门禁命中时不应再触达图。
  const graph = {
    updateState: jest.fn(async () => ({})),
    getState: jest.fn(async () => ({ values: { messages: [] } })),
    streamEvents: jest.fn(),
  };
  (service as any).compiledGraph = graph;

  return { service, prisma, trace, graph, gateway };
}

function makeCallbacks() {
  return {
    onToken: jest.fn(),
    onStep: jest.fn(),
    onDone: jest.fn(),
    onError: jest.fn(),
  };
}

describe('AiCustomerService.chatStream · AI 门禁', () => {
  it('handlerId!=null：消息落库但不跑图、不写 trace', async () => {
    const { service, prisma, trace, graph } = makeAiService();
    prisma.conversation.findUnique.mockResolvedValue({
      type: 'SUPPORT',
      status: ConversationStatus.NORMAL,
      handlerId: 'admin-1',
      threadId: 'thread-1',
      aiMetadata: null,
    });
    const callbacks = makeCallbacks();

    await service.chatStream('用户消息', 'u-1', 's-1', callbacks, 'conv-1');

    expect(callbacks.onDone).toHaveBeenCalledTimes(1);
    expect(callbacks.onError).not.toHaveBeenCalled();
    expect(graph.streamEvents).not.toHaveBeenCalled();
    expect(graph.updateState).not.toHaveBeenCalled();
    expect(trace.recordTrace).not.toHaveBeenCalled();
    // 门禁只跳过 AI，不负责删除已落库的消息
    expect(prisma.chatMessage.delete).not.toHaveBeenCalled();
  });

  it('status!=NORMAL（归档）：同样直接 onDone，不跑图', async () => {
    const { service, prisma, trace, graph } = makeAiService();
    prisma.conversation.findUnique.mockResolvedValue({
      type: 'SUPPORT',
      status: ConversationStatus.ARCHIVED,
      handlerId: null,
      threadId: 'thread-1',
      aiMetadata: null,
    });
    const callbacks = makeCallbacks();

    await service.chatStream('用户消息', 'u-1', 's-1', callbacks, 'conv-1');

    expect(callbacks.onDone).toHaveBeenCalledTimes(1);
    expect(graph.streamEvents).not.toHaveBeenCalled();
    expect(trace.recordTrace).not.toHaveBeenCalled();
  });
});

describe('AiCustomerService.consumeHandoffReset · 复位标记只消费一次', () => {
  const flag = {
    at: '2026-11-22T00:00:00.000Z',
    reason: 'inactive_timeout',
  };

  it('handoffResetPending：updateState 清零重复计数，并条件清除标记', async () => {
    const { service, prisma, graph } = makeAiService();
    prisma.conversation.findUnique.mockResolvedValue({
      aiMetadata: {
        trafficSource: 'simulation_support_v1',
        handoffResetPending: flag,
      },
    });
    prisma.conversation.updateMany.mockResolvedValue({ count: 1 });

    await service.consumeHandoffReset('conv-1', 'thread-1');

    expect(graph.updateState).toHaveBeenCalledWith(
      { configurable: { thread_id: 'thread-1' } },
      {
        repeatCount: 0,
        previousIntent: '',
        intent: '',
        labels: [],
        pendingConfirm: null,
        transferToHuman: false,
        transferReason: '',
      },
    );

    // 保留上下文：不删 messages、不清 userMemory / flowState
    const values = (graph.updateState as jest.Mock).mock.calls[0][1] as Record<
      string,
      unknown
    >;
    expect(values).not.toHaveProperty('messages');
    expect(values).not.toHaveProperty('userMemory');
    expect(values).not.toHaveProperty('flowState');

    // 原子删除标记；不再整份重写 aiMetadata。
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it('没有复位标记：不调用 updateState、不写库', async () => {
    const { service, prisma, graph } = makeAiService();
    prisma.conversation.findUnique.mockResolvedValue({
      aiMetadata: { trafficSource: 'simulation_support_v1' },
    });

    await service.consumeHandoffReset('conv-1', 'thread-1');

    expect(graph.updateState).not.toHaveBeenCalled();
    expect(prisma.conversation.updateMany).not.toHaveBeenCalled();
  });

  it('updateState 失败：保留标记，交给下一轮重试', async () => {
    const { service, prisma, graph } = makeAiService();
    prisma.conversation.findUnique.mockResolvedValue({
      aiMetadata: { handoffResetPending: flag },
    });
    graph.updateState.mockRejectedValueOnce(new Error('checkpoint down'));

    await service.consumeHandoffReset('conv-1', 'thread-1');

    expect(prisma.conversation.updateMany).not.toHaveBeenCalled();
  });

  it('会话没有 thread：跳过 updateState，只清标记', async () => {
    const { service, prisma, graph } = makeAiService();
    prisma.conversation.findUnique.mockResolvedValue({
      aiMetadata: { handoffResetPending: flag },
    });
    await service.consumeHandoffReset('conv-1', null);

    expect(graph.updateState).not.toHaveBeenCalled();
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
  });
});

// ==================================================================
//  HTTP / Socket 写消息前：ARCHIVED SUPPORT 会话先重开
// ==================================================================

function makeChatService() {
  const prisma: any = {
    chatMessage: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({
        id: 'msg-1',
        conversationId: 'conv-1',
        senderId: 'u-1',
        content: 'hi',
        type: 0,
        seqId: 1,
        createdAt: new Date('2026-11-22T00:00:00.000Z'),
        meta: null,
        sender: null,
      }),
    },
    conversation: {
      findUnique: jest.fn(),
      update: jest.fn().mockResolvedValue({
        lastMsgSeqId: 1,
        type: 'SUPPORT',
        businessId: null,
        handlerId: null,
      }),
    },
    chatMember: {
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    aiTaskOutbox: { create: jest.fn().mockResolvedValue({}) },
    $transaction: jest.fn(async (cb: (tx: any) => unknown) => cb(prisma)),
  };
  const relay = jest.fn().mockResolvedValue(undefined);
  const handoffLifecycle = { reopenForUser: jest.fn().mockResolvedValue(true) };
  const service = new ChatService(
    prisma,
    { emit: jest.fn() } as any,
    {} as any,
    {} as any,
    {} as any,
    { relayByMessageId: relay } as any,
    {} as any,
    handoffLifecycle as any,
  );
  return { service, prisma, relay, handoffLifecycle };
}

const chatDto = (id = 'client-msg-1') => ({
  id,
  conversationId: 'conv-1',
  content: 'hi',
  type: 0,
});

describe('ChatService.sendMessage · 关闭重开', () => {
  it('ARCHIVED 的 SUPPORT 会话收到消息：先重开再触发 AI', async () => {
    const { service, prisma, relay, handoffLifecycle } = makeChatService();
    prisma.conversation.findUnique.mockResolvedValue({
      type: 'SUPPORT',
      status: ConversationStatus.ARCHIVED,
    });

    await service.sendMessage('u-1', chatDto());

    expect(handoffLifecycle.reopenForUser).toHaveBeenCalledWith('conv-1');
    // 重开必须发生在写消息/AI 投递之前
    expect(
      handoffLifecycle.reopenForUser.mock.invocationCallOrder[0],
    ).toBeLessThan(prisma.$transaction.mock.invocationCallOrder[0]);
    expect(relay).toHaveBeenCalledWith('msg-1');
  });

  it('NORMAL 的 SUPPORT 会话不重开', async () => {
    const { service, prisma, handoffLifecycle } = makeChatService();
    prisma.conversation.findUnique.mockResolvedValue({
      type: 'SUPPORT',
      status: ConversationStatus.NORMAL,
    });

    await service.sendMessage('u-1', chatDto());

    expect(handoffLifecycle.reopenForUser).not.toHaveBeenCalled();
  });

  it('非 SUPPORT 的归档会话不重开', async () => {
    const { service, prisma, handoffLifecycle } = makeChatService();
    prisma.conversation.findUnique.mockResolvedValue({
      type: 'GROUP',
      status: ConversationStatus.ARCHIVED,
    });

    await service.sendMessage('u-1', chatDto());

    expect(handoffLifecycle.reopenForUser).not.toHaveBeenCalled();
  });

  it('并发消息：第二次 reopen CAS 返回 false 不会重复重开，消息仍照常落库', async () => {
    const { service, prisma, handoffLifecycle } = makeChatService();
    // 两次请求都在重开前看到 ARCHIVED；CAS 保证只有第一次成功。
    prisma.conversation.findUnique.mockResolvedValue({
      type: 'SUPPORT',
      status: ConversationStatus.ARCHIVED,
    });
    handoffLifecycle.reopenForUser
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    await service.sendMessage('u-1', chatDto('client-msg-1'));
    await service.sendMessage('u-1', chatDto('client-msg-2'));

    expect(handoffLifecycle.reopenForUser).toHaveBeenCalledTimes(2);
    expect(prisma.chatMessage.create).toHaveBeenCalledTimes(2);
    // ChatService 自己从不写系统消息；系统消息只由 lifecycle CAS 成功后写，
    // 第二次返回 false 时 lifecycle 不会再插一条。
    for (const call of prisma.chatMessage.create.mock.calls) {
      expect((call[0] as any).data.senderId).toBe('u-1');
    }
  });
});

function createFakeServer() {
  const emissions: Array<Record<string, unknown>> = [];
  const server = {
    // dispatch() 会读 room 的在线连接数
    adapter: { rooms: new Map<string, Set<string>>() },
    to(room: string) {
      return {
        emit(event: string, payload: any) {
          emissions.push({ room, event, payload });
        },
      };
    },
  };
  return { server, emissions };
}

function makeGateway() {
  const prisma: any = {
    chatMember: {
      findUnique: jest.fn().mockResolvedValue({ id: 'member-1' }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    conversation: { findUnique: jest.fn() },
    $transaction: jest.fn(),
  };
  const relay = jest.fn().mockResolvedValue(undefined);
  const handoffLifecycle = { reopenForUser: jest.fn().mockResolvedValue(true) };
  const gateway = new EventsGateway(
    {} as any, // jwtService
    prisma, // prismaService
    {} as any, // redisService
    { emit: jest.fn() } as any, // eventEmitter
    { get: jest.fn().mockReturnValue(undefined) } as any, // configService
    { relayByMessageId: relay } as any, // aiTaskOutboxService
    { tryAcquireLight: jest.fn().mockResolvedValue({ ok: true }) } as any,
    { get: jest.fn(() => handoffLifecycle) } as any, // ModuleRef
  );
  const { server } = createFakeServer();
  gateway.server = server;
  return { gateway, prisma, relay, handoffLifecycle };
}

function fakeSocket(userId: string) {
  return {
    id: 'sock-1',
    data: { userId },
    rooms: new Set<string>(),
    async join() {
      return undefined;
    },
  } as any;
}

function makeSendTx() {
  return {
    conversation: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      update: jest.fn().mockResolvedValue({}),
    },
    $queryRaw: jest.fn().mockResolvedValue([{ lastMsgSeqId: 1 }]),
    chatMessage: {
      create: jest.fn().mockResolvedValue({
        id: 'msg-1',
        conversationId: 'conv-1',
        senderId: 'u-1',
        content: 'hi',
        type: 0,
        seqId: 1,
        createdAt: new Date(),
        meta: null,
        sender: null,
      }),
    },
    aiTaskOutbox: { create: jest.fn().mockResolvedValue({}) },
  };
}

describe('EventsGateway.handleSendMessage · 关闭重开', () => {
  it('ARCHIVED 的 SUPPORT 会话收到消息：先重开再给 AI 投递', async () => {
    const { gateway, prisma, relay, handoffLifecycle } = makeGateway();
    // 第一次读到归档态 → 重开；重开后重新读取已是 NORMAL。
    prisma.conversation.findUnique
      .mockResolvedValueOnce({
        handlerId: null,
        type: 'SUPPORT',
        status: ConversationStatus.ARCHIVED,
      })
      .mockResolvedValueOnce({
        handlerId: null,
        type: 'SUPPORT',
        status: ConversationStatus.NORMAL,
      });
    const tx = makeSendTx();
    prisma.$transaction.mockImplementation(async (cb: any) => cb(tx));

    const result = await gateway.handleSendMessage(fakeSocket('u-1'), {
      conversationId: 'conv-1',
      content: 'hi',
      type: 0,
      tempId: 'tmp-1',
    });

    expect(result).toMatchObject({ status: 'ok', aiTriggered: true });
    expect(handoffLifecycle.reopenForUser).toHaveBeenCalledWith('conv-1');
    expect(
      handoffLifecycle.reopenForUser.mock.invocationCallOrder[0],
    ).toBeLessThan(prisma.$transaction.mock.invocationCallOrder[0]);
    expect(relay).toHaveBeenCalledWith('msg-1');
  });

  it('NORMAL 的 SUPPORT 会话不重开', async () => {
    const { gateway, prisma, handoffLifecycle } = makeGateway();
    prisma.conversation.findUnique.mockResolvedValue({
      handlerId: null,
      type: 'SUPPORT',
      status: ConversationStatus.NORMAL,
    });
    const tx = makeSendTx();
    prisma.$transaction.mockImplementation(async (cb: any) => cb(tx));

    await gateway.handleSendMessage(fakeSocket('u-1'), {
      conversationId: 'conv-1',
      content: 'hi',
      type: 0,
      tempId: 'tmp-1',
    });

    expect(handoffLifecycle.reopenForUser).not.toHaveBeenCalled();
  });
});
