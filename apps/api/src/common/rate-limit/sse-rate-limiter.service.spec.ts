import { SseRateLimiterService } from './sse-rate-limiter.service';

/**
 * trust-boundary 4.1 — 令牌桶入口限流语义
 *
 * `tryAcquireLight` 是 HTTP POST /chat 与 Socket AI 触发共用的入口限流：
 * 每秒补 1 个令牌、桶容量 6，所以同一主体在 1 秒内第 7 次触发会被拒绝。
 *
 * 用内存 fake 实现 Redis Lua 的令牌桶语义，验证「阈值之后拒绝」这一条，
 * 不依赖真实 Redis。
 */
function createFakeRedis() {
  const buckets = new Map<string, { t: number; l: number }>();

  return {
    eval: jest.fn(async (_script: string, keys: string[], args: string[]) => {
      const key = keys[0];
      const rate = Number(args[0]);
      const burst = Number(args[1]);
      const now = Number(args[2]);

      const existing = buckets.get(key);
      let tokens = existing ? existing.t : burst;
      const last = existing ? existing.l : now;

      // 与 Lua 一致：按经过的整秒补充，再判断是否够 1 个
      tokens = Math.min(burst, tokens + (now - last) * rate);
      if (tokens < 1) {
        buckets.set(key, { t: tokens, l: now });
        return 0;
      }

      buckets.set(key, { t: tokens - 1, l: now });
      return 1;
    }),
  };
}

describe('SseRateLimiterService · 入口令牌桶', () => {
  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('同一主体连续触发：前 6 次放行，第 7 次被拒绝', async () => {
    const limiter = new SseRateLimiterService(createFakeRedis() as any);

    const results = [];
    for (let i = 0; i < 7; i += 1) {
      results.push(await limiter.tryAcquireLight('u1'));
    }

    expect(results.slice(0, 6).every((r) => r.ok)).toBe(true);
    expect(results[6]).toEqual({
      ok: false,
      reason: 'too many requests, please try again later',
    });
  });

  it('不同主体各自独立计数，互不牵连', async () => {
    const limiter = new SseRateLimiterService(createFakeRedis() as any);

    for (let i = 0; i < 6; i += 1) {
      await limiter.tryAcquireLight('u1');
    }
    expect((await limiter.tryAcquireLight('u1')).ok).toBe(false);
    // u1 用光预算不影响 u2
    expect((await limiter.tryAcquireLight('u2')).ok).toBe(true);
  });

  it('等待 1 秒后补充 1 个令牌，可再触发一次', async () => {
    const limiter = new SseRateLimiterService(createFakeRedis() as any);

    for (let i = 0; i < 6; i += 1) {
      await limiter.tryAcquireLight('u1');
    }
    expect((await limiter.tryAcquireLight('u1')).ok).toBe(false);

    jest.spyOn(Date, 'now').mockReturnValue(1_700_000_001_000);
    expect((await limiter.tryAcquireLight('u1')).ok).toBe(true);
    expect((await limiter.tryAcquireLight('u1')).ok).toBe(false);
  });
});
