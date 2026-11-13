import { EventsGateway } from './events.gateway';

/**
 * 投递语义的回归测试（#87 N-9）
 *
 * 背景：AI 回复以前只发会话房间，客户端的 join_chat 一旦丢失（断线重连不重放），
 * 用户就一条都收不到。现在改为"会话房间 + 成员私有房间"双通道。
 *
 * 这里锁住两件事：
 *   1. 成员私有房间确实补发了
 *   2. 已经在会话房间的连接不会被重复投递（.except(conversationId)）
 */

type Emission = {
  room: string;
  except?: string;
  event?: string;
  payload?: any;
};

function createFakeServer() {
  const emissions: Emission[] = [];
  const server = {
    adapter: { rooms: new Map<string, Set<string>>() },
    to(room: string) {
      return {
        emit(event: string, payload: any) {
          emissions.push({ room, event, payload });
        },
        except(excluded: string) {
          return {
            emit(event: string, payload: any) {
              emissions.push({ room, except: excluded, event, payload });
            },
          };
        },
      };
    },
  };
  return { server, emissions };
}

function createGateway() {
  // 依赖只被构造函数保存，不会在这条路径上调用
  const gateway = new EventsGateway(
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );
  const { server, emissions } = createFakeServer();
  gateway.server = server;
  return { gateway, emissions };
}

describe('EventsGateway.dispatchToConversation', () => {
  it('既发会话房间，也给每个成员私有房间补发', () => {
    const { gateway, emissions } = createGateway();

    gateway.dispatchToConversation('conv-1', ['u1', 'u2'], 'chat_message', {
      id: 'm1',
    });

    // 1 条会话房间 + 2 条私有房间
    expect(emissions).toHaveLength(3);
    expect(emissions[0]).toMatchObject({ room: 'conv-1' });
    expect(emissions[1]).toMatchObject({ room: 'user_u1', except: 'conv-1' });
    expect(emissions[2]).toMatchObject({ room: 'user_u2', except: 'conv-1' });

    for (const e of emissions) {
      expect(e.payload).toMatchObject({
        type: 'chat_message',
        data: { id: 'm1' },
      });
    }
  });

  it('已在会话房间的连接不会重复收到（except 会话房间）', () => {
    const { gateway, emissions } = createGateway();

    gateway.dispatchToConversation('conv-1', ['u1'], 'ai_token', {
      content: 'x',
    });

    const privateEmits = emissions.filter((e) => e.room === 'user_u1');
    expect(privateEmits).toHaveLength(1);
    // 关键：必须排除会话房间，否则同一 socket 会收两遍同一条消息
    expect(privateEmits[0].except).toBe('conv-1');
  });

  it('成员列表为空时退化为只发会话房间（旧行为，不炸）', () => {
    const { gateway, emissions } = createGateway();

    gateway.dispatchToConversation('conv-1', [], 'ai_done', { ok: true });

    expect(emissions).toHaveLength(1);
    expect(emissions[0].room).toBe('conv-1');
  });

  it('过滤掉空的 userId，不生成 user_ 空房间', () => {
    const { gateway, emissions } = createGateway();

    gateway.dispatchToConversation('conv-1', ['', 'u1'], 'ai_done', {});

    const rooms = emissions.map((e) => e.room);
    expect(rooms).toEqual(['conv-1', 'user_u1']);
  });
});

// ==================================================================
//  #85 P0-1 / T1-4：join_chat 越权
//
//  修复前：任何人（甚至不登录）发一条 join_chat + 别人的 conversationId
//          就能进房间，从此收到该会话的所有实时消息。
//  修复后：进房间前必须查 chat_member 表，不是成员一律拒绝。
// ==================================================================

type FakeSocket = {
  id: string;
  data: Record<string, unknown>;
  rooms: Set<string>;
  joined: string[];
  join(room: string): Promise<void>;
};

// 返回 any：真实的 Socket 有 70+ 个属性，测试里只需要它用到的 4 个。
// FakeSocket 类型仅作文档，说明我们到底伪造了什么。
function createFakeSocket(userId: string | null, id = 'sock-1'): any {
  const socket: FakeSocket = {
    id,
    data: userId ? { userId } : {},
    rooms: new Set<string>(),
    joined: [],
    async join(room: string) {
      socket.joined.push(room);
      socket.rooms.add(room);
    },
  };
  return socket;
}

function createGatewayWithPrisma() {
  const prisma = {
    chatMember: {
      findUnique: jest.fn(),
    },
    $transaction: jest.fn(),
  };
  const gateway = new EventsGateway(
    {} as any, // jwtService：连接阶段才用，join_chat 不走
    prisma as any, // prismaService：这次的主角
    {} as any, // redisService
    {} as any, // eventEmitter
  );
  const { server } = createFakeServer();
  gateway.server = server;
  return { gateway, prisma };
}

describe('EventsGateway.handleJoinChat 成员校验（T1-4）', () => {
  it('成员可以进房间', async () => {
    const { gateway, prisma } = createGatewayWithPrisma();
    prisma.chatMember.findUnique.mockResolvedValue({ id: 'member-1' });
    const socket = createFakeSocket('u-xiaohong');

    const result = await gateway.handleJoinChat(socket, {
      conversationId: 'conv-1',
    });

    expect(socket.joined).toEqual(['conv-1']);
    expect(result).toEqual({ status: 'joined', conversationId: 'conv-1' });
  });

  it('已登录但不是成员 → 拒绝，且绝不 join', async () => {
    const { gateway, prisma } = createGatewayWithPrisma();
    // 数据库里查不到这条成员记录
    prisma.chatMember.findUnique.mockResolvedValue(null);
    const socket = createFakeSocket('u-attacker');

    const result = await gateway.handleJoinChat(socket, {
      conversationId: 'conv-xiaohong',
    });

    // 关键断言：没有进房间
    expect(socket.joined).toEqual([]);
    expect(result).toMatchObject({ status: 'forbidden' });
  });

  it('匿名连接（无 userId）→ 拒绝，且不查数据库', async () => {
    const { gateway, prisma } = createGatewayWithPrisma();
    const socket = createFakeSocket(null);

    const result = await gateway.handleJoinChat(socket, {
      conversationId: 'conv-xiaohong',
    });

    expect(socket.joined).toEqual([]);
    expect(result).toMatchObject({ status: 'forbidden' });
    // 没有身份就没必要查库：省一次 DB 往返，也避免被刷
    expect(prisma.chatMember.findUnique).not.toHaveBeenCalled();
  });
});

// ==================================================================
//  #85 P0-1 / T1-4：send_message 越权
//
//  修复前：登录用户对着别人的 conversationId 发消息，
//          消息会写进对方会话、推送给对方成员，还会触发 AI 处理。
//  修复后：进事务之前查成员表，不是成员一律拒绝。
// ==================================================================

const sendPayload = {
  conversationId: 'conv-xiaohong',
  content: '我是一条越权消息',
  type: 0,
  tempId: 'tmp-1',
};

describe('EventsGateway.handleSendMessage 成员校验（T1-4）', () => {
  it('非成员 → 拒绝，且连数据库事务都不开', async () => {
    const { gateway, prisma } = createGatewayWithPrisma();
    prisma.chatMember.findUnique.mockResolvedValue(null);
    const socket = createFakeSocket('u-attacker');

    const result = await gateway.handleSendMessage(socket, sendPayload);

    expect(result).toMatchObject({ error: 'Forbidden' });
    // 关键断言：消息根本没机会被写进去
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('匿名连接 → 拒绝，且不查库、不开事务', async () => {
    const { gateway, prisma } = createGatewayWithPrisma();
    const socket = createFakeSocket(null);

    const result = await gateway.handleSendMessage(socket, sendPayload);

    expect(result).toMatchObject({ error: 'Unauthorized' });
    expect(prisma.chatMember.findUnique).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('缺少 conversationId → 拒绝，不开事务', async () => {
    const { gateway, prisma } = createGatewayWithPrisma();
    const socket = createFakeSocket('u-xiaohong');

    const result = await gateway.handleSendMessage(socket, {
      ...sendPayload,
      conversationId: undefined as any,
    });

    expect(result).toMatchObject({ error: 'Invalid payload' });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('成员 → 放行，事务被调用（用拒绝哨兵证明已进入写入路径）', async () => {
    const { gateway, prisma } = createGatewayWithPrisma();
    prisma.chatMember.findUnique.mockResolvedValue({ id: 'member-1' });
    prisma.$transaction.mockRejectedValue(new Error('__reached_tx__'));
    const socket = createFakeSocket('u-xiaohong');

    const result = await gateway.handleSendMessage(socket, sendPayload);

    // 事务被调用 = 门禁放行了；后面失败是 mock 不完整，不影响本断言
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ status: 'error' });
  });
});
