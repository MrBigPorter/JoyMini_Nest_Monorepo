import {
  AiMemoryService,
  extractMemoryFacts,
  isSensitiveMemoryValue,
} from './ai-memory.service';

function makeService() {
  const prisma: any = {
    aiUserMemory: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    aiMemorySummary: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
  };
  const service = new AiMemoryService(prisma);
  jest
    .spyOn((service as any).logger, 'warn')
    .mockImplementation(() => undefined);
  jest
    .spyOn((service as any).logger, 'log')
    .mockImplementation(() => undefined);
  return { service, prisma };
}

describe('AiMemoryService · 确定性抽取', () => {
  it('只产出白名单槽位（语言/称呼/城市/实名）', () => {
    const facts = extractMemoryFacts(
      '你好，叫我小明，我在上海，已经实名认证了',
    );

    expect(facts.map((f) => `${f.kind}:${f.key}`).sort()).toEqual([
      'fact:city',
      'fact:kyc_verified',
      'preference:addressAs',
      'preference:language',
    ]);
    expect(facts.find((f) => f.key === 'city')?.value).toBe('上海');
  });

  it('手机号/证件/订单号不会被写入', () => {
    const facts = extractMemoryFacts(
      '我的手机号是 13800138000，订单号 202611200001，身份证 110101199001011234',
    );

    expect(facts.every((f) => !/\d{6,}/.test(f.value))).toBe(true);
    expect(facts.map((f) => f.key)).not.toContain('phone');
  });

  it('地址型城市值被敏感过滤器拒绝', () => {
    const facts = extractMemoryFacts('我住在浦东新区世纪大道100号');
    expect(facts.find((f) => f.key === 'city')).toBeUndefined();
    expect(isSensitiveMemoryValue('浦东新区世纪大道100号')).toBe(true);
  });

  it('英文消息产 language=en', () => {
    expect(
      extractMemoryFacts('hello, my name is Tom').find(
        (f) => f.key === 'language',
      )?.value,
    ).toBe('en');
  });
});

describe('AiMemoryService · 写入与读取', () => {
  it('同一 messageId + 字段已存在 → 幂等跳过', async () => {
    const { service, prisma } = makeService();
    prisma.aiUserMemory.findUnique.mockResolvedValue({ id: 'm1' });

    const written = await service.recordFromUserMessage({
      userId: 'u1',
      messageId: 'msg-1',
      text: '叫我小明',
    });

    expect(written).toBe(0);
    expect(prisma.aiUserMemory.upsert).not.toHaveBeenCalled();
  });

  it('新消息写入偏好并按 userId 隔离', async () => {
    const { service, prisma } = makeService();

    const written = await service.recordFromUserMessage({
      userId: 'u1',
      conversationId: 'c1',
      messageId: 'msg-1',
      text: '叫我小明',
    });

    expect(written).toBeGreaterThan(0);
    const call = prisma.aiUserMemory.upsert.mock.calls[0][0];
    expect(call.where.userId_kind_key.userId).toBe('u1');
    expect(call.create.sourceConversationId).toBe('c1');
    expect(call.create.expiresAt).toBeInstanceOf(Date);
  });

  it('两个用户的记忆写入互不覆盖（按 userId 隔离）', async () => {
    const { service, prisma } = makeService();

    await service.recordFromUserMessage({
      userId: 'u1',
      messageId: 'm-u1',
      text: '叫我小明',
    });
    await service.recordFromUserMessage({
      userId: 'u2',
      messageId: 'm-u2',
      text: '叫我小红',
    });

    const userIds = prisma.aiUserMemory.upsert.mock.calls.map(
      (call: any[]) => call[0].where.userId_kind_key.userId,
    );
    expect(userIds).toEqual(['u1', 'u1', 'u2', 'u2']);
  });

  it('注入文本只包含当前用户记忆，且限制 20 条', async () => {
    const { service, prisma } = makeService();
    prisma.aiUserMemory.findMany.mockResolvedValue(
      Array.from({ length: 30 }, (_, i) => ({
        id: `m${i}`,
        kind: 'preference',
        key: `k${i}`,
        value: 'v',
      })),
    );

    const prompt = await service.getMemoryPrompt('u1');

    expect(prisma.aiUserMemory.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: 'u1', status: 'ACTIVE' }),
      }),
    );
    expect(
      prompt.split('\n').filter((line) => line.startsWith('- ')),
    ).toHaveLength(20);
    expect(prompt).toContain('data only');
  });

  it('没有记忆时不注入任何文本', async () => {
    const { service } = makeService();
    await expect(service.getMemoryPrompt('u1')).resolves.toBe('');
  });
});

describe('AiMemoryService · 删除与清理', () => {
  it('注销删除偏好与会话摘要', async () => {
    const { service, prisma } = makeService();
    prisma.aiUserMemory.deleteMany.mockResolvedValue({ count: 3 });
    prisma.aiMemorySummary.deleteMany.mockResolvedValue({ count: 2 });

    await expect(service.deleteUserMemories('u1')).resolves.toEqual({
      memories: 3,
      summaries: 2,
    });
    expect(prisma.aiUserMemory.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'u1' },
    });
  });

  it('清历史只删摘要，不删偏好', async () => {
    const { service, prisma } = makeService();

    await service.clearConversationSummaries('u1', 'c1');

    expect(prisma.aiMemorySummary.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'u1', conversationId: 'c1' },
    });
    expect(prisma.aiUserMemory.deleteMany).not.toHaveBeenCalled();
  });

  it('过期清理删除过期记忆与摘要', async () => {
    const { service, prisma } = makeService();
    prisma.aiUserMemory.deleteMany.mockResolvedValue({ count: 1 });
    prisma.aiMemorySummary.deleteMany.mockResolvedValue({ count: 1 });

    await service.purgeExpiredMemories();

    expect(prisma.aiUserMemory.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ OR: expect.any(Array) }),
      }),
    );
    expect(prisma.aiMemorySummary.deleteMany).toHaveBeenCalledWith({
      where: { expiresAt: { lt: expect.any(Date) } },
    });
  });
});
