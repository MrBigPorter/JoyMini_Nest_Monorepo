import { runWithTrace } from './trace-context';
import { emitStage } from './structured-logger';

/**
 * structured-logger 单测
 *
 * 锁住四类行为：
 *   1. 输出是单行合法 JSON，固定字段齐全
 *   2. traceId 来自异步上下文；无上下文时降级为 "-"
 *   3. 禁止字段（用户内容 / 凭据 / PII）不会出现在输出里
 *   4. 异常输入（循环引用、Error）不抛错
 */
describe('structured-logger', () => {
  let spy: jest.SpyInstance;
  let lines: string[];

  beforeEach(() => {
    lines = [];
    spy = jest
      .spyOn(process.stdout, 'write')
      .mockImplementation(((chunk: unknown) => {
        lines.push(String(chunk));
        return true;
      }) as any);
  });

  afterEach(() => {
    spy.mockRestore();
  });

  /** 取最后一行并解析，顺便断言是单行 JSON */
  const lastEvent = () => {
    expect(lines).toHaveLength(1);
    const raw = lines[0];
    expect(raw.endsWith('\n')).toBe(true);
    expect(raw.trim().split('\n')).toHaveLength(1);
    return JSON.parse(raw.trim());
  };

  it('输出固定字段和业务字段', () => {
    emitStage('intent', {
      intent: 'order',
      labels: [{ label: 'order', score: 0.87 }],
      latencyMs: 182,
    });

    const event = lastEvent();

    expect(event.stage).toBe('intent');
    expect(event.level).toBe('info');
    expect(event.app).toBe('api');
    expect(event.traceId).toBe('-');
    expect(typeof event.ts).toBe('string');
    expect(Number.isNaN(Date.parse(event.ts))).toBe(false);
    expect(event.intent).toBe('order');
    expect(event.latencyMs).toBe(182);
    expect(event.labels).toEqual([{ label: 'order', score: 0.87 }]);
  });

  it('traceId 来自 runWithTrace 上下文', async () => {
    await runWithTrace('trace-abc', async () => {
      emitStage('chat.start', { messageLength: 12 });
    });

    expect(lastEvent().traceId).toBe('trace-abc');
  });

  it('丢弃用户内容、凭据和 PII 字段', () => {
    emitStage('chat.error', {
      errorName: 'TimeoutError',
      errorMessage: 'upstream timeout',
      message: '用户输入的原文',
      content: 'AI 回答原文',
      password: 'p@ssw0rd',
      accessToken: 'secret-token',
      phone: '13800000000',
      email: 'a@b.com',
      address: '某市某路 1 号',
    });

    const event = lastEvent();

    expect(event.errorName).toBe('TimeoutError');
    expect(event.errorMessage).toBe('upstream timeout');

    for (const key of [
      'message',
      'content',
      'password',
      'accessToken',
      'phone',
      'email',
      'address',
    ]) {
      expect(event).not.toHaveProperty(key);
    }

    // 序列化后的整行也不能包含原文
    expect(lines[0]).not.toContain('用户输入的原文');
    expect(lines[0]).not.toContain('p@ssw0rd');
  });

  it('Error 转成 name/message，bigint 转字符串，函数/undefined 丢弃', () => {
    emitStage('chat.error', {
      err: new TypeError('boom'),
      count: 10n,
      noop: () => undefined,
      missing: undefined,
    });

    const event = lastEvent();

    expect(event.err).toEqual({ name: 'TypeError', message: 'boom' });
    expect(event.count).toBe('10');
    expect(event).not.toHaveProperty('noop');
    expect(event).not.toHaveProperty('missing');
  });

  it('循环引用不抛错，输出降级行', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    expect(() =>
      emitStage('retrieval', { layers: circular }),
    ).not.toThrow();

    const event = lastEvent();
    expect(event.stage).toBe('logger.error');
    expect(event.reason).toBe('serialize_failed');
    expect(event.originalStage).toBe('retrieval');
  });

  it('支持指定 level', () => {
    emitStage('chat.error', { errorName: 'X' }, 'error');
    expect(lastEvent().level).toBe('error');
  });

  it('固定字段不可被业务字段覆盖（traceId / stage 以框架为准）', () => {
    emitStage('intent', {
      traceId: '伪造的-trace',
      stage: '伪造的-stage',
      level: 'error',
    });

    const event = lastEvent();
    expect(event.traceId).toBe('-');
    expect(event.stage).toBe('intent');
    expect(event.level).toBe('info');
  });
});
