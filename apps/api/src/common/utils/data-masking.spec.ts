import { redactSensitiveFields } from './data-masking';

describe('redactSensitiveFields', () => {
  it('VIEWER 的单对象字段置空', () => {
    const data = { id: 't1', input: 'hello', output: 'world', intent: 'order' };

    redactSensitiveFields(data, 'VIEWER', ['input', 'output']);

    expect(data).toEqual({
      id: 't1',
      input: null,
      output: null,
      intent: 'order',
    });
  });

  it('小写 viewer 也会脱敏', () => {
    const data = { input: 'hello' };

    redactSensitiveFields(data, 'viewer', ['input']);

    expect(data.input).toBeNull();
  });

  it('非 VIEWER 角色原样返回', () => {
    const data = { input: 'hello' };

    redactSensitiveFields(data, 'ADMIN', ['input']);
    redactSensitiveFields(data, 'EDITOR', ['input']);
    redactSensitiveFields(data, undefined, ['input']);

    expect(data.input).toBe('hello');
  });

  it('分页 list 内字段置空，外层字段保留', () => {
    const data = {
      list: [
        { id: 'a', input: 'q1', answer: 'a1' },
        { id: 'b', input: 'q2', answer: 'a2' },
      ],
      total: 2,
      page: 1,
      pageSize: 20,
    };

    redactSensitiveFields(data, 'VIEWER', ['list.input', 'list.answer']);

    expect(data.list).toEqual([
      { id: 'a', input: null, answer: null },
      { id: 'b', input: null, answer: null },
    ]);
    expect(data.total).toBe(2);
  });

  it('嵌套数组 spans 内的字段置空', () => {
    const data = {
      id: 't1',
      input: 'q',
      spans: [
        { type: 'rag', input: { query: 'q' }, output: { docs: 2 } },
        { type: 'llm', input: { prompt: 'p' }, output: { text: 'a' } },
      ],
    };

    redactSensitiveFields(data, 'VIEWER', [
      'input',
      'spans.input',
      'spans.output',
    ]);

    expect(data.input).toBeNull();
    expect(data.spans).toEqual([
      { type: 'rag', input: null, output: null },
      { type: 'llm', input: null, output: null },
    ]);
  });

  it('items 路径支持 SLA 队列结构', () => {
    const data = {
      thresholdMinutes: 5,
      items: [
        { conversationId: 'c1', lastMessage: 'hi', waitingSeconds: 10 },
      ],
    };

    redactSensitiveFields(data, 'VIEWER', ['items.lastMessage']);

    expect(data.items[0]).toEqual({
      conversationId: 'c1',
      lastMessage: null,
      waitingSeconds: 10,
    });
    expect(data.thresholdMinutes).toBe(5);
  });

  it('缺失字段不会被补成 null', () => {
    const data = { id: 't1' };

    redactSensitiveFields(data, 'VIEWER', ['input']);

    expect(data).toEqual({ id: 't1' });
    expect('input' in data).toBe(false);
  });

  it('空路径或空数据直接返回', () => {
    const data = { input: 'hello' };

    expect(redactSensitiveFields(data, 'VIEWER', [])).toBe(data);
    expect(redactSensitiveFields(null, 'VIEWER', ['input'])).toBeNull();
    expect(redactSensitiveFields(data, 'VIEWER', ['missing.deep'])).toEqual(
      data,
    );
  });
});
