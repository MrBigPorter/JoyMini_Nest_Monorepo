jest.mock('uuid', () => ({ v4: jest.fn(() => 'test-uuid') }));
jest.mock('mime', () => ({
  getExtension: jest.fn(() => 'bin'),
  getType: jest.fn(() => 'application/octet-stream'),
}));

import { ChatService } from './chat.service';

/**
 * #118 P1-4：ChatMessage.source 的写入方。
 * 客服后台回复走 sendMessage(botUserId, dto, { source: 'human_agent' })；
 * 客户端/转发/通话不传 options，仍是 user。
 */
function makeService() {
  const prisma: any = {
    chatMessage: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({
        id: 'msg-1',
        conversationId: 'conv-1',
        senderId: 'bot-1',
        content: '您好',
        type: 0,
        seqId: 1,
        createdAt: new Date('2026-11-21T00:00:00.000Z'),
        meta: null,
        sender: null,
      }),
    },
    conversation: {
      findUnique: jest.fn().mockResolvedValue({
        handlerId: null,
        handlerAssignedAt: null,
        type: 'SUPPORT',
      }),
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
    aiTaskOutbox: {
      create: jest.fn().mockResolvedValue({}),
    },
    $transaction: jest.fn(async (cb: (tx: any) => unknown) => cb(prisma)),
  };
  const service = new ChatService(
    prisma,
    { emit: jest.fn() } as any,
    {} as any,
    {} as any,
    {} as any,
    { relayByMessageId: jest.fn().mockResolvedValue(undefined) } as any,
    {} as any,
  );
  return { service, prisma };
}

const DTO = {
  id: 'client-msg-1',
  conversationId: 'conv-1',
  content: '您好',
  type: 0,
};

describe('ChatService.sendMessage · ChatMessage.source', () => {
  it('显式 options.source=human_agent 时写入 human_agent', async () => {
    const { service, prisma } = makeService();

    await service.sendMessage('bot-1', DTO, { source: 'human_agent' });

    expect(prisma.chatMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ source: 'human_agent' }),
      }),
    );
  });

  it('不传 options 时保持 user（客户端/转发/通话调用不受影响）', async () => {
    const { service, prisma } = makeService();

    await service.sendMessage('user-1', DTO);

    expect(prisma.chatMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ source: 'user' }),
      }),
    );
  });

  // ── Task 4：handlerAssignedAt = 最后一次人工侧活动 ──────────────
  it('用户消息不刷新 handlerAssignedAt、不懒释放 handler', async () => {
    const { service, prisma } = makeService();
    prisma.conversation.findUnique.mockResolvedValue({
      handlerId: 'admin-1',
      // 即使已经「超时」10 分钟，也应该交给 cron 统一处理，而不是在这里改状态
      handlerAssignedAt: new Date(Date.now() - 11 * 60_000),
      type: 'SUPPORT',
    });

    await service.sendMessage('user-1', DTO);

    // 旧实现会先查 handlerAssignedAt，再按 10 分钟阈值懒释放/续期。
    // 本用例未注入 HandoffLifecycleService（可选依赖），因此不会为了
    // 「归档重开」去查会话；生产路径的查询/重开由 handoff-gate 用例覆盖。
    // 无论如何都不能读/写 handlerAssignedAt。
    expect(prisma.conversation.findUnique).not.toHaveBeenCalled();
    expect(prisma.conversation.update).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          handlerAssignedAt: expect.anything(),
        }),
      }),
    );
  });
});
