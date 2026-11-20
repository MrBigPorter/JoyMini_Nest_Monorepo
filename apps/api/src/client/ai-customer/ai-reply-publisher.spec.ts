import { CHAT_EVENTS } from '@api/common/chat/events/chat.events';
import { publishAiReply } from './ai-reply-publisher';

describe('publishAiReply — 统一消息事件', () => {
  const sources = [
    {
      chunkId: 'chunk-1',
      documentId: 'doc-1',
      docId: 'refund-policy',
      title: 'Refund Policy',
      domain: 'order',
      score: 0.91,
      content: 'Refund processing takes 1-3 business days.',
    },
  ];

  const makePrisma = () => {
    const prisma: any = {
      chatMember: {
        findFirst: jest.fn().mockResolvedValue({ userId: 'ai-member' }),
        findMany: jest.fn().mockResolvedValue([
          { userId: 'user-1', isMuted: false },
          { userId: 'user-2', isMuted: true },
        ]),
      },
      conversation: {
        update: jest
          .fn()
          .mockResolvedValue({
            lastMsgSeqId: 7,
            type: 'SUPPORT',
            businessId: null,
          }),
      },
      chatMessage: {
        create: jest.fn().mockResolvedValue({
          id: 'msg-1',
          conversationId: 'conv-1',
          content: 'You can get a refund within 1-3 days.',
          type: 0,
          seqId: 7,
          createdAt: new Date('2026-11-19T00:00:00Z'),
          sender: { id: 'ai-member', nickname: 'AI', avatar: '' },
          meta: { sources },
        }),
      },
    };
    prisma.$transaction = jest.fn(async (cb: (tx: any) => any) => cb(prisma));
    return prisma;
  };

  it('写入 meta/role/source，并 emit 一次 MESSAGE_CREATED（isAi=true）', async () => {
    const prisma = makePrisma();
    const gateway = { dispatchToConversation: jest.fn() };
    const emitter = { emit: jest.fn() };

    await publishAiReply(
      prisma as any,
      gateway as any,
      emitter as any,
      'conv-1',
      [{ type: 'ai', content: 'You can get a refund within 1-3 days.' }],
      'user-1',
      ['user-1'],
      { sources },
    );

    expect(prisma.chatMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          meta: { sources },
          role: 'assistant',
          source: 'ai',
        }),
      }),
    );

    const [eventName, event] = emitter.emit.mock.calls[0];
    expect(eventName).toBe(CHAT_EVENTS.MESSAGE_CREATED);
    expect(event).toMatchObject({
      messageId: 'msg-1',
      conversationId: 'conv-1',
      isAi: true,
      memberIds: ['user-1', 'user-2'],
      pushMemberIds: ['user-1'],
    });
    // 不再直接 dispatch，避免房间重复投递
    expect(gateway.dispatchToConversation).not.toHaveBeenCalled();
  });

  it('同一事务更新会话最后消息快照', async () => {
    const prisma = makePrisma();
    const emitter = { emit: jest.fn() };

    await publishAiReply(
      prisma as any,
      { dispatchToConversation: jest.fn() } as any,
      emitter as any,
      'conv-1',
      [{ type: 'ai', content: 'hello' }],
      'user-1',
      ['user-1'],
    );

    expect(prisma.conversation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          lastMsgContent: 'hello',
          lastMsgType: 0,
          lastMsgTime: expect.any(Date),
        }),
      }),
    );
  });

  it('没有 meta 时不写 meta 字段', async () => {
    const prisma = makePrisma();
    const emitter = { emit: jest.fn() };

    await publishAiReply(
      prisma as any,
      { dispatchToConversation: jest.fn() } as any,
      emitter as any,
      'conv-1',
      [{ type: 'ai', content: 'hello' }],
      'user-1',
      ['user-1'],
    );

    expect(prisma.chatMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ meta: undefined }),
      }),
    );
  });

  it('把触发消息 id 写入 triggerMessageId', async () => {
    const prisma = makePrisma();
    const emitter = { emit: jest.fn() };

    await publishAiReply(
      prisma as any,
      { dispatchToConversation: jest.fn() } as any,
      emitter as any,
      'conv-1',
      [{ type: 'ai', content: 'hello' }],
      'user-1',
      ['user-1'],
      undefined,
      'user-msg-1',
    );

    expect(prisma.chatMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ triggerMessageId: 'user-msg-1' }),
      }),
    );
  });

  it('同一触发消息重放（唯一键冲突）→ 不写第二条、不 emit、不抛错', async () => {
    const prisma = makePrisma();
    const conflict = Object.assign(new Error('unique violation'), {
      code: 'P2002',
    });
    prisma.chatMessage.create.mockRejectedValue(conflict);
    const emitter = { emit: jest.fn() };

    await expect(
      publishAiReply(
        prisma as any,
        { dispatchToConversation: jest.fn() } as any,
        emitter as any,
        'conv-1',
        [{ type: 'ai', content: 'hello' }],
        'user-1',
        ['user-1'],
        undefined,
        'user-msg-1',
      ),
    ).resolves.toBeUndefined();

    expect(prisma.chatMessage.create).toHaveBeenCalledTimes(1);
    expect(emitter.emit).not.toHaveBeenCalled();
  });
});
