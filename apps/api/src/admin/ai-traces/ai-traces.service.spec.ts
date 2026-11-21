import { NotFoundException } from '@nestjs/common';
import { TraceService } from './ai-traces.service';

function makeService() {
  const prisma: any = {
    aiTrace: {
      create: jest.fn().mockResolvedValue({ id: 'trace-1', spans: [] }),
      findMany: jest.fn().mockResolvedValue([{ id: 'trace-1' }]),
      count: jest.fn().mockResolvedValue(1),
      findUnique: jest.fn(),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    aiScore: {
      findMany: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
  };
  return { service: new TraceService(prisma), prisma };
}

describe('TraceService', () => {
  it('purgeExpired 删除保留期外的 trace 与 score', async () => {
    const { service, prisma } = makeService();
    prisma.aiTrace.deleteMany.mockResolvedValue({ count: 3 });
    prisma.aiScore.deleteMany.mockResolvedValue({ count: 2 });
    process.env.AI_TRACE_RETENTION_DAYS = '30';

    await service.purgeExpired();

    expect(prisma.aiTrace.deleteMany).toHaveBeenCalledWith({
      where: { createdAt: { lt: expect.any(Date) } },
    });
    expect(prisma.aiScore.deleteMany).toHaveBeenCalledWith({
      where: { createdAt: { lt: expect.any(Date) }, source: 'LLM' },
    });
    delete process.env.AI_TRACE_RETENTION_DAYS;
  });

  it('recordTrace 创建 trace 并写入 spans', async () => {
    const { service, prisma } = makeService();
    const startedAt = new Date('2026-11-21T00:00:00.000Z');

    const result = await service.recordTrace({
      conversationId: 'conv-1',
      triggerMessageId: 'msg-1',
      userId: 'user-1',
      intent: 'order',
      input: '我想查订单',
      output: '您的订单已发货',
      status: 'SUCCESS',
      latencyMs: 120,
      promptTokens: 10,
      completionTokens: 20,
      metadata: { flow: 'order' },
      spans: [
        {
          type: 'intent',
          name: 'intent-router',
          output: { intent: 'order' },
          startedAt,
        },
        {
          type: 'llm',
          name: 'llm-response',
          durationMs: 100,
          startedAt,
          endedAt: new Date(startedAt.getTime() + 100),
        },
      ],
    });

    expect(result).toEqual({ id: 'trace-1', spans: [] });
    expect(prisma.aiTrace.create).toHaveBeenCalledTimes(1);
    const call = prisma.aiTrace.create.mock.calls[0][0];
    expect(call.data).toEqual(
      expect.objectContaining({
        conversationId: 'conv-1',
        triggerMessageId: 'msg-1',
        userId: 'user-1',
        intent: 'order',
        status: 'SUCCESS',
        latencyMs: 120,
        promptTokens: 10,
        completionTokens: 20,
      }),
    );
    expect(call.data.spans.create).toHaveLength(2);
    expect(call.data.spans.create[0]).toEqual(
      expect.objectContaining({ type: 'intent', name: 'intent-router' }),
    );
    expect(call.include).toEqual({ spans: true });
  });

  it('recordTrace 截断超长输入输出，并默认 SUCCESS', async () => {
    const { service, prisma } = makeService();

    await service.recordTrace({
      conversationId: 'conv-1',
      input: 'a'.repeat(1200),
      output: 'b'.repeat(2500),
    });

    const data = prisma.aiTrace.create.mock.calls[0][0].data;
    expect(data.status).toBe('SUCCESS');
    expect(data.input.length).toBe(1001); // 1000 + 省略号
    expect(data.output.length).toBe(2001);
  });

  it('recordTrace 写入失败时不抛错（埋点不影响对话）', async () => {
    const { service, prisma } = makeService();
    prisma.aiTrace.create.mockRejectedValue(new Error('db down'));

    await expect(
      service.recordTrace({ conversationId: 'conv-1' }),
    ).resolves.toBeNull();
  });

  it('list 按条件分页并按创建时间倒序', async () => {
    const { service, prisma } = makeService();

    const result = await service.list({
      conversationId: 'conv-1',
      intent: 'order',
      page: 2,
      pageSize: 10,
    });

    expect(prisma.aiTrace.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { conversationId: 'conv-1', intent: 'order' },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: 10,
        take: 10,
      }),
    );
    expect(prisma.aiTrace.count).toHaveBeenCalledWith({
      where: { conversationId: 'conv-1', intent: 'order' },
    });
    expect(result).toEqual({
      list: [{ id: 'trace-1' }],
      total: 1,
      page: 2,
      pageSize: 10,
    });
  });

  it('list 对 pageSize 做上限保护', async () => {
    const { service, prisma } = makeService();

    const result = await service.list({ page: -3, pageSize: 999 });

    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(100);
    expect(prisma.aiTrace.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 0, take: 100 }),
    );
  });

  it('get 返回含 spans 的详情', async () => {
    const { service, prisma } = makeService();
    const detail = { id: 'trace-1', spans: [{ id: 'span-1' }] };
    prisma.aiTrace.findUnique.mockResolvedValue(detail);

    await expect(service.get('trace-1')).resolves.toEqual({ ...detail, scores: [] });
    expect(prisma.aiTrace.findUnique).toHaveBeenCalledWith({
      where: { id: 'trace-1' },
      include: {
        spans: { orderBy: [{ startedAt: 'asc' }, { id: 'asc' }] },
      },
    });
  });

  it('get 找不到时抛 NotFoundException', async () => {
    const { service, prisma } = makeService();
    prisma.aiTrace.findUnique.mockResolvedValue(null);

    await expect(service.get('missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
