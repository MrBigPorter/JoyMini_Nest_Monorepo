import { SocketEvents } from '@lucky/shared';
import { CHAT_EVENTS } from '@api/common/chat/events/chat.events';
import { AiCustomerService } from './ai-customer.service';
import {
  AI_FAILURE_REPLY,
  degradeToHuman,
  OFFLINE_HANDOFF_REPLY,
} from './ai-failure-handler';

// 服务依赖链里有模块 import uuid（纯 ESM），Jest CJS 加载不了；本套用例用不到真 uuid
jest.mock('uuid', () => ({ v4: jest.fn(() => 'test-token') }));
// meilisearch 客户端同样是纯 ESM；本套用例不触达检索，只要模块能加载
jest.mock('meilisearch', () => ({ Meilisearch: class {} }));
jest.mock('./ai-reply-publisher', () => ({
  publishAiReply: jest.fn(async () => {}),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { publishAiReply } = require('./ai-reply-publisher');

/**
 * Task 3 —— 转人工入口的在线客服检查
 *
 * 无客服在线时不能把会话推进排队态（那会让用户永远等不到人），
 * 而是保持 handlerId=null、留一条 callback 元数据与离线提示；
 * 有客服在线时行为保持不变。
 */
function makeConfig(values: Record<string, string> = {}) {
  return { get: jest.fn((key: string) => values[key]) };
}

function makeService(configValues: Record<string, string> = {}) {
  const config = makeConfig(configValues);
  const prisma = {
    $executeRaw: jest.fn(async () => 1),
    conversation: {
      findFirst: jest.fn(async (_args: any) => null),
      findUnique: jest.fn(async (_args: any): Promise<any> => ({
        aiMetadata: null,
      })),
      update: jest.fn(async (_args: any) => ({ id: 'conv-1' })),
    },
  };
  const gateway = { dispatchToConversation: jest.fn() };
  const eventEmitter = { emit: jest.fn() };
  const feedback = { recordImplicit: jest.fn(async (_input: any) => undefined) };
  const presence = {
    isAnyAgentOnline: jest.fn(async () => ({
      online: true,
      degraded: false,
      count: 1,
    })),
  };

  const unused = () => ({}) as any;
  const service = new AiCustomerService(
    config as any, // ConfigService
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
    eventEmitter as any, // EventEmitter2
    feedback as any, // AiFeedbackService
    unused(), // FlowStateVersioningService
    unused(), // AiConversationDebugService
    undefined, // TraceService (optional)
    undefined, // AiActionLifecycleService (optional)
    presence as any, // HandoffPresenceService (optional)
  );

  return { service, config, prisma, gateway, eventEmitter, feedback, presence };
}

describe('routeTransfer · 在线检查与离线留言（Task 3）', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('无客服在线：不写 awaiting_human，写 callback 元数据与离线提示', async () => {
    const { service, prisma, gateway, eventEmitter, feedback, presence } =
      makeService();
    presence.isAnyAgentOnline.mockResolvedValue({
      online: false,
      degraded: false,
      count: 0,
    });
    prisma.conversation.findUnique.mockResolvedValue({
      aiMetadata: { trafficSource: 'simulation_support_v1' },
    });

    await (service as any).routeTransfer(
      'user-1',
      'conv-1',
      'explicit_request',
      {},
      ['user-1'],
      [{ type: 'ai', content: '正在为您转接人工客服' }],
      'msg-1',
      '我想找人工客服',
    );

    // ① 不进入排队态：不写 handlerId/transferredAt
    expect(prisma.conversation.update).not.toHaveBeenCalled();
    // ② callback 用 jsonb 原子合并写入
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);

    // ③ 落离线提示，而不是 orchestrator 的“正在转接”
    expect(publishAiReply).toHaveBeenCalledTimes(1);
    const publishArgs = (publishAiReply as jest.Mock).mock.calls[0];
    expect(publishArgs[3]).toBe('conv-1');
    expect(publishArgs[4]).toEqual([
      { type: 'ai', content: OFFLINE_HANDOFF_REPLY },
    ]);
    expect(publishArgs[5]).toBe('user-1');
    expect(publishArgs[6]).toEqual(['user-1']);

    // ④ 通知端上走离线分支
    expect(gateway.dispatchToConversation).toHaveBeenCalledWith(
      'conv-1',
      ['user-1'],
      SocketEvents.AI_TRANSFER,
      { conversationId: 'conv-1', reason: 'explicit_request', mode: 'offline' },
    );

    // ⑤ 不发排队变更事件
    expect(eventEmitter.emit).not.toHaveBeenCalledWith(
      CHAT_EVENTS.SUPPORT_QUEUE_CHANGED,
      expect.anything(),
    );

    // ⑥ 仍记录隐式反馈
    expect(feedback.recordImplicit).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'conv-1',
        userId: 'user-1',
        signal: 'transferred',
      }),
    );
  });

  it('有客服在线：保持现有 awaiting_human 与 SUPPORT_QUEUE_CHANGED', async () => {
    const { service, prisma, gateway, eventEmitter, feedback, presence } =
      makeService();
    presence.isAnyAgentOnline.mockResolvedValue({
      online: true,
      degraded: false,
      count: 2,
    });

    const farewell = [{ type: 'ai', content: '正在为您转接人工客服' }];
    await (service as any).routeTransfer(
      'user-1',
      'conv-1',
      'explicit_request',
      {},
      ['user-1'],
      farewell,
      'msg-1',
    );

    const updateArg = prisma.conversation.update.mock.calls[0]![0] as any;
    expect(updateArg.data).toMatchObject({
      handlerId: 'awaiting_human',
      handlerAssignedAt: expect.any(Date),
      transferredAt: expect.any(Date),
      transferReason: 'explicit_request',
    });

    expect(publishAiReply).toHaveBeenCalledTimes(1);
    expect((publishAiReply as jest.Mock).mock.calls[0][4]).toEqual(farewell);

    expect(gateway.dispatchToConversation).toHaveBeenCalledWith(
      'conv-1',
      ['user-1'],
      SocketEvents.AI_TRANSFER,
      { conversationId: 'conv-1', reason: 'explicit_request', mode: 'online' },
    );

    expect(eventEmitter.emit).toHaveBeenCalledWith(
      CHAT_EVENTS.SUPPORT_QUEUE_CHANGED,
      expect.anything(),
    );
    expect(feedback.recordImplicit).toHaveBeenCalled();
  });

  it('HANDOFF_PRESENCE_CHECK_ENABLED=false：跳过检查，按在线处理', async () => {
    const { service, presence, prisma } = makeService({
      HANDOFF_PRESENCE_CHECK_ENABLED: 'false',
    });

    await (service as any).routeTransfer(
      'user-1',
      'conv-1',
      'explicit_request',
      {},
      ['user-1'],
      [{ type: 'ai', content: '正在为您转接人工客服' }],
      'msg-1',
    );

    expect(presence.isAnyAgentOnline).not.toHaveBeenCalled();
    expect(
      (prisma.conversation.update.mock.calls[0]![0] as any).data,
    ).toMatchObject({
      handlerId: 'awaiting_human',
      transferReason: 'explicit_request',
    });
  });
});

describe('degradeToHuman · 在线检查与离线留言（Task 3）', () => {
  function makeDeps(online: boolean) {
    const prisma = {
      conversation: {
        findUnique: jest.fn(async (_args: any): Promise<any> => ({
          aiMetadata: { trafficSource: 'simulation_support_v1' },
        })),
        update: jest.fn(async (_args: any) => ({ id: 'conv-1' })),
      },
    };
    const gateway = { dispatchToConversation: jest.fn() };
    const eventEmitter = { emit: jest.fn() };
    const logger = { warn: jest.fn() };
    const presence = {
      isAnyAgentOnline: jest.fn(async () => ({
        online,
        degraded: false,
        count: online ? 1 : 0,
      })),
    };
    const aiFeedback = {
      recordImplicit: jest.fn(async (_input: any) => undefined),
    };
    return {
      deps: {
        prisma: prisma as any,
        gateway: gateway as any,
        eventEmitter: eventEmitter as any,
        logger,
        presence: presence as any,
        presenceCheckEnabled: true,
        aiFeedback: aiFeedback as any,
      },
      prisma,
      gateway,
      eventEmitter,
      presence,
      aiFeedback,
    };
  }

  let stdoutSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    stdoutSpy = jest
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true);
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
  });

  it('无客服在线：保持 handlerId=null，写 callback 元数据并发离线提示', async () => {
    const { deps, prisma, gateway, aiFeedback } = makeDeps(false);

    await degradeToHuman(deps, {
      conversationId: 'conv-1',
      userId: 'user-1',
      memberIds: ['user-1'],
      userText: '我想找人工客服',
    });

    expect(publishAiReply).toHaveBeenCalledTimes(1);
    const publishArgs = (publishAiReply as jest.Mock).mock.calls[0];
    expect(publishArgs[4]).toEqual([
      { type: 'ai', content: OFFLINE_HANDOFF_REPLY },
    ]);

    const updateArg = prisma.conversation.update.mock.calls[0]![0] as any;
    expect(updateArg.data.handlerId).not.toBe('awaiting_human');
    expect(updateArg.data.transferredAt).toBeUndefined();
    expect(updateArg.data.aiMetadata).toMatchObject({
      trafficSource: 'simulation_support_v1',
      handoffCallback: {
        status: 'pending',
        reason: 'ai_error',
        requestedAt: expect.any(String),
      },
    });

    expect(gateway.dispatchToConversation).toHaveBeenCalledWith(
      'conv-1',
      ['user-1'],
      SocketEvents.AI_TRANSFER,
      { conversationId: 'conv-1', reason: 'ai_error', mode: 'offline' },
    );

    expect(aiFeedback.recordImplicit).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'conv-1',
        userId: 'user-1',
        signal: 'transferred',
      }),
    );
  });

  it('有客服在线：沿用兜底话术与 awaiting_human，并补发隐式反馈', async () => {
    const { deps, prisma, gateway, aiFeedback } = makeDeps(true);

    await degradeToHuman(deps, {
      conversationId: 'conv-1',
      userId: 'user-1',
      memberIds: ['user-1'],
      userText: '我想找人工客服',
    });

    expect((publishAiReply as jest.Mock).mock.calls[0][4]).toEqual([
      { type: 'ai', content: AI_FAILURE_REPLY },
    ]);
    expect(
      (prisma.conversation.update.mock.calls[0]![0] as any).data,
    ).toMatchObject({
      handlerId: 'awaiting_human',
      transferReason: 'ai_error',
    });
    expect(gateway.dispatchToConversation).toHaveBeenCalledWith(
      'conv-1',
      ['user-1'],
      SocketEvents.AI_TRANSFER,
      { conversationId: 'conv-1', reason: 'ai_error', mode: 'online' },
    );
    expect(aiFeedback.recordImplicit).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'conv-1',
        signal: 'transferred',
      }),
    );
  });
});
