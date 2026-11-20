import {
  AI_OUTBOX_MAX_ATTEMPTS,
  AiTaskOutboxService,
} from './ai-task-outbox.service';

const row = (overrides: Record<string, unknown> = {}) => ({
  id: 'outbox-1',
  messageId: 'msg-1',
  conversationId: 'conv-1',
  userId: 'user-1',
  attempts: 1,
  ...overrides,
});

function makeService() {
  const prisma: any = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    chatMessage: { findUnique: jest.fn() },
    conversation: { findUnique: jest.fn() },
    aiTaskOutbox: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findMany: jest.fn().mockResolvedValue([]),
    },
  };
  const aiQueue = { enqueue: jest.fn().mockResolvedValue(undefined) };
  const service = new AiTaskOutboxService(prisma, aiQueue as any);
  jest
    .spyOn((service as any).logger, 'log')
    .mockImplementation(() => undefined);
  jest
    .spyOn((service as any).logger, 'warn')
    .mockImplementation(() => undefined);
  jest
    .spyOn((service as any).logger, 'error')
    .mockImplementation(() => undefined);
  return { service, prisma, aiQueue };
}

const message = {
  id: 'msg-1',
  conversationId: 'conv-1',
  senderId: 'user-1',
  content: 'hello',
};

describe('AiTaskOutboxService · relay', () => {
  it('领取 PENDING 行 → 按 messageId 回查消息 → 入队 → 标记 SENT', async () => {
    const { service, prisma, aiQueue } = makeService();
    prisma.$queryRaw.mockResolvedValue([row()]);
    prisma.chatMessage.findUnique.mockResolvedValue(message);
    prisma.conversation.findUnique.mockResolvedValue({
      type: 'AI',
      handlerId: null,
    });

    const result = await service.relayDue();

    expect(result).toEqual({ claimed: 1, sent: 1, failed: 0 });
    expect(aiQueue.enqueue).toHaveBeenCalledWith({
      conversationId: 'conv-1',
      content: 'hello',
      userId: 'user-1',
      messageId: 'msg-1',
    });
    expect(prisma.aiTaskOutbox.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'outbox-1' },
        data: expect.objectContaining({ status: 'SENT' }),
      }),
    );
  });

  it('领取语句使用 SKIP LOCKED：多实例并发只有一个能拿到行', async () => {
    const { service, prisma } = makeService();

    await service.relayDue();

    // 把 tagged template 的静态片段拼起来，钉住并发安全语义：
    // 没有 SKIP LOCKED，多副本会阻塞在行锁上或重复投递。
    const sql = (prisma.$queryRaw.mock.calls[0][0] as string[]).join(' ');
    expect(sql).toContain('FOR UPDATE SKIP LOCKED');
  });

  it('没有可领取的行：不查消息、不入队', async () => {
    const { service, prisma, aiQueue } = makeService();

    await expect(service.relayDue()).resolves.toEqual({
      claimed: 0,
      sent: 0,
      failed: 0,
    });
    expect(prisma.chatMessage.findUnique).not.toHaveBeenCalled();
    expect(aiQueue.enqueue).not.toHaveBeenCalled();
  });

  it('入队失败：回退 PENDING + 退避，不丢失任务', async () => {
    const { service, prisma, aiQueue } = makeService();
    prisma.$queryRaw.mockResolvedValue([row()]);
    prisma.chatMessage.findUnique.mockResolvedValue(message);
    prisma.conversation.findUnique.mockResolvedValue({
      type: 'AI',
      handlerId: null,
    });
    aiQueue.enqueue.mockRejectedValue(new Error('redis down'));

    const result = await service.relayDue();

    expect(result).toEqual({ claimed: 1, sent: 0, failed: 1 });
    const update = prisma.aiTaskOutbox.updateMany.mock.calls[0][0];
    expect(update.data).toMatchObject({
      status: 'PENDING',
      lastError: 'redis down',
    });
    expect(update.data.nextAttemptAt).toBeInstanceOf(Date);
    expect(update.data.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('达到最大尝试次数：置 FAILED，等待人工重放', async () => {
    const { service, prisma, aiQueue } = makeService();
    prisma.$queryRaw.mockResolvedValue([
      row({ attempts: AI_OUTBOX_MAX_ATTEMPTS }),
    ]);
    prisma.chatMessage.findUnique.mockResolvedValue(message);
    prisma.conversation.findUnique.mockResolvedValue({
      type: 'AI',
      handlerId: null,
    });
    aiQueue.enqueue.mockRejectedValue(new Error('redis down'));

    await service.relayDue();

    expect(prisma.aiTaskOutbox.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'FAILED' }),
      }),
    );
  });

  it('消息不存在：直接 FAILED，不调用队列', async () => {
    const { service, prisma, aiQueue } = makeService();
    prisma.$queryRaw.mockResolvedValue([row()]);
    prisma.chatMessage.findUnique.mockResolvedValue(null);

    await service.relayDue();

    expect(aiQueue.enqueue).not.toHaveBeenCalled();
    expect(prisma.aiTaskOutbox.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'FAILED',
          lastError: 'message_not_found',
        }),
      }),
    );
  });

  it('relay 滞后且会话已转人工：直接标记 SENT，不触发模型', async () => {
    const { service, prisma, aiQueue } = makeService();
    prisma.$queryRaw.mockResolvedValue([row()]);
    prisma.chatMessage.findUnique.mockResolvedValue(message);
    prisma.conversation.findUnique.mockResolvedValue({
      type: 'AI',
      handlerId: 'admin-1',
    });

    const result = await service.relayDue();

    expect(result).toEqual({ claimed: 1, sent: 1, failed: 0 });
    expect(aiQueue.enqueue).not.toHaveBeenCalled();
    expect(prisma.aiTaskOutbox.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'SENT' }),
      }),
    );
  });

  it('故障演练：提交后未入队（进程崩溃）→ 下一轮 relay 补投且只投一次', async () => {
    const { service, prisma, aiQueue } = makeService();
    // 模拟「消息事务已提交、queue.add 前进程崩溃」：第一次没有立即投递，
    // 只有 Outbox 行留在库里；下一次 cron 领取时恢复正常。
    prisma.$queryRaw.mockResolvedValueOnce([row({ attempts: 1 })]);
    prisma.chatMessage.findUnique.mockResolvedValue(message);
    prisma.conversation.findUnique.mockResolvedValue({
      type: 'AI',
      handlerId: null,
    });
    aiQueue.enqueue.mockRejectedValueOnce(new Error('process killed'));

    const first = await service.relayDue();
    expect(first).toEqual({ claimed: 1, sent: 0, failed: 1 });
    expect(aiQueue.enqueue).toHaveBeenCalledTimes(1);

    // 模拟 relay 重启后的下一轮扫描：同一行仍可被领取
    prisma.$queryRaw.mockResolvedValue([row({ attempts: 2 })]);
    const second = await service.relayDue();

    expect(second).toEqual({ claimed: 1, sent: 1, failed: 0 });
    expect(aiQueue.enqueue).toHaveBeenCalledTimes(2);
    // jobId = messageId，消费侧幂等保证只产生一条 AI 回复
    expect(aiQueue.enqueue.mock.calls[1][0].messageId).toBe('msg-1');
  });

  it('立即投递只领取指定 messageId，失败不向调用方抛错', async () => {
    const { service, prisma, aiQueue } = makeService();
    prisma.$queryRaw.mockRejectedValue(new Error('db down'));

    await expect(service.relayByMessageId('msg-1')).resolves.toBeUndefined();
    expect(aiQueue.enqueue).not.toHaveBeenCalled();
  });
});

describe('AiTaskOutboxService · 死信可见与重放', () => {
  it('replayFailed 只重置 FAILED 行，然后立即尝试投递', async () => {
    const { service, prisma } = makeService();
    prisma.$queryRaw.mockResolvedValue([]);

    await expect(service.replayFailed('msg-1')).resolves.toBe(true);
    expect(prisma.aiTaskOutbox.updateMany).toHaveBeenCalledWith({
      where: { messageId: 'msg-1', status: 'FAILED' },
      data: expect.objectContaining({
        status: 'PENDING',
        attempts: 0,
        lastError: null,
      }),
    });
    // replay 之后的立即投递也走了 claim
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('没有 FAILED 行时拒绝重放', async () => {
    const { service, prisma } = makeService();
    prisma.aiTaskOutbox.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.replayFailed('missing')).resolves.toBe(false);
  });
});
