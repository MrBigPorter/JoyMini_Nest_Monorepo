import { evaluateSupportQueue, SupportSlaService } from './support-sla.service';

describe('evaluateSupportQueue', () => {
  const now = Date.UTC(2026, 10, 19, 12, 0, 0);
  const thresholdMs = 5 * 60_000;

  it('统计排队数、超 SLA 数与最长等待', () => {
    const snapshot = evaluateSupportQueue(
      [
        { id: 'c1', transferredAt: new Date(now - 10 * 60_000) },
        { id: 'c2', transferredAt: new Date(now - 6 * 60_000) },
        { id: 'c3', transferredAt: new Date(now - 2 * 60_000) },
        { id: 'c4', transferredAt: null },
      ],
      now,
      thresholdMs,
    );

    expect(snapshot.waiting).toBe(4);
    expect(snapshot.breached).toBe(2);
    expect(snapshot.breachedIds).toEqual(['c1', 'c2']);
    expect(snapshot.oldestWaitMs).toBe(10 * 60_000);
  });

  it('刚好等于阈值算超 SLA', () => {
    const snapshot = evaluateSupportQueue(
      [{ id: 'c1', transferredAt: new Date(now - thresholdMs) }],
      now,
      thresholdMs,
    );

    expect(snapshot.breached).toBe(1);
  });

  it('没有 transferredAt 的会话不计入等待时长', () => {
    const snapshot = evaluateSupportQueue(
      [{ id: 'c1', transferredAt: null }],
      now,
      thresholdMs,
    );

    expect(snapshot.waiting).toBe(1);
    expect(snapshot.breached).toBe(0);
    expect(snapshot.oldestWaitMs).toBe(0);
  });
});

describe('SupportSlaService.getHistory', () => {
  it('取窗口内最新 2000 条（desc）后反转为升序，latest 限定同一窗口', async () => {
    const newer = { id: 's2', createdAt: new Date('2026-11-20T10:00:00Z') };
    const older = { id: 's1', createdAt: new Date('2026-11-20T09:00:00Z') };
    const prisma: any = {
      supportSlaSnapshot: {
        // DB 按 desc 返回：最新在前
        findMany: jest.fn().mockResolvedValue([newer, older]),
        findFirst: jest.fn().mockResolvedValue(newer),
      },
    };
    const config: any = { get: jest.fn() };
    const service = new SupportSlaService(prisma, config);

    const result = await service.getHistory(24);

    const findManyArgs = prisma.supportSlaSnapshot.findMany.mock.calls[0][0];
    expect(findManyArgs.orderBy).toEqual({ createdAt: 'desc' });
    expect(findManyArgs.take).toBe(2000);
    expect(findManyArgs.where.createdAt.gte).toBeInstanceOf(Date);

    const findFirstArgs = prisma.supportSlaSnapshot.findFirst.mock.calls[0][0];
    expect(findFirstArgs.orderBy).toEqual({ createdAt: 'desc' });
    expect(findFirstArgs.where.createdAt.gte).toBeInstanceOf(Date);

    // 返回给 API 时反转为升序（旧 -> 新）
    expect(result.snapshots.map((s: any) => s.id)).toEqual(['s1', 's2']);
    expect(result.latest).toBe(newer);
    expect(result.windowHours).toBe(24);
    expect(result.thresholdMinutes).toBe(5);
  });
});

describe('SupportSlaService.waitingQueue', () => {
  it('返回等待秒数和是否超 SLA，不返回用户隐私', async () => {
    const prisma: any = {
      conversation: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'c1',
            transferredAt: new Date(Date.now() - 10 * 60_000),
            transferReason: 'ai_error',
            lastMsgContent: '在吗',
            lastMsgTime: new Date(),
          },
        ]),
      },
    };
    const config: any = { get: jest.fn().mockReturnValue('5') };
    const service = new SupportSlaService(prisma, config);

    const result = await service.waitingQueue();

    expect(result.thresholdMinutes).toBe(5);
    expect(result.items[0]).toMatchObject({
      conversationId: 'c1',
      transferReason: 'ai_error',
      breached: true,
    });
    expect(result.items[0].waitingSeconds).toBeGreaterThanOrEqual(600);
    expect(result.items[0]).not.toHaveProperty('userId');
  });
});
