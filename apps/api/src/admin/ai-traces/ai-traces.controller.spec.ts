import { AiTracesController } from './ai-traces.controller';

function createController() {
  const traces = {
    list: jest.fn().mockResolvedValue({
      list: [
        {
          id: 'trace-1',
          input: '用户问题',
          output: 'AI 回答',
          intent: 'order',
        },
      ],
      total: 1,
      page: 1,
      pageSize: 20,
    }),
    get: jest.fn().mockResolvedValue({
      id: 'trace-1',
      input: '用户问题',
      output: 'AI 回答',
      spans: [
        {
          type: 'llm',
          input: { prompt: 'p' },
          output: { text: 'a' },
          error: 'boom',
        },
      ],
      scores: [],
    }),
  };
  return { traces, controller: new AiTracesController(traces as any) };
}

describe('AiTracesController VIEWER 脱敏', () => {
  it('列表：VIEWER 只拿链路元信息', async () => {
    const { controller } = createController();

    const result: any = await controller.list({}, 'VIEWER');

    expect(result.list[0]).toEqual({
      id: 'trace-1',
      input: null,
      output: null,
      intent: 'order',
    });
    expect(result.total).toBe(1);
  });

  it('列表：ADMIN 保留原始内容', async () => {
    const { controller } = createController();

    const result: any = await controller.list({}, 'ADMIN');

    expect(result.list[0].input).toBe('用户问题');
    expect(result.list[0].output).toBe('AI 回答');
  });

  it('详情：VIEWER 的 input/output 与 span 内容全部置空', async () => {
    const { controller } = createController();

    const result: any = await controller.get('trace-1', 'VIEWER');

    expect(result.input).toBeNull();
    expect(result.output).toBeNull();
    expect(result.spans[0]).toEqual({
      type: 'llm',
      input: null,
      output: null,
      error: null,
    });
    expect(result.id).toBe('trace-1');
  });

  it('详情：ADMIN 保留 span 原文', async () => {
    const { controller } = createController();

    const result: any = await controller.get('trace-1', 'ADMIN');

    expect(result.spans[0].input).toEqual({ prompt: 'p' });
    expect(result.spans[0].output).toEqual({ text: 'a' });
    expect(result.spans[0].error).toBe('boom');
  });
});
