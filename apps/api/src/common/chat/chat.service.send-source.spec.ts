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
});
