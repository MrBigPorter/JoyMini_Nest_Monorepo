import { AiMessageListener } from './ai-message.listener';

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
) {
  const service = { chatStream };
  const lock = { runWithLock };
  return {
    listener: new AiMessageListener(service as any, lock as any),
    lock,
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
