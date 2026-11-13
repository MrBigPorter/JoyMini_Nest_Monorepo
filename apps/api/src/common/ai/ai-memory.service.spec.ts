import { NotFoundException } from '@nestjs/common';
import { AiMemoryService } from './ai-memory.service';

// ==================================================================
//  #85 P0-2 / T1-4：AI 会话 IDOR
//
//  修复前：任何登录用户把别人的 SUPPORT conversationId 传给
//          createOrGetAiConversation，就能拿到那条会话的 threadId，
//          从而让 AI 在别人的上下文里读写。
//  修复后：查询条件里必须带 members.some.userId，
//          不是成员 → 查不到 → 404（和"会话不存在"同一个出口）。
// ==================================================================

function createService() {
  const prisma = {
    conversation: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
    },
  };
  const redis = {
    incr: jest.fn(),
    expire: jest.fn(),
    get: jest.fn(),
    set: jest.fn(),
  };
  const service = new AiMemoryService(prisma as any, redis as any);
  return { service, prisma, redis };
}

describe('AiMemoryService.createOrGetAiConversation 成员校验（T1-4）', () => {
  it('非成员 / 不存在的会话 → 404，且不会写 threadId', async () => {
    const { service, prisma } = createService();
    prisma.conversation.findFirst.mockResolvedValue(null);

    await expect(
      service.createOrGetAiConversation('u-attacker', 'conv-xiaohong'),
    ).rejects.toThrow(NotFoundException);

    expect(prisma.conversation.update).not.toHaveBeenCalled();
  });

  it('查询条件必须带成员过滤（members.some.userId）', async () => {
    const { service, prisma } = createService();
    prisma.conversation.findFirst.mockResolvedValue(null);

    await expect(
      service.createOrGetAiConversation('u-xiaohong', 'conv-xiaohong'),
    ).rejects.toThrow(NotFoundException);

    // 核心断言：这条查询本身就把「我是不是成员」交给数据库判断了
    expect(prisma.conversation.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'conv-xiaohong',
          type: 'SUPPORT',
          members: { some: { userId: 'u-xiaohong' } },
        }),
      }),
    );
  });

  it('成员 → 正常返回会话', async () => {
    const { service, prisma } = createService();
    const conv = {
      id: 'conv-xiaohong',
      threadId: 'thread-1',
      type: 'SUPPORT',
    };
    prisma.conversation.findFirst.mockResolvedValue(conv);

    const result = await service.createOrGetAiConversation(
      'u-xiaohong',
      'conv-xiaohong',
    );

    expect(result).toEqual(conv);
    expect(prisma.conversation.update).not.toHaveBeenCalled();
  });
});
