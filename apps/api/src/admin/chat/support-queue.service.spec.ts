import { ConversationStatus } from '@lucky/shared';
import { AWAITING_HUMAN } from '@api/common/chat/support-handler.service';
import { HandoffLifecycleService } from '@api/common/chat/handoff/handoff-lifecycle.service';
import { SupportQueueService } from './support-queue.service';

// uuid v13 是纯 ESM，Jest CJS 加载不了；系统消息 ID 不影响本套断言。
jest.mock('uuid', () => ({ v4: jest.fn(() => 'test-uuid') }));

// ==================================================================
//  Task 4：自动回 AI 统一调度
//
//  历史上这里有两套互不一致的超时：
//    - SupportQueueService.sweepIdle（已认领 10 分钟）
//    - chat.service 的懒释放（任意 handler 10 分钟，含排队）
//  现在 cron 只调用 HandoffLifecycleService.sweepTimedOut：
//    - 排队 10 分钟无人认领 → waiting_timeout
//    - 已认领 60 分钟无人工活动 → inactive_timeout
//  阈值由生命周期服务统一读取，0 表示关闭。
// ==================================================================

const MINUTE_MS = 60_000;

function createQueue(lifecycle: any, lock = true) {
  const redis = { setNx: jest.fn().mockResolvedValue(lock) };
  const service = new SupportQueueService(lifecycle as any, redis as any);
  return { service, redis };
}

/** 真实 HandoffLifecycleService + 最小 Prisma mock，用于验证 10/60 默认值 */
function createRealLifecycle(config: Record<string, string> = {}) {
  const prisma: any = {
    conversation: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      updateMany: jest.fn(),
      update: jest.fn(),
    },
    chatMessage: { create: jest.fn() },
    chatMember: { findMany: jest.fn().mockResolvedValue([]) },
  };
  prisma.$transaction = jest.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
    cb(prisma),
  );

  const lifecycle = new HandoffLifecycleService(
    prisma,
    { get: jest.fn((key: string) => config[key]) } as any,
    { dispatch: jest.fn() } as any,
    { emit: jest.fn() } as any,
  );

  return { lifecycle, prisma };
}

/** 让 waiting_timeout 的 returnToAi 真正完成一次转换 */
function mockWaitingTransition(prisma: any) {
  prisma.conversation.findUnique.mockResolvedValue({
    aiMetadata: { trafficSource: 'simulation_support_v1' },
    status: ConversationStatus.NORMAL,
    handlerId: AWAITING_HUMAN,
    type: 'SUPPORT',
  });
  prisma.conversation.updateMany.mockResolvedValue({ count: 1 });
  prisma.conversation.update.mockResolvedValue({ lastMsgSeqId: 6 });
  prisma.chatMessage.create.mockResolvedValue({ id: 'msg-1' });
}

describe('SupportQueueService.sweep 统一调度', () => {
  it('抢到 Redis 锁后调用 HandoffLifecycleService.sweepTimedOut', async () => {
    const lifecycle = {
      sweepTimedOut: jest.fn().mockResolvedValue({
        returned: [{ id: 'conv-1', reason: 'waiting_timeout' }],
        skipped: 0,
      }),
    };
    const { service, redis } = createQueue(lifecycle);

    await service.sweep();

    expect(redis.setNx).toHaveBeenCalledWith(
      'cron:support-queue-sweep',
      expect.any(String),
      50,
    );
    expect(lifecycle.sweepTimedOut).toHaveBeenCalledTimes(1);
  });

  it('没抢到锁（其他实例正在跑）→ 不扫描', async () => {
    const lifecycle = { sweepTimedOut: jest.fn() };
    const { service } = createQueue(lifecycle, false);

    await service.sweep();

    expect(lifecycle.sweepTimedOut).not.toHaveBeenCalled();
  });

  it('sweep 抛错时只记日志，不让 cron 挂掉', async () => {
    const lifecycle = {
      sweepTimedOut: jest.fn().mockRejectedValue(new Error('db down')),
    };
    const { service } = createQueue(lifecycle);
    const errorSpy = jest
      .spyOn((service as any).logger, 'error')
      .mockImplementation(() => undefined);

    await expect(service.sweep()).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('db down'));
  });
});

describe('默认超时策略：排队 10 分钟 / 已认领 60 分钟', () => {
  it('排队候选按 10 分钟截止；已认领候选按 60 分钟截止（未到 60 分钟不会被回收）', async () => {
    const { lifecycle, prisma } = createRealLifecycle();
    mockWaitingTransition(prisma);
    // 第一次查 waiting_timeout 候选；第二次查 inactive 候选（最近认领的不会被 SQL 选出）
    prisma.conversation.findMany
      .mockResolvedValueOnce([{ id: 'conv-wait' }])
      .mockResolvedValueOnce([]);

    const { service } = createQueue(lifecycle);
    await service.sweep();

    const [waitWhere, inactiveWhere] =
      prisma.conversation.findMany.mock.calls.map(
        (call: any[]) => call[0].where,
      );

    expect(waitWhere).toMatchObject({
      status: ConversationStatus.NORMAL,
      handlerId: AWAITING_HUMAN,
    });
    const waitCutoff = waitWhere.OR[0].transferredAt.lt.getTime();
    expect(Math.abs(waitCutoff - (Date.now() - 10 * MINUTE_MS))).toBeLessThan(
      5_000,
    );

    expect(inactiveWhere).toMatchObject({
      status: ConversationStatus.NORMAL,
      handlerId: { not: AWAITING_HUMAN },
    });
    const inactiveCutoff = inactiveWhere.handlerAssignedAt.lt.getTime();
    expect(
      Math.abs(inactiveCutoff - (Date.now() - 60 * MINUTE_MS)),
    ).toBeLessThan(5_000);

    // 排队超时的会话确实被交回 AI
    expect(prisma.conversation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'conv-wait',
          handlerId: AWAITING_HUMAN,
        }),
        data: expect.objectContaining({ handlerId: null }),
      }),
    );
  });

  it('env=0 时对应项关闭：不查询、不转换', async () => {
    const { lifecycle, prisma } = createRealLifecycle({
      SUPPORT_WAIT_TIMEOUT_MINUTES: '0',
      SUPPORT_IDLE_TIMEOUT_MINUTES: '0',
    });

    const { service } = createQueue(lifecycle);
    await service.sweep();

    expect(prisma.conversation.findMany).not.toHaveBeenCalled();
    expect(prisma.conversation.updateMany).not.toHaveBeenCalled();
  });
});
