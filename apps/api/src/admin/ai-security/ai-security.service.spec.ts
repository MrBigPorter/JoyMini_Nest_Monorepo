import { AiSecurityService } from './ai-security.service';

function makeService() {
  const prisma: any = {
    aiSecurityEvent: {
      count: jest.fn().mockResolvedValue(1),
      groupBy: jest.fn(),
      findFirst: jest.fn().mockResolvedValue({ createdAt: new Date() }),
      update: jest.fn().mockResolvedValue({ id: 'evt-1' }),
    },
  };
  return { service: new AiSecurityService(prisma), prisma };
}

describe('AiSecurityService', () => {
  it('triage 写入处置状态与审核人', async () => {
    const { service, prisma } = makeService();

    await service.triage(
      'evt-1',
      { status: 'FALSE_POSITIVE', note: '测试关键词' },
      'admin-1',
    );

    expect(prisma.aiSecurityEvent.update).toHaveBeenCalledWith({
      where: { id: 'evt-1' },
      data: expect.objectContaining({
        status: 'FALSE_POSITIVE',
        note: '测试关键词',
        reviewedBy: 'admin-1',
      }),
    });
  });

  it('summary 返回按状态分布', async () => {
    const { service, prisma } = makeService();
    prisma.aiSecurityEvent.groupBy
      .mockResolvedValueOnce([{ type: 'prompt_override', _count: { id: 1 } }])
      .mockResolvedValueOnce([{ mode: 'log', _count: { id: 1 } }])
      .mockResolvedValueOnce([{ status: 'NEW', _count: { id: 1 } }]);

    const result = await service.summary({} as any);

    expect(result.byStatus).toEqual([{ status: 'NEW', count: 1 }]);
  });
});
