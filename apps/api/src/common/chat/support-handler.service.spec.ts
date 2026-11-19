import {
  SupportHandlerService,
  AWAITING_HUMAN,
} from './support-handler.service';
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
      findMany: jest.fn(),
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

// ==================================================================
//  #98 AC-4：空闲回收（cron 主动扫描，不依赖用户再发消息）
// ==================================================================

describe('SupportHandlerService 空闲回收（#98 AC-4）', () => {
  const NOW = new Date('2026-11-19T12:00:00Z');
  const IDLE_MS = 10 * 60_000;

  it('releaseIfIdle 用 CAS 限定「仍在超时区间、且归属是真实客服」', async () => {
    const { service, prisma } = createService();
    prisma.conversation.updateMany.mockResolvedValue({ count: 1 });

    const released = await service.releaseIfIdle('conv-1', IDLE_MS, NOW);

    expect(released).toBe(true);
    expect(prisma.conversation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'conv-1',
          status: ConversationStatus.NORMAL,
          // 排队中的会话不能被空闲回收吞掉
          handlerId: { not: AWAITING_HUMAN },
          handlerAssignedAt: { lt: new Date(NOW.getTime() - IDLE_MS) },
        }),
        data: expect.objectContaining({
          handlerId: null,
          handlerAssignedAt: null,
          transferredAt: null,
        }),
      }),
    );
  });

  it('CAS 改到 0 行 → 客服刚有新消息，不能回收（false）', async () => {
    const { service, prisma } = createService();
    prisma.conversation.updateMany.mockResolvedValue({ count: 0 });

    expect(await service.releaseIfIdle('conv-1', IDLE_MS, NOW)).toBe(false);
  });

  it('sweepIdle 只返回真正被回收的会话 ID', async () => {
    const { service, prisma } = createService();
    prisma.conversation.findMany.mockResolvedValue([{ id: 'a' }, { id: 'b' }]);
    prisma.conversation.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });

    const released = await service.sweepIdle(IDLE_MS, 200, NOW);

    expect(released).toEqual(['a']);
    expect(prisma.conversation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          handlerId: { not: AWAITING_HUMAN },
          handlerAssignedAt: { lt: new Date(NOW.getTime() - IDLE_MS) },
        }),
      }),
    );
  });

  it('findStaleQueue 以 transferredAt（不是 handlerAssignedAt）判定排队超时', async () => {
    const { service, prisma } = createService();
    prisma.conversation.findMany.mockResolvedValue([{ id: 'q1' }]);

    const stale = await service.findStaleQueue(10 * 60_000, 100, NOW);

    expect(stale).toEqual([{ id: 'q1' }]);
    expect(prisma.conversation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          handlerId: AWAITING_HUMAN,
          transferredAt: { lt: new Date(NOW.getTime() - 10 * 60_000) },
        }),
      }),
    );
  });
});
