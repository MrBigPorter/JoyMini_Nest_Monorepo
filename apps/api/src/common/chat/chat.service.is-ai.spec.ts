// 依赖链（Upload/Avatar）里有纯 ESM 包；本用例只测消息映射，不需要真实实现。
jest.mock('uuid', () => ({ v4: jest.fn(() => 'test-uuid') }));
jest.mock('mime', () => ({
  getExtension: jest.fn(() => 'bin'),
  getType: jest.fn(() => 'application/octet-stream'),
}));

import { ChatService } from './chat.service';

/**
 * 历史接口的 isAi 派生：
 * ChatMessage 没有 isAi 列，对外统一由 source === 'ai' 派生。
 * 这条用例防止以后有人把 source 改名或忘了映射，导致历史重载后 AI 标识消失。
 */
describe('ChatService.getMessages · isAi', () => {
  function makeService() {
    const messages = [
      {
        id: 'm2',
        seqId: 2,
        content: 'AI reply',
        type: 0,
        createdAt: new Date('2026-11-20T00:00:00Z'),
        senderId: 'bot',
        source: 'ai',
        meta: null,
        sender: { id: 'bot', nickname: 'AI', avatar: '' },
      },
      {
        id: 'm1',
        seqId: 1,
        content: 'user message',
        type: 0,
        createdAt: new Date('2026-11-20T00:00:00Z'),
        senderId: 'u1',
        source: 'user',
        meta: null,
        sender: { id: 'u1', nickname: 'User', avatar: '' },
      },
    ];
    const prisma: any = {
      chatMember: {
        findUnique: jest.fn().mockResolvedValue({ clearedSeqId: 0 }),
        findFirst: jest.fn().mockResolvedValue({ lastReadSeqId: 1 }),
      },
      chatMessage: { findMany: jest.fn().mockResolvedValue(messages) },
    };
    const service = new ChatService(
      prisma,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
    return { service, prisma };
  }

  it('AI 消息 isAi=true，用户消息 false；isSelf 仍按 senderId 判断', async () => {
    const { service } = makeService();

    const result = await service.getMessages('u1', {
      conversationId: 'c1',
      pageSize: 20,
    } as any);

    expect(result.list).toEqual([
      expect.objectContaining({ id: 'm2', isAi: true, isSelf: false }),
      expect.objectContaining({ id: 'm1', isAi: false, isSelf: true }),
    ]);
    expect(result.partnerLastReadSeqId).toBe(1);
  });
});
