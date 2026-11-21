import { renderMetrics, resetMetricsForTest } from '@api/common/metrics/metrics';
import { EventsGateway, ADMIN_ONLINE_ROOM } from '@api/common/events/events.gateway';
import { HandoffPresenceService } from './handoff-presence.service';

// ==================================================================
//  Task 2：在线客服 presence
//
//  转人工入口（Task 3）需要先知道「现在有没有客服在线」：
//   - 有 → 进排队 awaiting_human
//   - 没有 → 走离线留言分支
//
//  这里锁住两件事：
//   1. 计数口径：只数 admin_online 房间里的连接
//   2. 失败语义：adapter 异常时按 HANDOFF_PRESENCE_FAIL_OPEN 决定
//      放行（默认 true）或拒绝，并递增失败计数
// ==================================================================

type FakeSocket = {
  id: string;
  data: Record<string, unknown>;
  rooms: Set<string>;
  joined: string[];
  handshake: { query: Record<string, string>; auth: Record<string, string> };
  join(room: string): Promise<void>;
  leave(room: string): Promise<void>;
  emit(event: string, payload: unknown): void;
};

function createFakeSocket(
  opts: { id?: string; token?: string } = {},
): FakeSocket {
  const socket: FakeSocket = {
    id: opts.id ?? 'sock-1',
    data: {},
    rooms: new Set<string>(),
    joined: [],
    handshake: { query: {}, auth: opts.token ? { token: opts.token } : {} },
    async join(room: string) {
      socket.joined.push(room);
      socket.rooms.add(room);
    },
    async leave(room: string) {
      socket.rooms.delete(room);
    },
    emit: jest.fn(),
  };
  return socket;
}

describe('EventsGateway.countOnlineAgents', () => {
  function createGatewayWithServer(
    fetchSockets: jest.Mock,
  ): EventsGateway {
    // 依赖不会在计数路径上被调用，只需可注入
    const gateway = new EventsGateway(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      { get: jest.fn() } as any,
      {} as any,
      {} as any,
    );
    gateway.server = {
      in: jest.fn().mockReturnValue({ fetchSockets }),
    };
    return gateway;
  }

  it('只数 admin_online 房间里的连接', async () => {
    const fetchSockets = jest.fn().mockResolvedValue([{}, {}]);
    const gateway = createGatewayWithServer(fetchSockets);

    await expect(gateway.countOnlineAgents()).resolves.toBe(2);
    expect(gateway.server.in).toHaveBeenCalledWith(ADMIN_ONLINE_ROOM);
  });

  it('房间为空时返回 0', async () => {
    const gateway = createGatewayWithServer(jest.fn().mockResolvedValue([]));

    await expect(gateway.countOnlineAgents()).resolves.toBe(0);
  });
});

describe('EventsGateway.handleConnection admin 房间', () => {
  function createGateway(verify: jest.Mock): EventsGateway {
    return new EventsGateway(
      { verify } as any,
      {} as any,
      { get: jest.fn().mockResolvedValue(null) } as any, // pending_call 查询
      {} as any,
      { get: jest.fn() } as any,
      {} as any,
      {} as any,
    );
  }

  it('admin 连接加入 admin_online 房间（disconnect 由 socket.io 自动离房）', async () => {
    const gateway = createGateway(
      jest.fn().mockReturnValue({ sub: 'admin-1', type: 'admin' }),
    );
    const socket = createFakeSocket({ id: 'sock-admin', token: 'admin-token' });

    await gateway.handleConnection(socket as any);

    expect(socket.joined).toContain(ADMIN_ONLINE_ROOM);
    expect(socket.joined).toContain('user_admin-1');
  });

  it('普通用户连接不加入 admin_online 房间', async () => {
    const gateway = createGateway(
      jest.fn().mockReturnValue({ sub: 'user-1' }), // 没有 type='admin'
    );
    const socket = createFakeSocket({ id: 'sock-user', token: 'user-token' });

    await gateway.handleConnection(socket as any);

    expect(socket.joined).toContain('user_user-1');
    expect(socket.joined).not.toContain(ADMIN_ONLINE_ROOM);
  });
});

describe('HandoffPresenceService.isAnyAgentOnline', () => {
  function createService(
    countOnlineAgents: jest.Mock,
    config: Record<string, unknown> = {},
  ): HandoffPresenceService {
    const configService = {
      get: jest.fn((key: string) => config[key]),
    };
    return new HandoffPresenceService(
      { countOnlineAgents } as any,
      configService as any,
    );
  }

  beforeEach(() => {
    resetMetricsForTest();
  });

  it('adapter 正常时按 admin_online 房间计数', async () => {
    const service = createService(jest.fn().mockResolvedValue(2));

    await expect(service.isAnyAgentOnline()).resolves.toEqual({
      online: true,
      degraded: false,
      count: 2,
    });
    expect(renderMetrics()).toContain('handoff_presence_check_failed_total 0');
  });

  it('没有客服在线：online=false，且不算降级', async () => {
    const service = createService(jest.fn().mockResolvedValue(0));

    await expect(service.isAnyAgentOnline()).resolves.toEqual({
      online: false,
      degraded: false,
      count: 0,
    });
  });

  it('adapter 异常且 fail-open=true（默认）：online=true, degraded=true，并计数', async () => {
    const service = createService(
      jest.fn().mockRejectedValue(new Error('redis adapter down')),
    );

    await expect(service.isAnyAgentOnline()).resolves.toEqual({
      online: true,
      degraded: true,
      count: 0,
    });
    expect(renderMetrics()).toContain('handoff_presence_check_failed_total 1');
  });

  it('adapter 异常且 fail-open=false：online=false, degraded=true，并计数', async () => {
    const service = createService(
      jest.fn().mockRejectedValue(new Error('redis adapter down')),
      { HANDOFF_PRESENCE_FAIL_OPEN: 'false' },
    );

    await expect(service.isAnyAgentOnline()).resolves.toEqual({
      online: false,
      degraded: true,
      count: 0,
    });
    expect(renderMetrics()).toContain('handoff_presence_check_failed_total 1');
  });
});
