import { AiMessageListener } from './ai-message.listener';
import { AiCancelRequestedEvent } from '@api/common/chat/events/chat.events';

// 依赖链里的 AiCustomerService 会加载纯 ESM 包，Jest（CJS）默认不转译 node_modules。
// 本套用例不触达这些模块，只需它们能"加载成功"。
jest.mock('uuid', () => ({ v4: jest.fn(() => 'test-token') }));
jest.mock('meilisearch', () => ({ Meilisearch: class {} }));

/**
 * 同会话单飞（single-flight）回归
 *
 * 生产路径：ChatService → AI_MESSAGE_REQUESTED → listener → chatStream。
 * 同一会话连发两条会并发跑两个 LangGraph，导致回复乱序、成本翻倍。
 * 这里锁死三条行为：
 *   1) 同会话：串行（最大并发=1，保序）
 *   2) 不同会话：可并发（不存在全局串行）
 *   3) 抢锁失败：有界等待后明确 warn 放弃，不崩、不静默
 */

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** 让已排队的微任务/定时器跑一轮。 */
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

function makeListener(
  chatStream: jest.Mock,
  runWithLock: jest.Mock = jest.fn((_k, _t, cb) => cb()),
  redis: { get: jest.Mock; set: jest.Mock } = {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(undefined),
  },
) {
  const service = { chatStream };
  const lock = { runWithLock };
  const feedback = {
    recordRepeatedQuestionIfAny: jest.fn().mockResolvedValue(undefined),
    recordImplicit: jest.fn().mockResolvedValue(undefined),
  };
  return {
    listener: new AiMessageListener(
      service as any,
      lock as any,
      redis as any,
      feedback as any,
    ),
    lock,
    redis,
    feedback,
  };
}

const event = (conversationId: string, content = 'hi', userId = 'u1') => ({
  conversationId,
  content,
  userId,
});

describe('AiMessageListener · 同会话单飞', () => {
  it('同会话两个事件并发：第二个等第一个完成，最大并发=1 且保序', async () => {
    const gates = [deferred(), deferred()];
    const started: number[] = [];
    let call = 0;
    let active = 0;
    let maxActive = 0;

    const chatStream = jest.fn(() => {
      const idx = call++;
      started.push(idx);
      active += 1;
      maxActive = Math.max(maxActive, active);
      return gates[idx].promise.finally(() => {
        active -= 1;
      });
    });
    const { listener } = makeListener(chatStream);

    const p1 = listener.handleAiMessageRequest(event('c1', 'a'));
    const p2 = listener.handleAiMessageRequest(event('c1', 'b'));

    await flush();
    // 第一条在跑，第二条还没启动
    expect(chatStream).toHaveBeenCalledTimes(1);
    expect(maxActive).toBe(1);

    // 放行第一条 → 第二条才被调度
    gates[0].resolve();
    await p1;
    await flush();
    expect(chatStream).toHaveBeenCalledTimes(2);
    expect(active).toBe(1);

    gates[1].resolve();
    await p2;

    expect(started).toEqual([0, 1]); // 调用顺序稳定
    expect(maxActive).toBe(1); // 全程未并发
  });

  it('不同会话两个事件：可同时处于 pending（不全局串行）', async () => {
    const gates = [deferred(), deferred()];
    let call = 0;
    let active = 0;
    let maxActive = 0;

    const chatStream = jest.fn(() => {
      const gate = gates[call++];
      active += 1;
      maxActive = Math.max(maxActive, active);
      return gate.promise.finally(() => {
        active -= 1;
      });
    });
    const { listener, lock } = makeListener(chatStream);

    const pa = listener.handleAiMessageRequest(event('convA'));
    const pb = listener.handleAiMessageRequest(event('convB'));

    await flush();
    // 两个会话各自的锁 key 不同，两个调用都已启动且都在等自己的 gate
    expect(chatStream).toHaveBeenCalledTimes(2);
    expect(active).toBe(2);
    expect(maxActive).toBe(2);
    // 锁 key 按会话区分
    const keys = lock.runWithLock.mock.calls.map((c) => c[0]);
    expect(keys).toEqual(['ai:conv:convA', 'ai:conv:convB']);

    gates[0].resolve();
    gates[1].resolve();
    await Promise.all([pa, pb]);
  });

  it('抢锁失败（被占用）：有界等待后记 warn 放弃，不崩、不执行', async () => {
    const chatStream = jest.fn();
    const runWithLock = jest.fn().mockResolvedValue(undefined); // 永远抢不到
    const { listener } = makeListener(chatStream, runWithLock);

    // 缩短等待窗口，避免测试真的空等 30s
    (listener as any).lockMaxWaitMs = 15;
    (listener as any).lockRetryDelayMs = 1;
    const warn = jest
      .spyOn((listener as any).logger, 'warn')
      .mockImplementation(() => undefined);

    await expect(
      listener.handleAiMessageRequest(event('busy')),
    ).resolves.toBeUndefined();

    expect(chatStream).not.toHaveBeenCalled();
    expect(runWithLock).toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('reason=lock_timeout'),
    );
  });

  it('前一任务失败不阻塞同会话后续任务（队尾静音）', async () => {
    let call = 0;
    const chatStream = jest.fn(() => {
      call += 1;
      return call === 1
        ? Promise.reject(new Error('graph boom'))
        : Promise.resolve();
    });
    const { listener } = makeListener(chatStream);
    jest
      .spyOn((listener as any).logger, 'error')
      .mockImplementation(() => undefined);

    await listener.handleAiMessageRequest(event('c1', 'first'));
    await listener.handleAiMessageRequest(event('c1', 'second'));

    expect(chatStream).toHaveBeenCalledTimes(2);
  });
});

// ==================================================================
//  取消信号（reliable-ai-runtime 4.x）
//
//  客户端断开且房间空了 → 网关发 AI_CANCEL_REQUESTED → listener abort。
//  chatStream 的 callbacks.signal 必须真实透传，取消才有效。
// ==================================================================

describe('AiMessageListener · 取消信号', () => {
  it('把 AbortSignal 透传给 chatStream，收到取消事件后置为 aborted', async () => {
    const gate = deferred();
    let callbacks: { signal?: AbortSignal } | undefined;
    const chatStream = jest.fn((_msg, _uid, _tid, cbs) => {
      callbacks = cbs;
      return gate.promise;
    });
    const { listener } = makeListener(chatStream);

    const running = listener.handleAiMessageRequest(event('c1'));
    await flush();

    expect(callbacks?.signal).toBeInstanceOf(AbortSignal);
    expect(callbacks?.signal?.aborted).toBe(false);

    listener.handleCancel(
      new AiCancelRequestedEvent('c1', 'client_disconnected'),
    );

    expect(callbacks?.signal?.aborted).toBe(true);

    gate.resolve();
    await running;
  });

  it('没有进行中的任务时取消事件是 no-op（不抛错）', () => {
    const { listener } = makeListener(jest.fn());
    expect(() =>
      listener.handleCancel(
        new AiCancelRequestedEvent('missing', 'client_left'),
      ),
    ).not.toThrow();
  });

  it('同一会话第二轮拿到新的 controller，上一轮的取消不会误伤', async () => {
    const first = deferred();
    const second = deferred();
    const signals: AbortSignal[] = [];
    let call = 0;
    const chatStream = jest.fn((_msg, _uid, _tid, cbs) => {
      signals.push(cbs.signal);
      return call++ === 0 ? first.promise : second.promise;
    });
    const { listener } = makeListener(chatStream);

    const p1 = listener.handleAiMessageRequest(event('c1', 'one'));
    await flush();
    listener.handleCancel(new AiCancelRequestedEvent('c1', 'client_left'));
    first.resolve();
    await p1;

    // 第二轮开始后，第一轮的取消事件已经过去
    const p2 = listener.handleAiMessageRequest(event('c1', 'two'));
    await flush();

    expect(signals).toHaveLength(2);
    expect(signals[1]).not.toBe(signals[0]);
    expect(signals[1].aborted).toBe(false);

    second.resolve();
    await p2;
  });
});

// ==================================================================
//  幂等（reliable-ai-runtime 2.3）
//
//  队列是 at-least-once：同一条消息可能被投递两次。
//  处理成功打 Redis 标记；失败不打，保证重试还能跑。
// ==================================================================

describe('AiMessageListener · 消息幂等', () => {
  it('已成功处理过的 messageId 再次投递 → 跳过', async () => {
    const chatStream = jest.fn().mockResolvedValue(undefined);
    const redis = {
      get: jest.fn().mockResolvedValue('1'),
      set: jest.fn(),
    };
    const { listener } = makeListener(chatStream, undefined, redis);

    await listener.handleAiMessageRequest({
      conversationId: 'c1',
      content: 'hi',
      userId: 'u1',
      messageId: 'm1',
    });

    expect(chatStream).not.toHaveBeenCalled();
    expect(redis.get).toHaveBeenCalledWith('ai:msg:done:m1');
  });

  it('首次处理成功后写入 done 标记（TTL 1h）', async () => {
    const chatStream = jest.fn().mockResolvedValue(undefined);
    const redis = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
    };
    const { listener } = makeListener(chatStream, undefined, redis);

    await listener.handleAiMessageRequest({
      conversationId: 'c1',
      content: 'hi',
      userId: 'u1',
      messageId: 'm1',
    });

    expect(chatStream).toHaveBeenCalledTimes(1);
    expect(redis.set).toHaveBeenCalledWith('ai:msg:done:m1', '1', 60 * 60);
  });

  it('处理失败不写 done 标记 → 队列重试仍会执行', async () => {
    const chatStream = jest
      .fn()
      .mockRejectedValueOnce(new Error('graph boom'))
      .mockResolvedValueOnce(undefined);
    const redis = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
    };
    const { listener } = makeListener(chatStream, undefined, redis);
    jest
      .spyOn((listener as any).logger, 'error')
      .mockImplementation(() => undefined);

    await listener.handleAiMessageRequest({
      conversationId: 'c1',
      content: 'hi',
      userId: 'u1',
      messageId: 'm2',
    });
    expect(redis.set).not.toHaveBeenCalled();

    await listener.handleAiMessageRequest({
      conversationId: 'c1',
      content: 'hi',
      userId: 'u1',
      messageId: 'm2',
    });
    expect(chatStream).toHaveBeenCalledTimes(2);
  });

  it('没有 messageId 的旧调用方保持原行为（不去重）', async () => {
    const chatStream = jest.fn().mockResolvedValue(undefined);
    const { listener, redis } = makeListener(chatStream);

    await listener.handleAiMessageRequest(event('c1'));
    await listener.handleAiMessageRequest(event('c1'));

    expect(chatStream).toHaveBeenCalledTimes(2);
    expect(redis.get).not.toHaveBeenCalled();
  });
});
