import { ConflictException, NotFoundException } from '@nestjs/common';

// 依赖链里的模块 import uuid（纯 ESM），Jest CJS 加载不了；本套用例用不到真 uuid
jest.mock('uuid', () => ({ v4: jest.fn(() => 'test-uuid') }));

import { AdminChatService } from './admin-chat.service';
import { AWAITING_HUMAN } from '@api/common/chat/support-handler.service';

// ==================================================================
//  #98 S1：admin 认领接口的错误翻译（T2-5）
//
//  AdminChatService.claimConversation 不做判定，只做「三选一 → HTTP」：
//    claimed    → 200 { success, conversationId, handlerId }
//    conflict   → 409 会话还在，但已经被人接了
//    not_found  → 404 会话根本不存在
//
//  判定逻辑本身在 SupportHandlerService.claim 的 CAS 里，
//  已在 support-handler.service.spec.ts 覆盖，这里不重复测。
// ==================================================================

function createService(claimResult: any) {
  const prisma = {
    $executeRaw: jest.fn(async () => 1),
    conversation: { findMany: jest.fn(), count: jest.fn() },
  };
  const supportHandler = { claim: jest.fn().mockResolvedValue(claimResult) };
  const service = new AdminChatService(
    prisma as any,
    {} as any,
    {} as any,
    {} as any,
    supportHandler as any,
    { emit: jest.fn() } as any,
    { getAutoReturnAt: jest.fn().mockReturnValue(null) } as any,
  );
  return { service, prisma, supportHandler };
}

describe('AdminChatService.claimConversation 认领结果翻译（T2-5）', () => {
  it('claimed → 返回 success + 真实 handlerId', async () => {
    const { service, supportHandler } = createService({
      status: 'claimed',
      handlerId: 'admin-7',
    });

    const result = await service.claimConversation('conv-1', 'admin-7');

    expect(result).toEqual({
      success: true,
      conversationId: 'conv-1',
      handlerId: 'admin-7',
    });
    // 身份必须原样来自调用方传入的 adminId（它来自 JWT），不能是别的东西
    expect(supportHandler.claim).toHaveBeenCalledWith('conv-1', 'admin-7');
  });

  it('conflict → 409（会话存在，但已被别人接走）', async () => {
    const { service } = createService({ status: 'conflict' });

    await expect(
      service.claimConversation('conv-1', 'admin-2'),
    ).rejects.toThrow(ConflictException);
  });

  it('not_found → 404（会话不存在，不该让前端以为是"被抢了"）', async () => {
    const { service } = createService({ status: 'not_found' });

    await expect(
      service.claimConversation('conv-missing', 'admin-2'),
    ).rejects.toThrow(NotFoundException);
  });

  it('翻译层不碰库：判定完全交给 SupportHandlerService', async () => {
    const { service, prisma } = createService({
      status: 'claimed',
      handlerId: 'admin-7',
    });

    await service.claimConversation('conv-1', 'admin-7');

    expect(prisma.conversation.findMany).not.toHaveBeenCalled();
    expect(prisma.conversation.count).not.toHaveBeenCalled();
  });
});

// ==================================================================
//  #98 S2-A：待接入队列筛选（T2-5）
//
//  这里断言的是「送进数据库的那条 WHERE」，不是返回值好不好看。
//  三个回归点，每一个都是编译器抓不到的：
//    ① mine 的 adminId 只能来自函数参数（token），不能来自 dto
//    ② ai 用 null（IS NULL），不是字符串 'null'
//    ③ waitingSeconds 必须是数字 —— 写成函数时 JSON 会把它整个丢掉
// ==================================================================

const CONV_ROW = {
  id: 'conv-1',
  type: 'SUPPORT',
  name: '测试会话',
  status: 1,
  handlerId: AWAITING_HUMAN,
  transferReason: 'explicit_request',
  transferredAt: new Date(Date.now() - 120_000),
  handlerAssignedAt: new Date(),
  lastMsgContent: null,
  lastMsgTime: null,
  lastMsgSeqId: 0,
  members: [],
};

function createListService(rows: any[] = [], admins: any[] = []) {
  const prisma = {
    $executeRaw: jest.fn(async () => 1),
    conversation: {
      count: jest.fn().mockResolvedValue(rows.length),
      findMany: jest.fn().mockResolvedValue(rows),
    },
    adminUser: {
      findMany: jest.fn().mockResolvedValue(admins),
    },
  };
  const handoff = {
    getAutoReturnAt: jest.fn().mockReturnValue(null),
  };
  const service = new AdminChatService(
    prisma as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    { emit: jest.fn() } as any,
    handoff as any,
  );
  return { service, prisma, handoff };
}

/** 取出 findMany 实际收到的 where 条件 */
function whereOf(prisma: any) {
  return prisma.conversation.findMany.mock.calls[0][0].where;
}

describe('AdminChatService.getConversations 队列筛选（T2-5 / S2-A）', () => {
  it('queue=awaiting → handlerId = awaiting_human，并且只查未关闭的', async () => {
    const { service, prisma } = createListService();

    await service.getConversations({ queue: 'awaiting' } as any, 'admin-1');

    expect(whereOf(prisma)).toEqual(
      expect.objectContaining({
        handlerId: AWAITING_HUMAN,
        status: 1, // 已关闭的会话不该出现在排队列表里
      }),
    );
  });

  it('queue=mine → 用函数参数里的 adminId，不用 dto 里的任何东西', async () => {
    const { service, prisma } = createListService();

    await service.getConversations({ queue: 'mine' } as any, 'admin-7');

    // 这条断言防越权：若哪天有人把 adminId 改成读 dto，传别人的 id 就能查别人的会话
    expect(whereOf(prisma).handlerId).toBe('admin-7');
  });

  it('queue=ai → handlerId 是 null（IS NULL），不是字符串 "null"', async () => {
    const { service, prisma } = createListService();

    await service.getConversations({ queue: 'ai' } as any, 'admin-1');

    expect(whereOf(prisma).handlerId).toBeNull();
  });

  it('queue=all → 不产生 handlerId 条件（"全部"= 不筛选，不是筛某种值）', async () => {
    const { service, prisma } = createListService();

    await service.getConversations({ queue: 'all' } as any, 'admin-1');

    expect(whereOf(prisma)).not.toHaveProperty('handlerId');
  });

  it('queue=awaiting → 按 transferredAt 升序（等最久的排最前）', async () => {
    const { service, prisma } = createListService();

    await service.getConversations({ queue: 'awaiting' } as any, 'admin-1');

    // 不能用 handlerAssignedAt：它会被用户每发一条消息刷新，
    // 按它排序等于"刚催过的用户排到最后"。nulls last 让老数据垫底而不是抢占队首。
    expect(prisma.conversation.findMany.mock.calls[0][0].orderBy).toEqual({
      transferredAt: { sort: 'asc', nulls: 'last' },
    });
  });

  it('waitingSeconds 是数字（从 transferredAt 算），不是函数', async () => {
    const { service } = createListService([CONV_ROW]);

    const res = await service.getConversations(
      { queue: 'awaiting' } as any,
      'admin-1',
    );

    // 写成 () => number 时 Jest 也会显示 "not a function"，而 JSON 里字段会整个消失
    expect(typeof res.list[0].waitingSeconds).toBe('number');
    expect(res.list[0].waitingSeconds).toBeGreaterThanOrEqual(120);
  });

  it('没有排队时间（AI 会话）→ waitingSeconds 是 null，不是 0', async () => {
    const { service } = createListService([
      {
        ...CONV_ROW,
        handlerId: null,
        transferredAt: null,
        handlerAssignedAt: null,
      },
    ]);

    const res = await service.getConversations(
      { queue: 'ai' } as any,
      'admin-1',
    );

    // null = 没在排队；0 = 刚排队。两者不能混
    expect(res.list[0].waitingSeconds).toBeNull();
  });
});

// ==================================================================
//  #98 S2-B：回复即接管（T2-5）
//
//  三条路径：
//    排队中   → CAS 认领；失败 409 且【消息不发】
//    AI(null) → 条件更新接管；抢输也照发（帮答）
//    别人名下 → 照发，归属不动
// ==================================================================

function convRow(handlerId: string | null, aiMetadata: unknown = null) {
  return {
    id: 'conv-1',
    handlerId,
    status: 1,
    aiMetadata,
    members: [{ userId: 'bot-1', user: { id: 'bot-1', isRobot: true } }],
  };
}

function createReplyService(opts: {
  handlerId: string | null;
  aiMetadata?: unknown;
  convExists?: boolean;
  claimStatus?: 'claimed' | 'conflict' | 'not_found';
  takeCount?: number;
}) {
  const prisma = {
    $executeRaw: jest.fn(async () => 1),
    conversation: {
      findUnique: jest
        .fn()
        .mockResolvedValue(
          opts.convExists === false
            ? null
            : convRow(opts.handlerId, opts.aiMetadata),
        ),
      updateMany: jest.fn().mockResolvedValue({ count: opts.takeCount ?? 1 }),
    },
  };
  const chatService = {
    sendMessage: jest.fn().mockResolvedValue({
      id: 'msg-1',
      seqId: 1,
      content: '你好',
      createdAt: new Date(),
      meta: {},
    }),
  };
  const supportHandler = {
    claim: jest.fn().mockResolvedValue({
      status: opts.claimStatus ?? 'claimed',
      handlerId: 'admin-1',
    }),
  };
  const service = new AdminChatService(
    prisma as any,
    {} as any,
    {} as any,
    chatService as any,
    supportHandler as any,
    { emit: jest.fn() } as any,
    { getAutoReturnAt: jest.fn().mockReturnValue(null) } as any,
  );
  return { service, prisma, chatService, supportHandler };
}

const REPLY_DTO = { content: '您好，我帮您查', type: 0 } as any;

describe('AdminChatService.replyToConversation 回复即接管（T2-5 / S2-B）', () => {
  it('排队中 + 认领成功 → 消息发出，claimedNow=true，返回本人 handlerId', async () => {
    const { service, chatService } = createReplyService({
      handlerId: AWAITING_HUMAN,
      claimStatus: 'claimed',
    });

    const res = await service.replyToConversation(
      'conv-1',
      REPLY_DTO,
      '客服A',
      'admin-1',
    );

    expect(chatService.sendMessage).toHaveBeenCalledTimes(1);
    expect(res.claimedNow).toBe(true);
    expect(res.handlerId).toBe('admin-1');
  });

  it('排队中 + 认领撞车 → 409，并且这条消息【绝不能发】', async () => {
    const { service, chatService, supportHandler } = createReplyService({
      handlerId: AWAITING_HUMAN,
      claimStatus: 'conflict',
    });

    await expect(
      service.replyToConversation('conv-1', REPLY_DTO, '客服B', 'admin-2'),
    ).rejects.toThrow(ConflictException);

    // 这条断言是本节的核心：否则两个客服的话都会出现在用户屏幕上
    expect(supportHandler.claim).toHaveBeenCalled();
    expect(chatService.sendMessage).not.toHaveBeenCalled();
  });

  it('AI 处理中 → 接管成功，claimedNow=true', async () => {
    const { service, prisma } = createReplyService({
      handlerId: null,
      takeCount: 1,
    });

    const res = await service.replyToConversation(
      'conv-1',
      REPLY_DTO,
      '客服A',
      'admin-1',
    );

    // 条件更新必须只认 handlerId 仍为 null 的那一行
    expect(prisma.conversation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ handlerId: null }),
      }),
    );
    expect(res.claimedNow).toBe(true);
  });

  it('AI 处理中但被同事抢先 → 消息照发，claimedNow=false（帮答）', async () => {
    const { service, chatService } = createReplyService({
      handlerId: null,
      takeCount: 0,
    });

    const res = await service.replyToConversation(
      'conv-1',
      REPLY_DTO,
      '客服B',
      'admin-2',
    );

    expect(chatService.sendMessage).toHaveBeenCalledTimes(1);
    expect(res.claimedNow).toBe(false);
  });

  it('别人名下的会话 → 照发，归属不变', async () => {
    const { service, chatService, supportHandler, prisma } = createReplyService(
      {
        handlerId: 'admin-A',
      },
    );

    const res = await service.replyToConversation(
      'conv-1',
      REPLY_DTO,
      '客服B',
      'admin-B',
    );

    expect(chatService.sendMessage).toHaveBeenCalledTimes(1);
    expect(supportHandler.claim).not.toHaveBeenCalled();
    // 只断言"没改归属"，不断言"没写任何东西"——S2-C 之后还会写 firstResponseAt
    expect(prisma.conversation.updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ handlerId: 'admin-B' }),
      }),
    );
    expect(res.claimedNow).toBe(false);
    expect(res.handlerId).toBe('admin-A');
  });

  it('会话不存在 → 404（不是 TypeError / 500）', async () => {
    const { service, chatService } = createReplyService({
      handlerId: null,
      convExists: false,
    });

    await expect(
      service.replyToConversation(
        'conv-missing',
        REPLY_DTO,
        '客服A',
        'admin-1',
      ),
    ).rejects.toThrow(NotFoundException);
    expect(chatService.sendMessage).not.toHaveBeenCalled();
  });

  // ── #118 P1-4：客服回复必须落 human_agent ──────────────────────

  it('客服回复显式传 source=human_agent（否则洞察“人工消息”永远为 0）', async () => {
    const { service, chatService } = createReplyService({
      handlerId: 'admin-A',
    });

    await service.replyToConversation('conv-1', REPLY_DTO, '客服A', 'admin-1');

    expect(chatService.sendMessage).toHaveBeenCalledWith(
      'bot-1',
      expect.objectContaining({
        conversationId: 'conv-1',
        content: '您好，我帮您查',
      }),
      { source: 'human_agent' },
    );
  });

  // ── S2-C：首次回复时间 ──────────────────────────────────────────

  it('回复成功 → 用 where firstResponseAt=null 写首次回复时间（只写一次）', async () => {
    const { service, prisma } = createReplyService({ handlerId: 'admin-A' });

    await service.replyToConversation('conv-1', REPLY_DTO, '客服A', 'admin-1');

    // update 会覆盖；updateMany + where null 才能保证"首次"永远是首次
    expect(prisma.conversation.updateMany).toHaveBeenCalledWith({
      where: { id: 'conv-1', firstResponseAt: null },
      data: { firstResponseAt: expect.any(Date) },
    });
  });

  it('顺序探针：先发消息、后记时间（否则记录的是"没发出去"的时刻）', async () => {
    const { service, prisma, chatService } = createReplyService({
      handlerId: 'admin-A',
    });

    await service.replyToConversation('conv-1', REPLY_DTO, '客服A', 'admin-1');

    const sendOrder = chatService.sendMessage.mock.invocationCallOrder[0];
    // 别人名下的会话只会产生一次 updateMany，就是记时间的那次
    const recordOrder =
      prisma.conversation.updateMany.mock.invocationCallOrder[0];
    expect(recordOrder).toBeGreaterThan(sendOrder);
  });

  it('409 撞车路径 → 不写首次回复时间（消息本来就没发）', async () => {
    const { service, prisma } = createReplyService({
      handlerId: AWAITING_HUMAN,
      claimStatus: 'conflict',
    });

    await expect(
      service.replyToConversation('conv-1', REPLY_DTO, '客服B', 'admin-2'),
    ).rejects.toThrow(ConflictException);

    expect(prisma.conversation.updateMany).not.toHaveBeenCalled();
  });
});

// ==================================================================
//  Task 4：handlerAssignedAt = 最后人工活动
//
//  只有客服回复能刷新它；用户消息不刷新（由 chat.service / events.gateway
//  的用例覆盖）。刷新必须带 handlerId=当前客服 的条件：
//  帮答别人名下的会话不能延长别人的空闲计时。
// ==================================================================

describe('AdminChatService.replyToConversation 刷新人工活动时间（Task 4）', () => {
  it('回复成功后刷新 handlerAssignedAt，且限定 id+handlerId+status=NORMAL', async () => {
    const { service, prisma } = createReplyService({ handlerId: 'admin-1' });

    await service.replyToConversation('conv-1', REPLY_DTO, '客服A', 'admin-1');

    expect(prisma.conversation.updateMany).toHaveBeenCalledWith({
      where: { id: 'conv-1', handlerId: 'admin-1', status: 1 },
      data: { handlerAssignedAt: expect.any(Date) },
    });
  });

  it('回复成功后把 pending 的离线 callback 标记为 handled', async () => {
    const { service, prisma } = createReplyService({
      handlerId: 'admin-1',
      aiMetadata: {
        trafficSource: 'simulation_support_v1',
        handoffCallback: {
          status: 'pending',
          requestedAt: '2026-11-22T10:00:00.000Z',
          reason: 'offline',
        },
      },
    });

    await service.replyToConversation('conv-1', REPLY_DTO, '客服A', 'admin-1');

    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
  });
});

// ==================================================================
//  Task 4：switchHandler 走统一生命周期
// ==================================================================

function createSwitchService(conv: any) {
  const prisma = {
    $executeRaw: jest.fn(async () => 1),
    conversation: {
      findUnique: jest.fn().mockResolvedValue(conv),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const handoff = { returnToAi: jest.fn().mockResolvedValue(true) };
  const eventEmitter = { emit: jest.fn() };
  const service = new AdminChatService(
    prisma as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    eventEmitter as any,
    handoff as any,
  );
  return { service, prisma, handoff, eventEmitter };
}

describe('AdminChatService.switchHandler 统一生命周期（Task 4）', () => {
  it("切回 AI 调 returnToAi('admin_return')，不在本地直接写 DB", async () => {
    const { service, prisma, handoff } = createSwitchService({
      id: 'conv-1',
      handlerId: 'admin-9',
      status: 1,
      aiMetadata: null,
    });

    const res = await service.switchHandler('conv-1', 'ai', 'admin-9');

    expect(handoff.returnToAi).toHaveBeenCalledWith('conv-1', 'admin_return', {
      actor: 'admin-9',
    });
    expect(res).toMatchObject({ success: true, mode: 'ai' });
    // 状态写入只能发生在生命周期服务里
    expect(prisma.conversation.updateMany).not.toHaveBeenCalled();
  });

  it('切人工：只允许从 AI(null) 进入，写入排队哨兵', async () => {
    const { service, prisma, eventEmitter } = createSwitchService({
      id: 'conv-1',
      handlerId: null,
      status: 1,
      aiMetadata: null,
    });

    const res = await service.switchHandler('conv-1', 'human');

    expect(prisma.conversation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'conv-1', handlerId: null, status: 1 },
        data: expect.objectContaining({ handlerId: AWAITING_HUMAN }),
      }),
    );
    expect(res).toMatchObject({ success: true, mode: 'human' });
    expect(eventEmitter.emit).toHaveBeenCalledWith(
      'chat.support.queue.changed',
      expect.objectContaining({ reason: 'manual_switch' }),
    );
  });

  it('切人工：已认领的会话 no-op，不覆盖现有客服', async () => {
    const { service, prisma } = createSwitchService({
      id: 'conv-1',
      handlerId: 'admin-1',
      status: 1,
      aiMetadata: null,
    });

    const res = await service.switchHandler('conv-1', 'human');

    expect(prisma.conversation.updateMany).not.toHaveBeenCalled();
    expect(res).toMatchObject({ success: true, mode: 'human' });
  });
});

// ==================================================================
//  Task 4：列表 handoff 字段与 callback 队列
// ==================================================================

describe('AdminChatService.getConversations handoff 字段（Task 4）', () => {
  it('返回 handoffState / handlerName / autoReturnAt，并保留既有字段', async () => {
    const { service, handoff } = createListService(
      [
        {
          ...CONV_ROW,
          handlerId: 'admin-1',
          aiMetadata: null,
        },
      ],
      [{ id: 'admin-1', username: 'agent1', realName: '客服A' }],
    );
    const autoReturnAt = new Date('2026-11-22T12:00:00.000Z');
    handoff.getAutoReturnAt.mockReturnValue(autoReturnAt);

    const res = await service.getConversations(
      { queue: 'all' } as any,
      'admin-1',
    );

    expect(res.list[0]).toMatchObject({
      id: 'conv-1',
      status: 1,
      handlerId: 'admin-1',
      handoffState: 'HUMAN_ACTIVE',
      handlerName: '客服A',
      autoReturnAt: autoReturnAt.getTime(),
    });
  });

  it('queue=callback → 只筛 aiMetadata.handoffCallback.status=pending 的正常会话', async () => {
    const { service, prisma } = createListService();

    await service.getConversations({ queue: 'callback' } as any, 'admin-1');

    expect(whereOf(prisma)).toMatchObject({
      status: 1,
      aiMetadata: {
        path: ['handoffCallback', 'status'],
        equals: 'pending',
      },
    });
    // callback 队列不按 handlerId 筛选：离线留言时 AI 仍持有会话（handlerId=null）
    expect(whereOf(prisma)).not.toHaveProperty('handlerId');
  });
});
