import { EventsGateway } from './events.gateway';
import { CHAT_EVENTS } from '@api/common/chat/events/chat.events';

/**
 * trust-boundary 4.1 — Socket 触发 AI 的入口限流
 *
 * 生产路径：Socket `send_message` → 落库 → AI 触发（enqueue / in-process event）。
 * 限流只作用在 AI 触发点，普通人工/客服消息不受影响。
 *
 * 这里锁死三件事：
 *   1) 未超阈值 → 正常入队，模型调用路径不变
 *   2) 超阈值 → 不入队、不发事件（= 无模型调用），ack 返回结构化状态
 *   3) 人工处理中的会话 → 根本不检查限流
 */

function createFakeServer() {
  const emissions: Array<{ room: string; event?: string; payload?: any }> = [];
  const server = {
    adapter: { rooms: new Map<string, Set<string>>() },
    to(room: string) {
      return {
        emit(event: string, payload: any) {
          emissions.push({ room, event, payload });
        },
        except() {
          return {
            emit(event: string, payload: any) {
              emissions.push({ room, event, payload });
            },
          };
        },
      };
    },
  };
  return { server, emissions };
}

function createPrisma(conversation: {
  handlerId: string | null;
  type: 'AI' | 'SUPPORT' | 'DIRECT';
}) {
  const tx = {
    conversation: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      update: jest.fn().mockResolvedValue({}),
    },
    // 作为 tagged template 调用：tx.$queryRaw`SELECT ...`
    $queryRaw: jest.fn().mockResolvedValue([{ lastMsgSeqId: 1 }]),
    chatMessage: {
      create: jest.fn().mockResolvedValue({
        id: 'm1',
        conversationId: 'c1',
        senderId: 'u1',
        content: 'hello',
        type: 0,
        seqId: 1,
        clientTempId: 't1',
        createdAt: new Date('2026-01-01T00:00:00Z'),
        meta: null,
        sender: { nickname: 'Nick', avatar: 'avatar' },
      }),
    },
  };

  return {
    tx,
    prisma: {
      $transaction: jest.fn((cb: (t: typeof tx) => unknown) => cb(tx)),
      chatMember: {
        findUnique: jest.fn().mockResolvedValue({ id: 'mem1' }),
        findMany: jest
          .fn()
          .mockResolvedValue([{ userId: 'u1', isMuted: false }]),
      },
      conversation: {
        findUnique: jest.fn().mockResolvedValue({
          handlerId: conversation.handlerId,
          handlerAssignedAt: null,
          type: conversation.type,
        }),
        update: jest.fn().mockResolvedValue({}),
      },
    },
  };
}

function createGateway(options: {
  conversation: { handlerId: string | null; type: 'AI' | 'SUPPORT' | 'DIRECT' };
  rateLimit?: jest.Mock;
}) {
  const { prisma, tx } = createPrisma(options.conversation);
  const eventEmitter = { emit: jest.fn() };
  const aiQueue = { enqueue: jest.fn().mockResolvedValue(undefined) };
  const rateLimit =
    options.rateLimit ?? jest.fn().mockResolvedValue({ ok: true as const });

  const gateway = new EventsGateway(
    {} as any, // JwtService
    prisma as any,
    {} as any, // RedisService
    eventEmitter as any,
    { get: jest.fn().mockReturnValue(undefined) } as any,
    aiQueue as any,
    { tryAcquireLight: rateLimit } as any,
  );
  const { server } = createFakeServer();
  gateway.server = server as any;

  jest
    .spyOn((gateway as any).logger, 'warn')
    .mockImplementation(() => undefined);

  const client = { id: 'socket-1', data: { userId: 'u1' } } as any;
  const payload = {
    conversationId: 'c1',
    content: 'hello',
    type: 0,
    tempId: 't1',
  };

  return { gateway, client, payload, eventEmitter, aiQueue, rateLimit, tx };
}

const aiRequestedEmitted = (eventEmitter: { emit: jest.Mock }) =>
  eventEmitter.emit.mock.calls.some(
    (call) => call[0] === CHAT_EVENTS.AI_MESSAGE_REQUESTED,
  );

describe('EventsGateway · AI 触发入口限流 (trust 4.1)', () => {
  it('未超阈值：限流放行，消息入队（模型调用路径正常触发）', async () => {
    const { gateway, client, payload, aiQueue, rateLimit } = createGateway({
      conversation: { handlerId: null, type: 'AI' },
      rateLimit: jest.fn().mockResolvedValue({ ok: true }),
    });

    const ack = await gateway.handleSendMessage(client, payload);

    expect(rateLimit).toHaveBeenCalledWith('u1');
    expect(aiQueue.enqueue).toHaveBeenCalledWith({
      conversationId: 'c1',
      content: 'hello',
      userId: 'u1',
      messageId: 'm1',
    });
    expect(ack).toMatchObject({ status: 'ok', aiTriggered: true });
  });

  it('超过阈值：拒绝 AI 触发，不入队、不发事件（无模型调用），仍返回结构化状态', async () => {
    const { gateway, client, payload, aiQueue, eventEmitter, tx } =
      createGateway({
        conversation: { handlerId: null, type: 'AI' },
        rateLimit: jest
          .fn()
          .mockResolvedValue({ ok: false, reason: 'too many requests' }),
      });

    const ack = await gateway.handleSendMessage(client, payload);

    // 消息本身仍然落库（限流只针对 AI，不针对发消息）
    expect(tx.chatMessage.create).toHaveBeenCalledTimes(1);
    // 模型调用侧完全没被触发
    expect(aiQueue.enqueue).not.toHaveBeenCalled();
    expect(eventEmitter.emit).not.toHaveBeenCalledWith(
      CHAT_EVENTS.AI_MESSAGE_REQUESTED,
      expect.anything(),
    );
    expect(aiRequestedEmitted(eventEmitter)).toBe(false);
    // 结构化 ack + 结构化日志
    expect(ack).toMatchObject({ status: 'ok', aiTriggered: false });
    expect((gateway as any).logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('rate_limited'),
    );
  });

  it('人工/客服处理中的会话：不检查 AI 限流，也不入队', async () => {
    const { gateway, client, payload, aiQueue, rateLimit } = createGateway({
      conversation: { handlerId: 'admin-1', type: 'SUPPORT' },
    });

    await gateway.handleSendMessage(client, payload);

    expect(rateLimit).not.toHaveBeenCalled();
    expect(aiQueue.enqueue).not.toHaveBeenCalled();
  });

  it('限流器异常：fail-open，不阻塞消息与 AI 触发', async () => {
    const { gateway, client, payload, aiQueue } = createGateway({
      conversation: { handlerId: null, type: 'AI' },
      rateLimit: jest.fn().mockRejectedValue(new Error('redis down')),
    });

    const ack = await gateway.handleSendMessage(client, payload);

    expect(aiQueue.enqueue).toHaveBeenCalledTimes(1);
    expect(ack).toMatchObject({ status: 'ok', aiTriggered: true });
  });
});
