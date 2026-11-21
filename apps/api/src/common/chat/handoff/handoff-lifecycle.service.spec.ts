import { ConversationStatus, MESSAGE_TYPE, SocketEvents } from '@lucky/shared';
import { CHAT_EVENTS } from '@api/common/chat/events/chat.events';
import { AWAITING_HUMAN } from '@api/common/chat/support-handler.service';
import { HandoffLifecycleService } from './handoff-lifecycle.service';
import { deriveHandoffState } from './handoff-state';

// uuid v13 是纯 ESM，Jest CJS 加载不了；系统消息 ID 的取值不影响本套断言。
jest.mock('uuid', () => ({ v4: jest.fn(() => 'test-uuid') }));

// ==================================================================
//  AI ↔ 人工交接生命周期（Task 1）
//
//  所有状态转换必须走 HandoffLifecycleService：
//   - 用一条 updateMany CAS 抢占转换权，避免与认领/关闭竞态
//   - CAS 成功后同事务写 handoffResetPending / handoffHistory / 系统消息
//   - 重复调用只能成功一次，系统消息不能重复落库
// ==================================================================

const NOW = new Date('2026-11-22T12:00:00Z');
const minutesAgo = (minutes: number): Date =>
  new Date(NOW.getTime() - minutes * 60_000);

function createService(config: Record<string, string> = {}) {
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

  const configService = {
    get: jest.fn((key: string) => config[key]),
  };
  const eventsGateway = { dispatch: jest.fn() };
  const eventEmitter = { emit: jest.fn() };

  const service = new HandoffLifecycleService(
    prisma,
    configService as any,
    eventsGateway as any,
    eventEmitter as any,
  );

  return { service, prisma, configService, eventsGateway, eventEmitter };
}

function mockSuccessfulTransition(
  prisma: any,
  overrides: Record<string, unknown> = {},
) {
  prisma.conversation.findUnique.mockResolvedValue({
    aiMetadata: { trafficSource: 'simulation_support_v1' },
    lastMsgSeqId: 5,
    status: ConversationStatus.NORMAL,
    handlerId: AWAITING_HUMAN,
    type: 'SUPPORT',
    ...overrides,
  });
  prisma.conversation.updateMany.mockResolvedValue({ count: 1 });
  prisma.conversation.update.mockResolvedValue({ lastMsgSeqId: 6 });
  prisma.chatMessage.create.mockResolvedValue({ id: 'msg-1' });
  prisma.chatMember.findMany.mockResolvedValue([
    { userId: 'user-1', isMuted: false },
    { userId: 'admin-1', isMuted: false },
  ]);
}

describe('deriveHandoffState 四态判定', () => {
  it('ARCHIVED 优先判定为 CLOSED', () => {
    expect(
      deriveHandoffState({
        status: ConversationStatus.ARCHIVED,
        handlerId: 'admin-1',
      }),
    ).toBe('CLOSED');
  });

  it('awaiting_human → WAITING_HUMAN', () => {
    expect(
      deriveHandoffState({
        status: ConversationStatus.NORMAL,
        handlerId: AWAITING_HUMAN,
      }),
    ).toBe('WAITING_HUMAN');
  });

  it('真实 adminId → HUMAN_ACTIVE', () => {
    expect(
      deriveHandoffState({
        status: ConversationStatus.NORMAL,
        handlerId: 'admin-1',
      }),
    ).toBe('HUMAN_ACTIVE');
  });

  it('handlerId=null → AI_ACTIVE', () => {
    expect(
      deriveHandoffState({
        status: ConversationStatus.NORMAL,
        handlerId: null,
      }),
    ).toBe('AI_ACTIVE');
  });
});

describe('HandoffLifecycleService.returnToAi', () => {
  it('waiting 超时：CAS 成功、清归属、写系统消息和 reset flag', async () => {
    const { service, prisma, eventsGateway, eventEmitter } = createService();
    mockSuccessfulTransition(prisma);

    const ok = await service.returnToAi('conv-1', 'waiting_timeout', {
      now: NOW,
    });

    expect(ok).toBe(true);

    // ── CAS：条件必须把「仍在等待超时区间」下推到 SQL ──
    const casArg = prisma.conversation.updateMany.mock.calls[0][0];
    expect(casArg.where).toMatchObject({
      id: 'conv-1',
      status: ConversationStatus.NORMAL,
      handlerId: AWAITING_HUMAN,
    });
    expect(casArg.where.OR).toEqual([
      { transferredAt: { lt: minutesAgo(10) } },
      // 旧数据没有 transferredAt 时用 handlerAssignedAt 兜底
      { transferredAt: null, handlerAssignedAt: { lt: minutesAgo(10) } },
    ]);
    expect(casArg.data).toMatchObject({
      handlerId: null,
      handlerAssignedAt: null,
      transferredAt: null,
      transferReason: null,
    });

    // ── 同事务写 reset flag / 审计，且不能覆盖 trafficSource ──
    const updateArg = prisma.conversation.update.mock.calls[0][0];
    expect(updateArg.data.aiMetadata).toMatchObject({
      trafficSource: 'simulation_support_v1',
      handoffResetPending: {
        at: NOW.toISOString(),
        reason: 'waiting_timeout',
      },
    });
    expect(updateArg.data.aiMetadata.handoffHistory).toHaveLength(1);
    expect(updateArg.data.aiMetadata.handoffHistory[0]).toMatchObject({
      from: 'WAITING_HUMAN',
      to: 'AI_ACTIVE',
      reason: 'waiting_timeout',
      actor: 'system',
      at: NOW.toISOString(),
    });

    // ── 系统消息：senderId=null、type=99、seqId 与快照一致 ──
    const messageArg = prisma.chatMessage.create.mock.calls[0][0];
    expect(messageArg.data).toMatchObject({
      conversationId: 'conv-1',
      senderId: null,
      content: '人工服务已结束，AI 继续为您服务。',
      type: MESSAGE_TYPE.SYSTEM,
      seqId: 6,
    });

    // ── 提交后广播 ──
    expect(eventEmitter.emit).toHaveBeenCalledWith(
      CHAT_EVENTS.MESSAGE_CREATED,
      expect.objectContaining({
        conversationId: 'conv-1',
        type: MESSAGE_TYPE.SYSTEM,
        seqId: 6,
      }),
    );
    expect(eventEmitter.emit).toHaveBeenCalledWith(
      CHAT_EVENTS.SUPPORT_QUEUE_CHANGED,
      expect.objectContaining({
        conversationId: 'conv-1',
        reason: 'released',
        handlerId: null,
      }),
    );
    expect(eventsGateway.dispatch).toHaveBeenCalledWith(
      'conv-1',
      SocketEvents.AI_HANDOFF_RETURNED,
      expect.objectContaining({
        conversationId: 'conv-1',
        reason: 'waiting_timeout',
      }),
    );
  });

  it('inactive 超时：只释放真实客服名下、60 分钟无人工活动的会话', async () => {
    const { service, prisma } = createService();
    mockSuccessfulTransition(prisma, {
      handlerId: 'admin-1',
      aiMetadata: {},
    });

    const ok = await service.returnToAi('conv-1', 'inactive_timeout', {
      now: NOW,
    });

    expect(ok).toBe(true);
    expect(prisma.conversation.updateMany.mock.calls[0][0].where).toMatchObject(
      {
        id: 'conv-1',
        status: ConversationStatus.NORMAL,
        handlerId: { not: AWAITING_HUMAN },
        handlerAssignedAt: { lt: minutesAgo(60) },
      },
    );
  });

  it('admin_return 不看超时，可把排队中或人工中的会话交回 AI', async () => {
    const { service, prisma } = createService();
    mockSuccessfulTransition(prisma);

    const ok = await service.returnToAi('conv-1', 'admin_return', {
      now: NOW,
      actor: 'admin-9',
    });

    expect(ok).toBe(true);
    const casWhere = prisma.conversation.updateMany.mock.calls[0][0].where;
    expect(casWhere).toMatchObject({
      id: 'conv-1',
      status: ConversationStatus.NORMAL,
      handlerId: { not: null },
    });
    // 手动切回不能附加任何时间条件
    expect(casWhere.handlerAssignedAt).toBeUndefined();
    expect(casWhere.OR).toBeUndefined();

    const updateArg = prisma.conversation.update.mock.calls[0][0];
    expect(updateArg.data.aiMetadata.handoffHistory[0].actor).toBe('admin-9');
  });

  it('CAS 改到 0 行 → 返回 false，不写系统消息', async () => {
    const { service, prisma } = createService();
    mockSuccessfulTransition(prisma);
    prisma.conversation.updateMany.mockResolvedValue({ count: 0 });

    expect(
      await service.returnToAi('conv-1', 'waiting_timeout', { now: NOW }),
    ).toBe(false);
    expect(prisma.chatMessage.create).not.toHaveBeenCalled();
    expect(prisma.conversation.update).not.toHaveBeenCalled();
  });

  it('重复调用只写一条系统消息', async () => {
    const { service, prisma } = createService();
    mockSuccessfulTransition(prisma);
    // 第一次抢占成功，第二次换了个进程/重试到来时已不在超时状态
    prisma.conversation.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });

    expect(
      await service.returnToAi('conv-1', 'waiting_timeout', { now: NOW }),
    ).toBe(true);
    expect(
      await service.returnToAi('conv-1', 'waiting_timeout', { now: NOW }),
    ).toBe(false);

    expect(prisma.chatMessage.create).toHaveBeenCalledTimes(1);
  });

  it('handoffHistory 最多保留 10 条', async () => {
    const { service, prisma } = createService();
    const existingHistory = Array.from({ length: 10 }, (_, i) => ({
      from: 'HUMAN_ACTIVE',
      to: 'AI_ACTIVE',
      reason: 'admin_return',
      actor: `admin-${i}`,
      at: NOW.toISOString(),
    }));
    mockSuccessfulTransition(prisma, {
      aiMetadata: { handoffHistory: existingHistory },
    });

    await service.returnToAi('conv-1', 'waiting_timeout', { now: NOW });

    const history =
      prisma.conversation.update.mock.calls[0][0].data.aiMetadata
        .handoffHistory;
    expect(history).toHaveLength(10);
    expect(history[9]).toMatchObject({ reason: 'waiting_timeout' });
  });

  it('会话不存在 → false，不写消息', async () => {
    const { service, prisma } = createService();
    prisma.conversation.findUnique.mockResolvedValue(null);
    prisma.conversation.updateMany.mockResolvedValue({ count: 0 });

    expect(
      await service.returnToAi('missing', 'waiting_timeout', { now: NOW }),
    ).toBe(false);
    expect(prisma.chatMessage.create).not.toHaveBeenCalled();
  });
});

describe('HandoffLifecycleService.sweepTimedOut', () => {
  it('认领后 60 分钟内 sweep 不释放（human 查询带 handlerAssignedAt 条件）', async () => {
    const { service, prisma } = createService();
    // waiting 无候选；human 无候选（刚认领的 handlerAssignedAt=now 不在 cutoff 前）
    prisma.conversation.findMany.mockResolvedValue([]);

    const result = await service.sweepTimedOut(NOW);

    expect(result).toEqual({ returned: [], skipped: 0 });
    expect(prisma.conversation.updateMany).not.toHaveBeenCalled();

    const whereClauses = prisma.conversation.findMany.mock.calls.map(
      (call: any[]) => call[0].where,
    );
    // 第一次查排队超时
    expect(whereClauses[0]).toMatchObject({
      status: ConversationStatus.NORMAL,
      handlerId: AWAITING_HUMAN,
    });
    // 第二次查已认领但坐席不活跃
    expect(whereClauses[1]).toMatchObject({
      status: ConversationStatus.NORMAL,
      handlerId: { not: AWAITING_HUMAN },
      handlerAssignedAt: { lt: minutesAgo(60) },
    });
  });

  it('超过 60 分钟无人工活动 → 返回 inactive_timeout', async () => {
    const { service, prisma } = createService();
    mockSuccessfulTransition(prisma, { handlerId: 'admin-1' });
    prisma.conversation.findMany
      .mockResolvedValueOnce([]) // 排队候选
      .mockResolvedValueOnce([{ id: 'conv-1' }]); // 不活跃候选

    const result = await service.sweepTimedOut(NOW);

    expect(result).toEqual({
      returned: [{ id: 'conv-1', reason: 'inactive_timeout' }],
      skipped: 0,
    });
    expect(prisma.conversation.updateMany).toHaveBeenCalledTimes(1);
  });

  it('候选在 CAS 时已被认领 → 计入 skipped，不误写消息', async () => {
    const { service, prisma } = createService();
    mockSuccessfulTransition(prisma);
    prisma.conversation.updateMany.mockResolvedValue({ count: 0 });
    prisma.conversation.findMany
      .mockResolvedValueOnce([{ id: 'conv-1' }]) // 排队候选
      .mockResolvedValueOnce([]);

    const result = await service.sweepTimedOut(NOW);

    expect(result).toEqual({ returned: [], skipped: 1 });
    expect(prisma.chatMessage.create).not.toHaveBeenCalled();
  });

  it('env=0 时对应项关闭：不查询、不转换', async () => {
    const { service, prisma } = createService({
      SUPPORT_WAIT_TIMEOUT_MINUTES: '0',
      SUPPORT_IDLE_TIMEOUT_MINUTES: '0',
    });

    const result = await service.sweepTimedOut(NOW);

    expect(result).toEqual({ returned: [], skipped: 0 });
    expect(prisma.conversation.findMany).not.toHaveBeenCalled();
    expect(prisma.conversation.updateMany).not.toHaveBeenCalled();
  });
});

describe('HandoffLifecycleService.reopenForUser', () => {
  it('ARCHIVED SUPPORT 会话重开：status=NORMAL、清归属、reset flag、系统消息', async () => {
    const { service, prisma } = createService();
    mockSuccessfulTransition(prisma, {
      status: ConversationStatus.ARCHIVED,
      handlerId: null,
      type: 'SUPPORT',
    });

    const ok = await service.reopenForUser('conv-1');

    expect(ok).toBe(true);
    expect(prisma.conversation.updateMany.mock.calls[0][0].where).toMatchObject(
      {
        id: 'conv-1',
        status: ConversationStatus.ARCHIVED,
        type: 'SUPPORT',
      },
    );
    expect(prisma.conversation.updateMany.mock.calls[0][0].data).toMatchObject({
      status: ConversationStatus.NORMAL,
      handlerId: null,
      handlerAssignedAt: null,
      transferredAt: null,
      transferReason: null,
    });

    const updateArg = prisma.conversation.update.mock.calls[0][0];
    expect(updateArg.data.aiMetadata.handoffResetPending).toMatchObject({
      reason: 'closed_reopen',
    });
    expect(updateArg.data.aiMetadata.handoffHistory[0]).toMatchObject({
      from: 'CLOSED',
      to: 'AI_ACTIVE',
      reason: 'closed_reopen',
    });

    expect(prisma.chatMessage.create.mock.calls[0][0].data).toMatchObject({
      senderId: null,
      type: MESSAGE_TYPE.SYSTEM,
      content: '会话已重新打开，智能助手继续',
    });
  });

  it('非 ARCHIVED 会话不会被重开（CAS 0 行 → false）', async () => {
    const { service, prisma } = createService();
    mockSuccessfulTransition(prisma, {
      status: ConversationStatus.NORMAL,
      handlerId: null,
    });
    prisma.conversation.updateMany.mockResolvedValue({ count: 0 });

    expect(await service.reopenForUser('conv-1')).toBe(false);
    expect(prisma.chatMessage.create).not.toHaveBeenCalled();
  });
});

// ==================================================================
//  Task 4：列表展示「预计自动回 AI 时间」
//
//  由生命周期服务统一计算，避免 admin 列表自己读一套阈值、
//  cron 再读另一套。waiting 用 transferredAt（排队起点），
//  human 用 handlerAssignedAt（最后人工活动）。
// ==================================================================

describe('HandoffLifecycleService.getAutoReturnAt', () => {
  it('WAITING_HUMAN：transferredAt + 10 分钟（默认）', () => {
    const { service } = createService();
    const transferredAt = new Date('2026-11-22T12:00:00Z');

    const autoReturnAt = service.getAutoReturnAt({
      status: ConversationStatus.NORMAL,
      handlerId: AWAITING_HUMAN,
      transferredAt,
      handlerAssignedAt: null,
    });

    expect(autoReturnAt?.toISOString()).toBe('2026-11-22T12:10:00.000Z');
  });

  it('HUMAN_ACTIVE：handlerAssignedAt + 60 分钟（默认）', () => {
    const { service } = createService();
    const handlerAssignedAt = new Date('2026-11-22T12:00:00Z');

    const autoReturnAt = service.getAutoReturnAt({
      status: ConversationStatus.NORMAL,
      handlerId: 'admin-1',
      transferredAt: null,
      handlerAssignedAt,
    });

    expect(autoReturnAt?.toISOString()).toBe('2026-11-22T13:00:00.000Z');
  });

  it('AI_ACTIVE / CLOSED 没有自动回 AI 时间', () => {
    const { service } = createService();

    expect(
      service.getAutoReturnAt({
        status: ConversationStatus.NORMAL,
        handlerId: null,
        transferredAt: null,
        handlerAssignedAt: null,
      }),
    ).toBeNull();
    expect(
      service.getAutoReturnAt({
        status: ConversationStatus.ARCHIVED,
        handlerId: 'admin-1',
        transferredAt: null,
        handlerAssignedAt: new Date(),
      }),
    ).toBeNull();
  });

  it('env=0 时对应项返回 null（关闭即不提示）', () => {
    const waiting = createService({
      SUPPORT_WAIT_TIMEOUT_MINUTES: '0',
    }).service;
    const human = createService({
      SUPPORT_IDLE_TIMEOUT_MINUTES: '0',
    }).service;

    expect(
      waiting.getAutoReturnAt({
        status: ConversationStatus.NORMAL,
        handlerId: AWAITING_HUMAN,
        transferredAt: new Date(),
        handlerAssignedAt: null,
      }),
    ).toBeNull();
    expect(
      human.getAutoReturnAt({
        status: ConversationStatus.NORMAL,
        handlerId: 'admin-1',
        transferredAt: null,
        handlerAssignedAt: new Date(),
      }),
    ).toBeNull();
  });
});
