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

  describe('consume：一次性 + 归属校验', () => {
    it('token 属于别人时返回 null', async () => {
      redis.getDel.mockResolvedValue(payload('other'));

      expect(await service.consume('t1', 'u1')).toBeNull();
      expect(redis.getDel).toHaveBeenCalledWith('ai:confirm:t1');
    });
  });
});
