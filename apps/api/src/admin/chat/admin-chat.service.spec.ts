import { ConflictException, NotFoundException } from '@nestjs/common';

// 依赖链里的模块 import uuid（纯 ESM），Jest CJS 加载不了；本套用例用不到真 uuid
jest.mock('uuid', () => ({ v4: jest.fn(() => 'test-uuid') }));

import { AdminChatService } from './admin-chat.service';

// ==================================================================
//  #98 S1：admin 认领接口的错误翻译（T2-5）
//
//  AdminChatService.claimConversation 不做判定，只做「三选一 → HTTP」：
//    claimed    → 200 { success, conversationId, handlerId }
//    conflict   → 409 会话还在，但已经被人接了
//    not_found  → 404 会话根本不存在
//
//  判定逻辑本身在 SupportHandlerService.claim 的 CAS 里，
//  已在 support-handler.service.spec.ts 覆盖，这里不重复测。
// ==================================================================

function createService(claimResult: any) {
  const prisma = { conversation: { findMany: jest.fn(), count: jest.fn() } };
  const supportHandler = { claim: jest.fn().mockResolvedValue(claimResult) };
  const service = new AdminChatService(
    prisma as any,
    {} as any,
    {} as any,
    {} as any,
    supportHandler as any,
  );
  return { service, prisma, supportHandler };
}

describe('AdminChatService.claimConversation 认领结果翻译（T2-5）', () => {
  it('claimed → 返回 success + 真实 handlerId', async () => {
    const { service, supportHandler } = createService({
      status: 'claimed',
      handlerId: 'admin-7',
    });

    const result = await service.claimConversation('conv-1', 'admin-7');

    expect(result).toEqual({
      success: true,
      conversationId: 'conv-1',
      handlerId: 'admin-7',
    });
    // 身份必须原样来自调用方传入的 adminId（它来自 JWT），不能是别的东西
    expect(supportHandler.claim).toHaveBeenCalledWith('conv-1', 'admin-7');
  });

  it('conflict → 409（会话存在，但已被别人接走）', async () => {
    const { service } = createService({ status: 'conflict' });

    await expect(service.claimConversation('conv-1', 'admin-2')).rejects.toThrow(
      ConflictException,
    );
  });

  it('not_found → 404（会话不存在，不该让前端以为是"被抢了"）', async () => {
    const { service } = createService({ status: 'not_found' });

    await expect(
      service.claimConversation('conv-missing', 'admin-2'),
    ).rejects.toThrow(NotFoundException);
  });

  it('翻译层不碰库：判定完全交给 SupportHandlerService', async () => {
    const { service, prisma } = createService({
      status: 'claimed',
      handlerId: 'admin-7',
    });

    await service.claimConversation('conv-1', 'admin-7');

    expect(prisma.conversation.findMany).not.toHaveBeenCalled();
    expect(prisma.conversation.count).not.toHaveBeenCalled();
  });
});
