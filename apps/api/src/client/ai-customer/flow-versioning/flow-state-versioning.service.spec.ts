import {
  computeDefinitionHash,
  FlowStateVersioningService,
  stableStringify,
} from './flow-state-versioning.service';

function makeService() {
  const prisma: any = {
    flowDefinitionVersion: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      aggregate: jest.fn().mockResolvedValue({ _max: { version: 0 } }),
      create: jest.fn(),
    },
    conversationFlowBinding: {
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
      update: jest.fn(),
    },
    flowBindingAuditLog: { create: jest.fn().mockResolvedValue({}) },
    conversation: { findUnique: jest.fn() },
    chatMember: { findFirst: jest.fn().mockResolvedValue(null) },
    $transaction: jest.fn(async (cb: (tx: any) => any) => cb(prisma)),
  };
  const redis = { get: jest.fn().mockResolvedValue(null) };
  const registry = { getWriteToolNames: jest.fn(() => ['claimCoupon']) };
  const service = new FlowStateVersioningService(
    prisma,
    redis as any,
    registry as any,
  );
  jest
    .spyOn((service as any).logger, 'log')
    .mockImplementation(() => undefined);
  jest
    .spyOn((service as any).logger, 'warn')
    .mockImplementation(() => undefined);
  return { service, prisma, redis, registry };
}

const definition = {
  id: 'def-2',
  flowType: 'WITHDRAWAL',
  version: 2,
  definitionHash: 'hash-2',
  status: 'ACTIVE',
};

const binding = {
  id: 'bind-1',
  conversationId: 'conv-1',
  flowType: 'WITHDRAWAL',
  definitionVersionId: 'def-1',
  definitionHash: 'hash-1',
  status: 'ACTIVE',
  threadId: 'thread-1',
  checkpointId: null,
};

describe('FlowStateVersioningService · 定义哈希', () => {
  it('对象 key 顺序不同但内容相同 → 同一个 hash', () => {
    expect(stableStringify({ b: 1, a: { d: 2, c: 3 } })).toBe(
      stableStringify({ a: { c: 3, d: 2 }, b: 1 }),
    );
    expect(computeDefinitionHash({ b: 1, a: 2 })).toBe(
      computeDefinitionHash({ a: 2, b: 1 }),
    );
  });

  it('内容变化（allowedStatuses）→ hash 变化', () => {
    const base = { flowType: 'WITHDRAWAL', allowedStatuses: ['IDLE'] };
    expect(computeDefinitionHash(base)).not.toBe(
      computeDefinitionHash({
        ...base,
        allowedStatuses: ['IDLE', 'FILLING'],
      }),
    );
  });
});

describe('FlowStateVersioningService · 定义登记', () => {
  it('同 hash 已存在时直接复用，不新增版本', async () => {
    const { service, prisma } = makeService();
    const payload = { flowType: 'WITHDRAWAL', allowedStatuses: ['IDLE'] };
    prisma.flowDefinitionVersion.findUnique.mockResolvedValue({
      id: 'def-1',
      definitionHash: computeDefinitionHash(payload),
    });

    const result = await service.registerDefinition({
      flowType: 'WITHDRAWAL',
      payload,
    });

    expect(result.id).toBe('def-1');
    expect(prisma.flowDefinitionVersion.create).not.toHaveBeenCalled();
  });

  it('新内容按当前最大 version+1 生成新版本', async () => {
    const { service, prisma } = makeService();
    prisma.flowDefinitionVersion.findUnique.mockResolvedValue(null);
    prisma.flowDefinitionVersion.aggregate.mockResolvedValue({
      _max: { version: 3 },
    });
    prisma.flowDefinitionVersion.create.mockImplementation(
      async ({ data }: { data: Record<string, any> }) => ({
        id: 'def-4',
        ...data,
      }),
    );

    const result = await service.registerDefinition({
      flowType: 'WITHDRAWAL',
      payload: { flowType: 'WITHDRAWAL', allowedStatuses: ['IDLE'] },
      createdBy: 'admin',
    });

    expect(prisma.flowDefinitionVersion.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        flowType: 'WITHDRAWAL',
        version: 4,
        status: 'ACTIVE',
        createdBy: 'admin',
      }),
    });
    expect(result.version).toBe(4);
  });
});

describe('FlowStateVersioningService · 绑定', () => {
  it('已有绑定 → 旧会话保持原版本，不跟随最新', async () => {
    const { service, prisma } = makeService();
    prisma.conversationFlowBinding.findUnique.mockResolvedValue(binding);

    const result = await service.bindLatest({
      conversationId: 'conv-1',
      flowType: 'WITHDRAWAL',
    });

    expect(result).toBe(binding);
    expect(prisma.flowDefinitionVersion.findFirst).not.toHaveBeenCalled();
    expect(prisma.conversationFlowBinding.create).not.toHaveBeenCalled();
  });

  it('首次绑定 → 取最新版本并写 BIND 审计', async () => {
    const { service, prisma } = makeService();
    prisma.conversationFlowBinding.findUnique.mockResolvedValue(null);
    prisma.flowDefinitionVersion.findFirst.mockResolvedValue(definition);
    prisma.conversation.findUnique.mockResolvedValue({ threadId: 'thread-1' });
    prisma.conversationFlowBinding.create.mockResolvedValue({
      ...binding,
      definitionVersionId: definition.id,
    });

    await service.bindLatest({
      conversationId: 'conv-1',
      flowType: 'WITHDRAWAL',
    });

    expect(prisma.conversationFlowBinding.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        conversationId: 'conv-1',
        flowType: 'WITHDRAWAL',
        definitionVersionId: 'def-2',
        threadId: 'thread-1',
      }),
    });
    expect(prisma.flowBindingAuditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: 'BIND', toVersionId: 'def-2' }),
    });
  });
});

describe('FlowStateVersioningService · 安全切换', () => {
  function arrange(overrides: Record<string, any> = {}) {
    const ctx = makeService();
    ctx.prisma.flowDefinitionVersion.findUnique.mockResolvedValue(definition);
    ctx.prisma.conversationFlowBinding.findUnique.mockResolvedValue(binding);
    ctx.prisma.conversation.findUnique.mockResolvedValue(
      overrides.conversation ?? { handlerId: null, threadId: 'thread-1' },
    );
    ctx.prisma.chatMember.findFirst.mockResolvedValue(overrides.member ?? null);
    if ('pending' in overrides) {
      ctx.redis.get.mockResolvedValue(overrides.pending);
    }
    return ctx;
  }

  it('安全点满足 → 只更新绑定指针并写 SWITCH 审计', async () => {
    const { service, prisma } = arrange();

    const result = await service.switchDefinition({
      conversationId: 'conv-1',
      toVersionId: 'def-2',
      actorId: 'admin',
      reason: 'upgrade',
    });

    expect(result).toEqual({ ok: true });
    expect(prisma.conversationFlowBinding.update).toHaveBeenCalledWith({
      where: { id: 'bind-1' },
      data: expect.objectContaining({ definitionVersionId: 'def-2' }),
    });
    expect(prisma.flowBindingAuditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'SWITCH',
        fromVersionId: 'def-1',
        toVersionId: 'def-2',
      }),
    });
  });

  it('人工处理中 → 拒绝', async () => {
    const { service } = arrange({
      conversation: { handlerId: 'admin-1', threadId: 'thread-1' },
    });
    await expect(
      service.switchDefinition({
        conversationId: 'conv-1',
        toVersionId: 'def-2',
      }),
    ).resolves.toEqual({ ok: false, reason: 'human_handling' });
  });

  it('thread 漂移 → 拒绝', async () => {
    const { service } = arrange({
      conversation: { handlerId: null, threadId: 'thread-new' },
    });
    await expect(
      service.switchDefinition({
        conversationId: 'conv-1',
        toVersionId: 'def-2',
      }),
    ).resolves.toEqual({ ok: false, reason: 'thread_drift' });
  });

  it('存在待确认操作 → 拒绝', async () => {
    const { service } = arrange({
      member: { userId: 'u1' },
      pending: '{"action":"withdraw"}',
    });
    await expect(
      service.switchDefinition({
        conversationId: 'conv-1',
        toVersionId: 'def-2',
      }),
    ).resolves.toEqual({ ok: false, reason: 'pending_confirmation' });
  });

  it('Redis 不可用 → fail-closed，不能假设没有待确认操作', async () => {
    const { service, redis } = arrange({ member: { userId: 'u1' } });
    redis.get.mockRejectedValue(new Error('redis down'));

    await expect(
      service.switchDefinition({
        conversationId: 'conv-1',
        toVersionId: 'def-2',
      }),
    ).resolves.toEqual({ ok: false, reason: 'pending_check_unavailable' });
  });

  it('目标版本不属于该 flowType → 拒绝', async () => {
    const { service, prisma } = arrange();
    prisma.flowDefinitionVersion.findUnique.mockResolvedValue({
      ...definition,
      flowType: 'DEPOSIT',
    });
    await expect(
      service.switchDefinition({
        conversationId: 'conv-1',
        flowType: 'WITHDRAWAL',
        toVersionId: 'def-2',
      }),
    ).resolves.toEqual({ ok: false, reason: 'flow_type_mismatch' });
  });

  it('定义回滚：允许切回 DEPRECATED 版本，并记 ROLLBACK_DEFINITION 审计', async () => {
    const { service, prisma } = arrange();
    prisma.flowDefinitionVersion.findUnique.mockResolvedValue({
      ...definition,
      status: 'DEPRECATED',
    });

    const result = await service.switchDefinition(
      {
        conversationId: 'conv-1',
        toVersionId: 'def-2',
        actorId: 'admin',
        reason: 'bad release',
      },
      'ROLLBACK_DEFINITION',
    );

    expect(result).toEqual({ ok: true });
    expect(prisma.flowBindingAuditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'ROLLBACK_DEFINITION',
        toVersionId: 'def-2',
      }),
    });
  });

  it('回滚状态 fail-closed，不假装成功', async () => {
    const { service } = makeService();
    await expect(service.rollbackState()).resolves.toEqual({
      ok: false,
      reason: 'state_rollback_not_supported',
    });
  });
});
