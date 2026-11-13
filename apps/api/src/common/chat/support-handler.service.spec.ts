import { SupportHandlerService, AWAITING_HUMAN } from './support-handler.service';
import { ConversationStatus } from '@lucky/shared';

// ==================================================================
//  #98 S1：客服认领（T2-5）
//
//  修复前：没有认领动作。客服 A、B 同时回复同一个用户，
//          两个人都以为自己在服务他。
//  修复后：claim() 用条件 updateMany 把「还在排队」下推到 SQL，
//          改到 1 行 = 抢到，改到 0 行 = 被人抢先。
// ==================================================================

function createService() {
  const prisma = {
    conversation: {
      updateMany: jest.fn(),
      findUnique: jest.fn(),
    },
  };
  const service = new SupportHandlerService(prisma as any);
  return { service, prisma };
}

describe('SupportHandlerService.claim 认领互斥（T2-5）', () => {
  it('改到 1 行 → 认领成功，返回自己', async () => {
    const { service, prisma } = createService();
    prisma.conversation.updateMany.mockResolvedValue({ count: 1 });

    const result = await service.claim('conv-1', 'admin-1');

    expect(result).toEqual({ status: 'claimed', handlerId: 'admin-1' });
  });

  it('CAS 探针：WHERE 必须带 handlerId = awaiting_human，data 写真实 adminId', async () => {
    const { service, prisma } = createService();
    prisma.conversation.updateMany.mockResolvedValue({ count: 1 });

    await service.claim('conv-1', 'admin-1');

    expect(prisma.conversation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'conv-1',
          handlerId: AWAITING_HUMAN, // ← 少了这个条件，两个客服会同时认领成功
        }),
        data: expect.objectContaining({
          handlerId: 'admin-1',
          handlerAssignedAt: expect.any(Date),
        }),
      }),
    );
  });

  it('CAS 探针②：WHERE 必须限制 status = NORMAL，已关闭的会话不能被接走', async () => {
    const { service, prisma } = createService();
    prisma.conversation.updateMany.mockResolvedValue({ count: 1 });

    await service.claim('conv-1', 'admin-1');

    // 历史数据里存在 handlerId 还是 awaiting_human 但 status 已关闭的会话；
    // 少了这个条件，客服会接走一个已经结束的会话
    expect(prisma.conversation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: ConversationStatus.NORMAL,
        }),
      }),
    );
  });

  it('改到 0 行且会话存在 → 已被别的客服接走（conflict）', async () => {
    const { service, prisma } = createService();
    prisma.conversation.updateMany.mockResolvedValue({ count: 0 });
    prisma.conversation.findUnique.mockResolvedValue({ id: 'conv-1' });

    const result = await service.claim('conv-1', 'admin-2');

    expect(result).toEqual({ status: 'conflict' });
  });

  it('改到 0 行且会话不存在 → not_found', async () => {
    const { service, prisma } = createService();
    prisma.conversation.updateMany.mockResolvedValue({ count: 0 });
    prisma.conversation.findUnique.mockResolvedValue(null);

    const result = await service.claim('conv-missing', 'admin-2');

    expect(result).toEqual({ status: 'not_found' });
  });

  it('认领成功后不再多查一次库（只有失败路径才分类）', async () => {
    const { service, prisma } = createService();
    prisma.conversation.updateMany.mockResolvedValue({ count: 1 });

    await service.claim('conv-1', 'admin-1');

    expect(prisma.conversation.findUnique).not.toHaveBeenCalled();
  });
});
