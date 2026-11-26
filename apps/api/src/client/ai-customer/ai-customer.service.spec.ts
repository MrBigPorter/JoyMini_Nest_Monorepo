import { BadRequestException } from '@nestjs/common';
import { AiCustomerService } from './ai-customer.service';
import { LlmUsageCollector } from '@api/common/ai/usage-collector';

// 服务依赖链里有模块 import uuid（纯 ESM），Jest CJS 加载不了；本套用例用不到真 uuid
jest.mock('uuid', () => ({ v4: jest.fn(() => 'test-token') }));
// meilisearch 客户端同样是纯 ESM；本套用例不触达检索，只要模块能加载
jest.mock('meilisearch', () => ({ Meilisearch: class {} }));

/**
 * T1-2 确认链路回归（洞 1 / 洞 3）
 *
 * 洞 1：verify 失败时不能 pop —— 否则用户输错一次码，待办单永久丢失。
 * 洞 3：params 必须走 class-validator；手搓 DTO 不执行装饰器，
 *   amount="abc" / amount=50 会一路流到 applyWithdrawVerified（NaN 比较全 false）。
 */
function makeService() {
  const prisma = {
    user: { findUnique: jest.fn(async () => ({ phone: '13800000000' })) },
    aiActionRequest: {
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
  };
  const confirm = {
    peekPendingExecution: jest.fn(),
    popPendingExecution: jest.fn(),
  };
  const usage = {
    assertWithinQuota: jest.fn(async () => undefined),
    assertWithinSessionQuota: jest.fn(async () => undefined),
    recordUsage: jest.fn(async () => undefined),
    recordSessionUsage: jest.fn(async () => undefined),
  };
  const wallet = {
    applyWithdrawVerified: jest.fn(async () => ({ withdrawId: 'w-1' })),
  };
  const otp = {
    verify: jest.fn(async () => true),
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
    unused(), // EventsGateway
    confirm as any, // AiActionConfirmService
    usage as any, // AiUsageService
    wallet as any, // ClientWalletService
    unused(), // ClientCouponService
    unused(), // LuckyDrawService
    unused(), // AddressService
    otp as any, // OtpService
    unused(), // RedisService
    unused(), // EventEmitter2
    unused(), // AiFeedbackService
    unused(), // FlowStateVersioningService
    unused(), // AiConversationDebugService
  );

  return { service, prisma, confirm, wallet, otp, usage };
}

function pending(params: Record<string, any> = {}) {
  return {
    action: 'withdraw',
    params: {
      amount: 500,
      channelId: 2,
      account: '6222',
      accountName: '张三',
      ...params,
    },
    summary: {},
    userId: 'u1',
    requestId: 'act-1',
  };
}

describe('confirmWithdrawOtp · 确认链路（T1-2）', () => {
  it('没有待办单：直接 400，不验码也不执行', async () => {
    const { service, confirm, wallet, otp } = makeService();
    confirm.peekPendingExecution.mockResolvedValue(null);

    await expect(service.confirmWithdrawOtp('123456', 'u1')).rejects.toThrow(
      BadRequestException,
    );
    expect(otp.verify).not.toHaveBeenCalled();
    expect(confirm.popPendingExecution).not.toHaveBeenCalled();
    expect(wallet.applyWithdrawVerified).not.toHaveBeenCalled();
  });

  it('洞 1：验码失败时，待办单不能被删除', async () => {
    const { service, confirm, wallet, otp } = makeService();
    confirm.peekPendingExecution.mockResolvedValue(pending());
    otp.verify.mockResolvedValue(false);

    await expect(service.confirmWithdrawOtp('000000', 'u1')).rejects.toThrow(
      'Invalid OTP code',
    );
    expect(confirm.popPendingExecution).not.toHaveBeenCalled();
    expect(wallet.applyWithdrawVerified).not.toHaveBeenCalled();
  });

  it('顺序：peek 在 verify 之前，pop 在 verify 之后', async () => {
    const { service, confirm, otp } = makeService();
    confirm.peekPendingExecution.mockResolvedValue(pending());
    confirm.popPendingExecution.mockResolvedValue(pending());

    await service.confirmWithdrawOtp('123456', 'u1');

    const peekAt = confirm.peekPendingExecution.mock.invocationCallOrder[0];
    const verifyAt = otp.verify.mock.invocationCallOrder[0];
    const popAt = confirm.popPendingExecution.mock.invocationCallOrder[0];
    expect(peekAt).toBeLessThan(verifyAt);
    expect(verifyAt).toBeLessThan(popAt);
  });

  it('验码通过：用 pop 取回的值执行提现', async () => {
    const { service, confirm, wallet, prisma } = makeService();
    confirm.peekPendingExecution.mockResolvedValue(pending());
    confirm.popPendingExecution.mockResolvedValue(pending());

    await service.confirmWithdrawOtp('123456', 'u1');

    expect(prisma.user.findUnique).toHaveBeenCalled();
    expect(confirm.peekPendingExecution).toHaveBeenCalledWith('u1');
    expect(confirm.popPendingExecution).toHaveBeenCalledWith('u1');
    expect(wallet.applyWithdrawVerified).toHaveBeenCalledWith(
      'u1',
      expect.objectContaining({
        amount: 500,
        channelId: 2,
        account: '6222',
        accountName: '张三',
      }),
    );
    // 只执行一次：确认端点不再重复调用公开入口/重复验码
    expect(wallet.applyWithdrawVerified).toHaveBeenCalledTimes(1);
  });

  it('验证码通过后待办单被并发取走：中止，不执行', async () => {
    const { service, confirm, wallet } = makeService();
    confirm.peekPendingExecution.mockResolvedValue(pending());
    confirm.popPendingExecution.mockResolvedValue(null);

    await expect(service.confirmWithdrawOtp('123456', 'u1')).rejects.toThrow(
      'Pending withdraw action expired',
    );
    expect(wallet.applyWithdrawVerified).not.toHaveBeenCalled();
  });

  it('洞 3：amount 不是数字 → 400，不进业务层', async () => {
    const { service, confirm, wallet } = makeService();
    const bad = pending({ amount: 'abc' });
    confirm.peekPendingExecution.mockResolvedValue(bad);
    confirm.popPendingExecution.mockResolvedValue(bad);

    await expect(service.confirmWithdrawOtp('123456', 'u1')).rejects.toThrow(
      'Invalid withdraw parameters',
    );
    expect(wallet.applyWithdrawVerified).not.toHaveBeenCalled();
  });

  it('洞 3：amount 低于 @Min(100) → 400', async () => {
    const { service, confirm, wallet } = makeService();
    const bad = pending({ amount: 50 });
    confirm.peekPendingExecution.mockResolvedValue(bad);
    confirm.popPendingExecution.mockResolvedValue(bad);

    await expect(service.confirmWithdrawOtp('123456', 'u1')).rejects.toThrow(
      'Minimum withdrawal amount is 100',
    );
    expect(wallet.applyWithdrawVerified).not.toHaveBeenCalled();
  });

  it('洞 3：多余字段 → 400（forbidNonWhitelisted）', async () => {
    const { service, confirm, wallet } = makeService();
    const bad = pending({ note: 'LLM 夹带的字段' });
    confirm.peekPendingExecution.mockResolvedValue(bad);
    confirm.popPendingExecution.mockResolvedValue(bad);

    await expect(service.confirmWithdrawOtp('123456', 'u1')).rejects.toThrow(
      'Invalid withdraw parameters',
    );
    expect(wallet.applyWithdrawVerified).not.toHaveBeenCalled();
  });
});

/**
 * 评测用量采集（eval-ingestion-hardening D5 / task 5.1）
 *
 * testChat 是 LIVE 评测唯一的真实 AI 入口；采集器必须显式传入，
 * 不传时调用配置与返回值必须与改造前完全一致。
 */
describe('testChat · 用量采集器接线', () => {
  function makeGraph() {
    const invoke = jest.fn(async (..._args: unknown[]) => ({
      messages: [{ content: '应该走退款流程' }],
      intent: 'refund',
      ragSources: [],
      pendingConfirm: null,
    }));
    return { invoke };
  }

  it('不传采集器：invoke 配置里没有 callbacks，返回值不变', async () => {
    const { service } = makeService();
    const graph = makeGraph();
    (service as any).compiledGraph = graph;

    const result = await service.testChat('怎么退款', 'u1', false, 's1');

    expect(graph.invoke).toHaveBeenCalledTimes(1);
    const config = graph.invoke.mock.calls[0][1] as any;
    expect(config.configurable).toEqual({ thread_id: 's1' });
    expect(config.callbacks).toBeUndefined();
    expect(result).toMatchObject({
      intent: 'refund',
      agentOutput: '应该走退款流程',
      pendingConfirm: null,
    });
  });

  it('传采集器：作为回调挂到图调用上（一次挂载，不重复计数）', async () => {
    const { service } = makeService();
    const graph = makeGraph();
    (service as any).compiledGraph = graph;
    const collector = new LlmUsageCollector('chat');

    await service.testChat('怎么退款', 'u1', false, 's1', {
      usageCollector: collector,
    });

    const config = graph.invoke.mock.calls[0][1] as any;
    expect(config.callbacks).toEqual([collector]);
    expect(config.configurable).toEqual({ thread_id: 's1' });
  });
});
