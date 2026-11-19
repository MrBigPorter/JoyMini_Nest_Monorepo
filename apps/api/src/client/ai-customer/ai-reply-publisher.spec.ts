import { publishAiReply } from './ai-reply-publisher';

describe('publishAiReply — RAG 引用回填', () => {
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

  const makePrisma = () => ({
    chatMember: {
      findFirst: jest.fn().mockResolvedValue({ userId: 'ai-member' }),
    },
    conversation: {
      update: jest.fn().mockResolvedValue({ lastMsgSeqId: 7 }),
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
  });

  it('把 sources 写入 ChatMessage.meta 并随消息广播', async () => {
    const prisma = makePrisma();
    const gateway = { dispatchToConversation: jest.fn() };

    await publishAiReply(
      prisma as any,
      gateway as any,
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

    expect(gateway.dispatchToConversation).toHaveBeenCalledWith(
      'conv-1',
      ['user-1'],
      expect.anything(),
      expect.objectContaining({ meta: { sources } }),
    );
  });

  it('没有 meta 时不写 meta 字段', async () => {
    const prisma = makePrisma();
    const gateway = { dispatchToConversation: jest.fn() };

    await publishAiReply(
      prisma as any,
      gateway as any,
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
});
