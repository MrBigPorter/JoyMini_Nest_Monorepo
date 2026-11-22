import { NotFoundException } from '@nestjs/common';
import { AiCustomerService } from './ai-customer.service';

jest.mock('uuid', () => ({ v4: jest.fn(() => 'test-token') }));
jest.mock('meilisearch', () => ({ Meilisearch: class {} }));

function makeService() {
  const unused = () => ({}) as any;
  const prisma = {
    conversation: {
      findUnique: jest.fn(async () => ({
        type: 'SUPPORT',
        status: 1,
        handlerId: null,
        threadId: 't1',
        aiMetadata: null,
      })),
    },
    chatMessage: { create: jest.fn() },
  };
  const usage = {
    assertWithinQuota: jest.fn(async () => undefined),
    assertWithinSessionQuota: jest.fn(async () => undefined),
  };
  const service = new AiCustomerService(
    unused(), // ConfigService
    unused(), // ToolRegistryService
    unused(), // AiService
    prisma as any,
    unused(), // RagRetrievalService
    unused(), // PromptResolverService
    unused(), // MeilisearchService
    unused(), // AiMemoryService
    { dispatchToUser: jest.fn(), dispatchToConversation: jest.fn() } as any,
    unused(), // AiActionConfirmService
    usage as any, // AiUsageService
    unused(), // ClientWalletService
    unused(), // ClientCouponService
    unused(), // LuckyDrawService
    unused(), // AddressService
    unused(), // OtpService
    unused(), // RedisService
    unused(), // EventEmitter2
    unused(), // AiFeedbackService
    unused(), // FlowStateVersioningService
    unused(), // AiConversationDebugService
  );
  return { service, prisma, usage };
}

describe('chatStream · 成员校验失败', () => {
  it('非成员会话：不写 trace、不落消息、直接收尾', async () => {
    const { service, prisma, usage } = makeService();
    // 测试只验证 prepareThread 之前的门禁；给一个占位图通过入参校验。
    (service as any).compiledGraph = {};
    jest
      .spyOn(service as any, 'prepareThread')
      .mockRejectedValue(new NotFoundException('not a member'));
    const recordError = jest
      .spyOn(service as any, 'recordErrorTrace')
      .mockResolvedValue(undefined);
    const onDone = jest.fn();
    const onError = jest.fn();

    await service.chatStream(
      'hi',
      'attacker',
      'session-1',
      {
        onToken: jest.fn(),
        onStep: jest.fn(),
        onDone,
        onError,
      },
      'conv-victim',
    );

    expect(onDone).toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(recordError).not.toHaveBeenCalled();
    expect(prisma.chatMessage.create).not.toHaveBeenCalled();
    // 成员校验必须先于配额：否则配额分支会用攻击者传入的 conversationId 写消息。
    expect(usage.assertWithinQuota).not.toHaveBeenCalled();
    expect(usage.assertWithinSessionQuota).not.toHaveBeenCalled();
  });
});
