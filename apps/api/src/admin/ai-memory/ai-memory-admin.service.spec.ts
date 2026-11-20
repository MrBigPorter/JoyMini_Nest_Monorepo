import { AiMemoryAdminService } from './ai-memory-admin.service';

function makeService() {
  const prisma: any = {
    aiUserMemory: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    aiMemorySummary: {
      findMany: jest.fn().mockResolvedValue([]),
    },
  };
  const memory = {
    deleteUserMemories: jest
      .fn()
      .mockResolvedValue({ memories: 3, summaries: 2 }),
  };
  const operationLog = { log: jest.fn().mockResolvedValue(undefined) };
  const service = new AiMemoryAdminService(
    prisma,
    memory as any,
    operationLog as any,
  );
  return { service, prisma, memory, operationLog };
}

describe('AiMemoryAdminService', () => {
  it('按用户返回记忆与摘要', async () => {
    const { service, prisma } = makeService();
    prisma.aiUserMemory.findMany.mockResolvedValue([
      { id: 'm1', userId: 'u1', kind: 'preference' },
    ]);

    const result = await service.getUserMemories('u1');

    expect(result.userId).toBe('u1');
    expect(result.memories).toHaveLength(1);
    expect(prisma.aiMemorySummary.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'u1' } }),
    );
  });

  it('单条删除为软删并写操作日志', async () => {
    const { service, prisma, operationLog } = makeService();
    prisma.aiUserMemory.findUnique.mockResolvedValue({
      id: 'm1',
      userId: 'u1',
    });
    prisma.aiUserMemory.update.mockResolvedValue({
      id: 'm1',
      status: 'DELETED',
    });

    await service.deleteMemory('m1', 'admin-1');

    expect(prisma.aiUserMemory.update).toHaveBeenCalledWith({
      where: { id: 'm1' },
      data: { status: 'DELETED' },
    });
    expect(operationLog.log).toHaveBeenCalledWith(
      expect.objectContaining({ module: 'ai-memory', action: 'delete' }),
    );
  });

  it('整用户删除走 AiMemoryService 并写审计', async () => {
    const { service, memory, operationLog } = makeService();

    const result = await service.deleteUserMemories('u1', 'admin-1');

    expect(result).toEqual({ memories: 3, summaries: 2 });
    expect(memory.deleteUserMemories).toHaveBeenCalledWith('u1');
    expect(operationLog.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'delete-all' }),
    );
  });
});
