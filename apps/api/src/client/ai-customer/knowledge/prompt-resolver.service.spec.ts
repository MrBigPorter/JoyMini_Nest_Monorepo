import { AgentPromptConfig } from '@api/client/ai-customer/graph/agents/prompt-builder';
import { deepMerge, PromptResolverService } from './prompt-resolver.service';

const tsConfig: Omit<AgentPromptConfig, 'userId'> = {
  role: 'TS role',
  domainName: 'wallet',
  workflow: 'TS workflow',
  examples: 'TS examples',
  scopeRestriction: {
    domain: 'wallet',
    handles: ['balance', 'withdraw'],
    outside: ['orders'],
  },
  hardRules: ['rule-a'],
  flowContext: false,
};

function build(dbPrompt: any, reject = false) {
  const prisma: any = {
    knowledgePrompt: {
      findMany: reject
        ? jest.fn().mockRejectedValue(new Error('db down'))
        : jest.fn().mockResolvedValue(dbPrompt ? [dbPrompt] : []),
    },
  };
  return new PromptResolverService(prisma);
}

describe('PromptResolverService.mergeConfig', () => {
  it('DB 只覆盖显式字段，未提供的保留 TS 默认', async () => {
    const service = build({
      name: 'wallet',
      versions: [
        {
          version: 2,
          config: {
            role: 'DB role',
            scopeRestriction: { handles: ['balance'] },
          },
        },
      ],
    });

    const result = await service.mergeConfig('wallet', tsConfig);

    expect(result.version).toBe(2);
    expect(result.config.role).toBe('DB role');
    expect(result.config.workflow).toBe('TS workflow');
    expect(result.config.examples).toBe('TS examples');
    expect(result.config.scopeRestriction).toEqual({
      domain: 'wallet',
      handles: ['balance'],
      outside: ['orders'],
    });
    expect(result.config.hardRules).toEqual(['rule-a']);
  });

  it('兼容历史命名 wallet-agent', async () => {
    const service = build({
      name: 'wallet-agent',
      versions: [{ version: 3, config: { role: 'legacy role' } }],
    });

    const result = await service.mergeConfig('wallet', tsConfig);
    expect(result.version).toBe(3);
    expect(result.config.role).toBe('legacy role');
  });

  it('数组整体替换，不拼接', async () => {
    const merged = deepMerge(
      { hardRules: ['a', 'b'], nested: { x: 1, y: 2 } },
      { hardRules: ['c'], nested: { y: 3 } },
    );
    expect(merged).toEqual({ hardRules: ['c'], nested: { x: 1, y: 3 } });
  });

  it('DB 里的 userId 被丢弃，身份只能来自请求上下文', async () => {
    const service = build({
      name: 'wallet',
      versions: [
        {
          version: 1,
          config: { role: 'DB role', userId: 'attacker' },
        },
      ],
    });

    const result = await service.mergeConfig('wallet', tsConfig);
    expect((result.config as any).userId).toBeUndefined();
  });

  it('没有 override 时返回 TS 默认', async () => {
    const service = build(null);
    const result = await service.mergeConfig('wallet', tsConfig);
    expect(result.config).toEqual(tsConfig);
    expect(result.version).toBeNull();
  });

  it('DB 异常时回退 TS 默认，不阻塞流水线', async () => {
    const service = build(null, true);
    const result = await service.mergeConfig('wallet', tsConfig);
    expect(result.config).toEqual(tsConfig);
    expect(result.version).toBeNull();
  });
});
