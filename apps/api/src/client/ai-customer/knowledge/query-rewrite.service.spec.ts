import {
  buildRewriteCacheKey,
  hasCjk,
  normalizeQuery,
  QueryRewriteService,
  sanitizeRewrite,
} from './query-rewrite.service';

function fakeRedis(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  return {
    store,
    get: jest.fn(async (key: string) => store.get(key) ?? null),
    set: jest.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    del: jest.fn(),
  } as any;
}

const llmConfig = { type: 'online' as const, model: 'deepseek-chat' };

describe('query rewrite helpers', () => {
  it('识别 CJK', () => {
    expect(hasCjk('抽奖券怎么获得')).toBe(true);
    expect(hasCjk('How to get lucky draw tickets')).toBe(false);
    expect(hasCjk('抽奖券 how')).toBe(true);
  });

  it('规范化与缓存键稳定', () => {
    expect(normalizeQuery('  抽奖券   怎么获得 ')).toBe('抽奖券 怎么获得');
    expect(buildRewriteCacheKey('抽奖券 怎么获得')).toBe(
      buildRewriteCacheKey('  抽奖券 怎么获得  '),
    );
    expect(buildRewriteCacheKey('抽奖券')).not.toBe(
      buildRewriteCacheKey('退款'),
    );
  });

  it('清理模型输出', () => {
    expect(sanitizeRewrite('"how to get lucky draw tickets"', '抽奖券')).toBe(
      'how to get lucky draw tickets',
    );
    expect(sanitizeRewrite('first line\nexplanation', '抽奖券')).toBe(
      'first line',
    );
    expect(sanitizeRewrite('抽奖券', '抽奖券')).toBeNull();
    expect(sanitizeRewrite('   ', '抽奖券')).toBeNull();
  });
});

describe('QueryRewriteService', () => {
  it('纯英文问句不改写、不调用模型', async () => {
    const runModel = jest.fn();
    const service = new QueryRewriteService(llmConfig, undefined, {
      runModel,
    });
    await expect(service.rewrite('How to get coupons')).resolves.toBeNull();
    expect(runModel).not.toHaveBeenCalled();
  });

  it('中文问句改写并写缓存', async () => {
    const redis = fakeRedis();
    const runModel = jest.fn(async () => 'how to get lucky draw tickets');
    const service = new QueryRewriteService(llmConfig, redis, { runModel });

    await expect(service.rewrite('抽奖券怎么获得')).resolves.toBe(
      'how to get lucky draw tickets',
    );
    expect(redis.set).toHaveBeenCalledTimes(1);
    expect(redis.set.mock.calls[0][0]).toContain('rag:rewrite:');
  });

  it('缓存命中不再调用模型', async () => {
    const key = buildRewriteCacheKey('抽奖券怎么获得');
    const redis = fakeRedis({ [key]: 'how to get lucky draw tickets' });
    const runModel = jest.fn();
    const service = new QueryRewriteService(llmConfig, redis, { runModel });

    await expect(service.rewrite('抽奖券怎么获得')).resolves.toBe(
      'how to get lucky draw tickets',
    );
    expect(runModel).not.toHaveBeenCalled();
  });

  it('模型失败时返回 null，不抛异常', async () => {
    const runModel = jest.fn(async () => {
      throw new Error('boom');
    });
    const service = new QueryRewriteService(llmConfig, undefined, {
      runModel,
    });
    await expect(service.rewrite('抽奖券怎么获得')).resolves.toBeNull();
  });

  it('模型返回原句时视为改写失败', async () => {
    const runModel = jest.fn(async () => '抽奖券怎么获得');
    const service = new QueryRewriteService(llmConfig, undefined, {
      runModel,
    });
    await expect(service.rewrite('抽奖券怎么获得')).resolves.toBeNull();
  });
});
