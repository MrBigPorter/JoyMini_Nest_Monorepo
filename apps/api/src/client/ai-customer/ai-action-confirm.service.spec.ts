import { AiActionConfirmService } from './ai-action-confirm.service';

// uuid 新版是纯 ESM，Jest（CJS）加载不了；这里只需要一个稳定的假 token
jest.mock('uuid', () => ({ v4: jest.fn(() => 'test-token') }));

/**
 * T1-2 确认链路回归（洞 1 / 洞 2）
 *
 * 洞 2（两张票 TTL 不一致）：卡片 60s 是对的；待办单必须 ≥ OTP 有效期（300s），
 *   否则用户看短信慢一点，任务就作废，而码还能用 4 分钟。
 * 洞 1（先撕票）：peek 必须只读不删，pop 才删；
 *   顺序错了，用户输错一次码任务就永久丢失。
 */
function makeRedis() {
  return {
    get: jest.fn(),
    getDel: jest.fn(),
    set: jest.fn(),
    eval: jest.fn(),
  };
}

function payload(userId = 'u1') {
  return JSON.stringify({
    action: 'withdraw',
    params: { amount: 500, channelId: 2 },
    summary: {},
    userId,
  });
}

describe('AiActionConfirmService · 确认凭证', () => {
  let redis: ReturnType<typeof makeRedis>;
  let service: AiActionConfirmService;

  beforeEach(() => {
    redis = makeRedis();
    service = new AiActionConfirmService(redis as any);
    jest.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
  });

  afterEach(() => jest.restoreAllMocks());

  describe('洞 2：两张票的有效期分开', () => {
    it('卡片凭证 60s', async () => {
      const { token, expiresAt } = await service.generate(
        'u1',
        'withdraw',
        { amount: 500 },
        {},
      );

      const [key, raw, ttl] = redis.set.mock.calls[0];
      expect(key).toBe(`ai:confirm:${token}`);
      expect(ttl).toBe(60);
      expect(expiresAt).toBe(1_700_000_000_000 + 60_000);
      expect(JSON.parse(raw).userId).toBe('u1');
    });

    it('待办单 ≥ OTP 有效期，不是 60s', async () => {
      await service.stagePendingExecution('u1', {
        action: 'withdraw',
        params: {},
        summary: {},
        userId: 'u1',
      });

      const [key, , ttl] = redis.set.mock.calls[0];
      const otpTtl = Number(process.env.OTP_TTL_SECONDS) || 300;
      expect(key).toBe('ai:confirm:pending:u1');
      expect(ttl).toBe(otpTtl + 30);
      expect(ttl).toBeGreaterThanOrEqual(300);
    });
  });

  describe('洞 1：peek 只看不删，pop 才删', () => {
    it('peek 用 get，且从不调用 getDel', async () => {
      redis.get.mockResolvedValue(payload());

      const result = await service.peekPendingExecution('u1');

      expect(redis.get).toHaveBeenCalledWith('ai:confirm:pending:u1');
      expect(redis.getDel).not.toHaveBeenCalled();
      expect(result?.params.amount).toBe(500);
    });

    it('peek 拿不到时返回 null（不抛错）', async () => {
      redis.get.mockResolvedValue(null);
      expect(await service.peekPendingExecution('u1')).toBeNull();
    });

    it('pop 用 getDel（原子读删），且不调用 get', async () => {
      redis.getDel.mockResolvedValue(payload());

      await service.popPendingExecution('u1');

      expect(redis.getDel).toHaveBeenCalledWith('ai:confirm:pending:u1');
      expect(redis.get).not.toHaveBeenCalled();
    });
  });

  describe('consume：原子「校验 owner + 删除」', () => {
    /**
     * 模拟 CONSUME_IF_OWNER_LUA 的语义：
     *   key 不存在 → null；userId 不匹配 → null 且保留；匹配 → 删除并返回 raw。
     * 真实 Redis 中 GET/比较/DEL 是单线程原子执行的，这里用内存 Map 复刻。
     */
    let store: Map<string, string>;
    const installLua = () => {
      store = new Map();
      redis.eval.mockImplementation(
        async (_script: string, keys: string[], args: string[]) => {
          const key = keys[0];
          const raw = store.get(key);
          if (raw == null) return null;
          const parsed = JSON.parse(raw);
          if (parsed.userId !== args[0]) return null;
          store.delete(key);
          return raw;
        },
      );
    };

    it('错 owner 返回 null，且不删除 token（真主人仍可消费）', async () => {
      installLua();
      store.set('ai:confirm:t1', payload('owner'));

      expect(await service.consume('t1', 'intruder')).toBeNull();

      expect(redis.eval).toHaveBeenCalledWith(
        expect.any(String),
        ['ai:confirm:t1'],
        ['intruder'],
      );
      expect(store.has('ai:confirm:t1')).toBe(true);
    });

    it('正确 owner 只能消费一次，第二次返回 null', async () => {
      installLua();
      store.set('ai:confirm:t1', payload('u1'));

      const first = await service.consume('t1', 'u1');
      const second = await service.consume('t1', 'u1');

      expect(first?.params.amount).toBe(500);
      expect(second).toBeNull();
      expect(store.has('ai:confirm:t1')).toBe(false);
    });

    it('并发消费时只有一个成功', async () => {
      installLua();
      store.set('ai:confirm:t1', payload('u1'));

      const [a, b] = await Promise.all([
        service.consume('t1', 'u1'),
        service.consume('t1', 'u1'),
      ]);

      const succeeded = [a, b].filter((r) => r !== null);
      expect(succeeded).toHaveLength(1);
      expect(store.has('ai:confirm:t1')).toBe(false);
    });

    it('token 不存在或已过期时返回 null', async () => {
      installLua();

      expect(await service.consume('missing', 'u1')).toBeNull();
    });
  });
});
