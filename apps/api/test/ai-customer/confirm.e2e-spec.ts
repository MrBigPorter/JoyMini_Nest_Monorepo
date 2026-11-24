import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AiCustomerController } from '@api/client/ai-customer/ai-customer.controller';
import { AiCustomerService } from '@api/client/ai-customer/ai-customer.service';
import { AiActionConfirmService } from '@api/client/ai-customer/ai-action-confirm.service';
import { SseRateLimiterService } from '@api/common/rate-limit/sse-rate-limiter.service';
import { StreamReservationStore } from '@api/client/ai-customer/stream-reservation.store';
import { JwtAuthGuard } from '@api/common/jwt/jwt.guard';

jest.mock('uuid', () => ({ v4: jest.fn(() => 'e2e-confirm-token') }));
jest.mock('meilisearch', () => ({ Meilisearch: class {} }));

/**
 * 确认端点 HTTP 层 e2e（`ai-action-card-contract` 2.5）。
 *
 * 四类场景：领券成功、令牌过期、令牌重放、未知 action。
 * 使用真实 AiCustomerController + 真实 AiCustomerService.confirmAction +
 * 真实 AiActionConfirmService（Redis 用内存假实现，只复刻 consume 的
 * owner 校验 + 一次性删除语义），不依赖真实短信与外部服务。
 */

const USER_ID = 'e2e-user';

/** 只实现 consume 用到的 owner-check + 一次性删除语义。 */
function makeFakeRedis() {
  const store = new Map<string, string>();
  return {
    store,
    async set(key: string, value: string) {
      store.set(key, value);
      return 'OK';
    },
    async get(key: string) {
      return store.get(key) ?? null;
    },
    async getDel(key: string) {
      const value = store.get(key) ?? null;
      store.delete(key);
      return value;
    },
    async del(key: string) {
      store.delete(key);
      return 1;
    },
    async setNx(key: string, value: string) {
      if (store.has(key)) return false;
      store.set(key, value);
      return true;
    },
    async eval(_script: string, keys: string[], args: string[]) {
      const raw = store.get(keys[0]);
      if (!raw) return null;
      const decoded = JSON.parse(raw);
      if (decoded.userId !== args[0]) return null;
      store.delete(keys[0]);
      return raw;
    },
  };
}

function makeServiceEnv() {
  const redis = makeFakeRedis();
  const confirm = new AiActionConfirmService(redis as any);
  const prisma = {
    aiActionRequest: {
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    chatMessage: { create: jest.fn(), findFirst: jest.fn() },
    chatMember: { findMany: jest.fn(async () => []) },
    conversation: { update: jest.fn() },
  };
  const lifecycle = {
    markConfirmed: jest.fn(async () => undefined),
    markExecuted: jest.fn(async () => undefined),
    markFailed: jest.fn(async () => undefined),
    markCancelled: jest.fn(async () => undefined),
  };
  const gateway = {
    dispatchToUser: jest.fn(),
    dispatchToConversation: jest.fn(),
  };
  const coupon = {
    claimCoupon: jest.fn(async () => ({ id: 'uc-e2e', status: 0 })),
  };
  const unused = () => ({}) as any;

  const service = new AiCustomerService(
    unused(), // ConfigService
    unused(), // ToolRegistryService
    unused(), // AiService
    prisma as any, // PrismaService
    unused(), // RagRetrievalService
    unused(), // PromptResolverService
    unused(), // MeilisearchService
    unused(), // AiMemoryService
    gateway as any, // EventsGateway
    confirm, // AiActionConfirmService（真实）
    unused(), // AiUsageService
    unused(), // ClientWalletService
    coupon as any, // ClientCouponService
    unused(), // LuckyDrawService
    unused(), // AddressService
    unused(), // OtpService
    redis as any, // RedisService
    unused(), // EventEmitter2
    unused(), // AiFeedbackService
    unused(), // FlowStateVersioningService
    unused(), // AiConversationDebugService
    undefined, // TraceService
    lifecycle as any,
    undefined, // HandoffPresenceService
    unused(), // AiActionContextService
  );

  return { service, confirm, prisma, lifecycle, coupon, gateway };
}

describe('POST /ai/customer/confirm (e2e)', () => {
  let app: INestApplication;
  let env: ReturnType<typeof makeServiceEnv>;

  beforeEach(async () => {
    env = makeServiceEnv();
    // 本 spec 只验证确认端点；图谱初始化会拉真实模型配置，跳过。
    jest.spyOn(env.service, 'onModuleInit').mockResolvedValue(undefined);
    const moduleRef = await Test.createTestingModule({
      controllers: [AiCustomerController],
      providers: [
        { provide: AiCustomerService, useValue: env.service },
        { provide: SseRateLimiterService, useValue: {} },
        { provide: StreamReservationStore, useValue: {} },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (ctx: any) => {
          ctx.switchToHttp().getRequest().user = { userId: USER_ID };
          return true;
        },
      })
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  async function issueToken(
    action = 'claim_coupon',
    params: Record<string, any> = { couponId: 'coupon-1' },
  ) {
    const { token } = await env.confirm.generate(
      USER_ID,
      action,
      params,
      { action },
      'req-e2e',
    );
    return token;
  }

  it('领券成功：200 且返回领取结果', async () => {
    const token = await issueToken();

    const res = await request(app.getHttpServer())
      .post('/ai/customer/confirm')
      .send({ token })
      .expect(200);

    expect(res.body).toEqual({ id: 'uc-e2e', status: 0 });
    expect(env.coupon.claimCoupon).toHaveBeenCalledWith(USER_ID, 'coupon-1', 2);
    expect(env.lifecycle.markExecuted).toHaveBeenCalledWith('req-e2e', {
      id: 'uc-e2e',
      status: 0,
    });
  });

  it('令牌过期/不存在：400 且不执行', async () => {
    const res = await request(app.getHttpServer())
      .post('/ai/customer/confirm')
      .send({ token: 'never-issued' })
      .expect(400);

    expect(res.body.message).toBe('Confirm token invalid or expired');
    expect(env.coupon.claimCoupon).not.toHaveBeenCalled();
  });

  it('令牌重放：第二次 400 且只执行一次', async () => {
    const token = await issueToken();

    await request(app.getHttpServer())
      .post('/ai/customer/confirm')
      .send({ token })
      .expect(200);
    const replay = await request(app.getHttpServer())
      .post('/ai/customer/confirm')
      .send({ token })
      .expect(400);

    expect(replay.body.message).toBe('Confirm token invalid or expired');
    expect(env.coupon.claimCoupon).toHaveBeenCalledTimes(1);
  });

  it('未知 action：400、动作记录置失败且不执行', async () => {
    const token = await issueToken('not_in_catalog', {});

    const res = await request(app.getHttpServer())
      .post('/ai/customer/confirm')
      .send({ token })
      .expect(400);

    expect(res.body.message).toBe('Unknown confirm action: not_in_catalog');
    expect(env.lifecycle.markFailed).toHaveBeenCalledWith(
      'req-e2e',
      'Unknown confirm action: not_in_catalog',
    );
    expect(env.coupon.claimCoupon).not.toHaveBeenCalled();
  });
});
