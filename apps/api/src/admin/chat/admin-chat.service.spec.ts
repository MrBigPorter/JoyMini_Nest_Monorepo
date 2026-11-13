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
  const prisma = { conversation: { findMany: jest.fn(), count: jest.fn() } };
  const supportHandler = { claim: jest.fn().mockResolvedValue(claimResult) };
  const service = new AdminChatService(
    prisma as any,
    {} as any,
    {} as any,
    {} as any,
    supportHandler as any,
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

    await expect(service.claimConversation('conv-1', 'admin-2')).rejects.toThrow(
      ConflictException,
    );
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

function createListService(rows: any[] = []) {
  const prisma = {
    conversation: {
      count: jest.fn().mockResolvedValue(rows.length),
      findMany: jest.fn().mockResolvedValue(rows),
    },
  };
  const service = new AdminChatService(
    prisma as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );
  return { service, prisma };
}

/** 取出 findMany 实际收到的 where 条件 */
function whereOf(prisma: any) {
  return prisma.conversation.findMany.mock.calls[0][0].where;
}

describe('AdminChatService.getConversations 队列筛选（T2-5 / S2-A）', () => {  it('queue=awaiting → handlerId = awaiting_human，并且只查未关闭的', async () => {
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

  it('queue=awaiting → 按 handlerAssignedAt 升序（等最久的排最前）', async () => {
    const { service, prisma } = createListService();

    await service.getConversations({ queue: 'awaiting' } as any, 'admin-1');

    expect(prisma.conversation.findMany.mock.calls[0][0].orderBy).toEqual({
      handlerAssignedAt: 'asc',
    });
  });

  it('waitingSeconds 是数字（从 transferredAt 算），不是函数', async () => {
    const { service } = createListService([CONV_ROW]);

    const res = await service.getConversations({ queue: 'awaiting' } as any, 'admin-1');

    // 写成 () => number 时 Jest 也会显示 "not a function"，而 JSON 里字段会整个消失
    expect(typeof res.list[0].waitingSeconds).toBe('number');
    expect(res.list[0].waitingSeconds).toBeGreaterThanOrEqual(120);
  });

  it('没有排队时间（AI 会话）→ waitingSeconds 是 null，不是 0', async () => {
    const { service } = createListService([
      { ...CONV_ROW, handlerId: null, transferredAt: null, handlerAssignedAt: null },
    ]);

    const res = await service.getConversations({ queue: 'ai' } as any, 'admin-1');

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

function convRow(handlerId: string | null) {
  return {
    id: 'conv-1',
    handlerId,
    status: 1,
    members: [{ userId: 'bot-1', user: { id: 'bot-1', isRobot: true } }],
  };
}

function createReplyService(opts: {
  handlerId: string | null;
  convExists?: boolean;
  claimStatus?: 'claimed' | 'conflict' | 'not_found';
  takeCount?: number;
}) {
  const prisma = {
    conversation: {
      findUnique: jest
        .fn()
        .mockResolvedValue(opts.convExists === false ? null : convRow(opts.handlerId)),
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

    const res = await service.replyToConversation('conv-1', REPLY_DTO, '客服A', 'admin-1');

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
    const { service, prisma } = createReplyService({ handlerId: null, takeCount: 1 });

    const res = await service.replyToConversation('conv-1', REPLY_DTO, '客服A', 'admin-1');

    // 条件更新必须只认 handlerId 仍为 null 的那一行
    expect(prisma.conversation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ handlerId: null }) }),
    );
    expect(res.claimedNow).toBe(true);
  });

  it('AI 处理中但被同事抢先 → 消息照发，claimedNow=false（帮答）', async () => {
    const { service, chatService } = createReplyService({ handlerId: null, takeCount: 0 });

    const res = await service.replyToConversation('conv-1', REPLY_DTO, '客服B', 'admin-2');

    expect(chatService.sendMessage).toHaveBeenCalledTimes(1);
    expect(res.claimedNow).toBe(false);
  });

  it('别人名下的会话 → 照发，归属不变', async () => {
    const { service, chatService, supportHandler, prisma } = createReplyService({
      handlerId: 'admin-A',
    });

    const res = await service.replyToConversation('conv-1', REPLY_DTO, '客服B', 'admin-B');

    expect(chatService.sendMessage).toHaveBeenCalledTimes(1);
    expect(supportHandler.claim).not.toHaveBeenCalled();
    expect(prisma.conversation.updateMany).not.toHaveBeenCalled();
    expect(res.claimedNow).toBe(false);
    expect(res.handlerId).toBe('admin-A');
  });

  it('会话不存在 → 404（不是 TypeError / 500）', async () => {
    const { service, chatService } = createReplyService({
      handlerId: null,
      convExists: false,
    });

    await expect(
      service.replyToConversation('conv-missing', REPLY_DTO, '客服A', 'admin-1'),
    ).rejects.toThrow(NotFoundException);
    expect(chatService.sendMessage).not.toHaveBeenCalled();
  });
});
