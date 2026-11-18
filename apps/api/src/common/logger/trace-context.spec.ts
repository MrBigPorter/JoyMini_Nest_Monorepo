import {
  getRequestUserId,
  getTraceId,
  runWithContext,
  runWithTrace,
} from './trace-context';

/**
 * trace-context 单测
 *
 * 锁住四个行为，防止以后"优化"时把并发隔离弄丢：
 *   1. 范围内能读到自己的 traceId
 *   2. 嵌套时内层覆盖、外层恢复
 *   3. 多个并发调用互不串号
 *   4. 无上下文 / 空 ID 时返回 undefined，不抛错
 */
describe('trace-context', () => {
  it('在 runWithTrace 内能读到 traceId，结束后恢复 undefined', async () => {
    expect(getTraceId()).toBeUndefined();

    const inside = await runWithTrace('trace-1', async () => {
      // 即使跨了 await，上下文依然在
      await Promise.resolve();
      return getTraceId();
    });

    expect(inside).toBe('trace-1');
    expect(getTraceId()).toBeUndefined();
  });

  it('嵌套时内层用新 ID，退出后外层恢复', async () => {
    await runWithTrace('outer', async () => {
      expect(getTraceId()).toBe('outer');

      await runWithTrace('inner', async () => {
        await Promise.resolve();
        expect(getTraceId()).toBe('inner');
      });

      // 内层结束，外层工牌还在
      expect(getTraceId()).toBe('outer');
    });
  });

  it('5 个并发调用各自隔离，不串号', async () => {
    const ids = ['t-1', 't-2', 't-3', 't-4', 't-5'];

    const results = await Promise.all(
      ids.map((id) =>
        runWithTrace(
          id,
          () =>
            new Promise<string | undefined>((resolve) => {
              // 故意错开完成时间，放大并发交错的机会
              setTimeout(() => resolve(getTraceId()), Math.random() * 15);
            }),
        ),
      ),
    );

    expect(results).toEqual(ids);
  });

  it('无上下文 / 空 ID / 纯空白时返回 undefined，且照常执行 fn', async () => {
    expect(getTraceId()).toBeUndefined();

    await runWithTrace(undefined, async () => {
      expect(getTraceId()).toBeUndefined();
    });

    await runWithTrace('', async () => {
      expect(getTraceId()).toBeUndefined();
    });

    await runWithTrace('   ', async () => {
      expect(getTraceId()).toBeUndefined();
    });
  });

  it('traceId 首尾空白会被裁剪', async () => {
    await runWithTrace('  trace-x  ', async () => {
      expect(getTraceId()).toBe('trace-x');
    });
  });

  it('runWithContext 能绑定 userId，退出后恢复 undefined', async () => {
    expect(getRequestUserId()).toBeUndefined();

    const inside = await runWithContext({ userId: 'user-1' }, async () => {
      await Promise.resolve();
      return getRequestUserId();
    });

    expect(inside).toBe('user-1');
    expect(getRequestUserId()).toBeUndefined();
  });

  it('嵌套时合并字段：内层覆盖 traceId，但保留外层 userId', async () => {
    await runWithContext({ traceId: 'outer', userId: 'user-1' }, async () => {
      await runWithTrace('inner', async () => {
        expect(getTraceId()).toBe('inner');
        expect(getRequestUserId()).toBe('user-1');
      });

      expect(getTraceId()).toBe('outer');
      expect(getRequestUserId()).toBe('user-1');
    });
  });

  it('并发请求的 userId 互相隔离', async () => {
    const users = ['u-1', 'u-2', 'u-3', 'u-4', 'u-5'];

    const results = await Promise.all(
      users.map((userId) =>
        runWithContext(
          { userId },
          () =>
            new Promise<string | undefined>((resolve) => {
              setTimeout(() => resolve(getRequestUserId()), Math.random() * 15);
            }),
        ),
      ),
    );

    expect(results).toEqual(users);
  });

  it('空 userId 不会覆盖外层身份', async () => {
    await runWithContext({ userId: 'user-1' }, async () => {
      await runWithContext({ userId: '   ' }, async () => {
        expect(getRequestUserId()).toBe('user-1');
      });
    });
  });
});
