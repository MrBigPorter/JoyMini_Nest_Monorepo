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
