import {
  DEFAULT_PREFETCH_WAIT_MS,
  awaitWithTimeout,
  readPrefetchWaitMs,
} from './await-with-timeout';

describe('readPrefetchWaitMs · 预取等待上限', () => {
  it('未设置时用默认值', () => {
    expect(readPrefetchWaitMs(undefined)).toBe(DEFAULT_PREFETCH_WAIT_MS);
  });

  it.each(['', '  ', 'abc', '0', '-5', '2.5'])(
    '非法值 %s 回落默认',
    (raw) => {
      expect(readPrefetchWaitMs(raw)).toBe(DEFAULT_PREFETCH_WAIT_MS);
    },
  );

  it('合法毫秒数生效', () => {
    expect(readPrefetchWaitMs(' 800 ')).toBe(800);
  });
});

describe('awaitWithTimeout · 有界等待', () => {
  it('按时完成：返回结果，不标记超时', async () => {
    const result = await awaitWithTimeout(Promise.resolve(['a']), 50, []);
    expect(result).toEqual({ value: ['a'], timedOut: false });
  });

  it('超时：立刻回落，不等待未决 promise', async () => {
    const never = new Promise<string[]>(() => undefined);
    const started = Date.now();
    const result = await awaitWithTimeout(never, 20, []);
    expect(result).toEqual({ value: [], timedOut: true });
    expect(Date.now() - started).toBeLessThan(500);
  });

  it('原 promise 拒绝不会被吞成未处理的 rejection', async () => {
    const failing = Promise.reject(new Error('boom')).catch(() => []);
    const result = await awaitWithTimeout(failing, 50, []);
    expect(result.timedOut).toBe(false);
    expect(result.value).toEqual([]);
  });
});
