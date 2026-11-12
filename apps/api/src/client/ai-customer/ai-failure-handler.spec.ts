import { SocketEvents } from '@lucky/shared';
import { degradeToHuman, AI_FAILURE_REPLY } from './ai-failure-handler';

/**
 * N-15 回归 —— 模型/链路挂了，用户不能只是"什么都收不到"
 *
 * 修复前 handleStreamError 只做两件事：记日志 + 发 AI_ERROR。
 * 用户在屏幕上什么也看不到，会话仍停在 AI 处理态（handlerId 还是 null），
 * 于是下一条消息会再次进来、再次失败 —— 同一处故障无限重放。
 *
 * 现在降级动作集中在 `degradeToHuman`，必须同时完成四件事：
 *   ① 落一条静态兜底话术（不能依赖已经挂了的 LLM 去生成道歉）
 *   ② 把会话置为 awaiting_human（阻断下一轮）
 *   ③ 发 AI_TRANSFER（端上切人工态）
 *   ④ 记 transfer{source:'fallback', reason:'ai_error'}（否则统计里是黑洞）
 * 并且锁住失败隔离：①② 失败都不能吞掉 ③。
 */

jest.mock('./ai-reply-publisher', () => ({
  publishAiReply: jest.fn(async () => {}),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { publishAiReply } = require('./ai-reply-publisher');

function makeDeps() {
  const prisma = {
    conversation: { update: jest.fn(async () => ({ id: 'conv-1' })) },
  };
  const gateway = { dispatchToConversation: jest.fn() };
  const logger = { warn: jest.fn() };
  return { prisma, gateway, logger };
}

describe('degradeToHuman · 模型故障降级（N-15）', () => {
  let stdoutSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    // emitStage 会往 stdout 写一行 JSON，用例里静音并收集
    stdoutSpy = jest
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true);
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
  });

  it('落兜底话术 + 置人工态 + 发 AI_TRANSFER', async () => {
    const { prisma, gateway, logger } = makeDeps();
    const memberIds = ['user-1', 'bot-1'];

    await degradeToHuman(
      { prisma: prisma as any, gateway: gateway as any, logger },
      { conversationId: 'conv-1', userId: 'user-1', memberIds },
    );

    // ① 兜底话术走和正常回复同一条链路（落库 + 双通道广播）
    expect(publishAiReply).toHaveBeenCalledTimes(1);
    const args = (publishAiReply as jest.Mock).mock.calls[0];
    expect(args[2]).toBe('conv-1');
    expect(args[3]).toEqual([{ type: 'ai', content: AI_FAILURE_REPLY }]);
    expect(args[4]).toBe('user-1');
    expect(args[5]).toBe(memberIds);

    // ② 置 awaiting_human，阻断下一轮
    expect(prisma.conversation.update).toHaveBeenCalledWith({
      where: { id: 'conv-1' },
      data: {
        handlerId: 'awaiting_human',
        handlerAssignedAt: expect.any(Date),
      },
    });

    // ③ 端上切人工态
    expect(gateway.dispatchToConversation).toHaveBeenCalledWith(
      'conv-1',
      memberIds,
      SocketEvents.AI_TRANSFER,
      { conversationId: 'conv-1', reason: 'ai_error' },
    );
  });

  it('记一条 transfer 事件（source=fallback），供按原因统计', async () => {
    const { prisma, gateway, logger } = makeDeps();

    await degradeToHuman(
      { prisma: prisma as any, gateway: gateway as any, logger },
      { conversationId: 'conv-1', userId: 'user-1' },
    );

    const events = (stdoutSpy.mock.calls as any[][])
      .map((c) => String(c[0]))
      .filter((line) => line.trim().startsWith('{'))
      .map((line) => JSON.parse(line));

    expect(events.find((e) => e.stage === 'transfer')).toMatchObject({
      source: 'fallback',
      reason: 'ai_error',
    });
  });

  it('落库失败不能吞掉转人工事件（承诺 vs 装饰）', async () => {
    const { prisma, gateway, logger } = makeDeps();
    prisma.conversation.update.mockRejectedValueOnce(new Error('db down'));

    await degradeToHuman(
      { prisma: prisma as any, gateway: gateway as any, logger },
      { conversationId: 'conv-1', userId: 'user-1', memberIds: ['user-1'] },
    );

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('mark awaiting_human failed'),
    );
    // 承诺仍然兑现
    expect(gateway.dispatchToConversation).toHaveBeenCalledWith(
      'conv-1',
      ['user-1'],
      SocketEvents.AI_TRANSFER,
      { conversationId: 'conv-1', reason: 'ai_error' },
    );
  });

  it('兜底话术落库失败也不影响置人工态和转人工事件', async () => {
    const { prisma, gateway, logger } = makeDeps();
    (publishAiReply as jest.Mock).mockRejectedValueOnce(new Error('write failed'));

    await degradeToHuman(
      { prisma: prisma as any, gateway: gateway as any, logger },
      { conversationId: 'conv-1', userId: 'user-1', memberIds: ['user-1'] },
    );

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('persist failure reply failed'),
    );
    expect(prisma.conversation.update).toHaveBeenCalledTimes(1);
    expect(gateway.dispatchToConversation).toHaveBeenCalledWith(
      'conv-1',
      ['user-1'],
      SocketEvents.AI_TRANSFER,
      { conversationId: 'conv-1', reason: 'ai_error' },
    );
  });

  it('成员列表为空时，至少推给提问者本人', async () => {
    const { prisma, gateway, logger } = makeDeps();

    await degradeToHuman(
      { prisma: prisma as any, gateway: gateway as any, logger },
      { conversationId: 'conv-1', userId: 'user-1' },
    );

    expect(gateway.dispatchToConversation).toHaveBeenCalledWith(
      'conv-1',
      ['user-1'],
      SocketEvents.AI_TRANSFER,
      { conversationId: 'conv-1', reason: 'ai_error' },
    );
  });
});
