import { runAgentLoop } from './agent-runner';

function makeLogger() {
  return {
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };
}

describe('runAgentLoop 写操作截停（trust 2.4）', () => {
  it('createAddress / updateAddress 未确认时只记录 pendingToolCall，不调用 service', async () => {
    const createInvoke = jest.fn();
    const updateInvoke = jest.fn();
    const llmWithTools = {
      invoke: jest.fn().mockResolvedValue({
        content: '',
        tool_calls: [
          {
            name: 'createAddress',
            args: { contactName: 'A', phone: '1' },
            id: 'call-1',
          },
        ],
      }),
    };

    const result = await runAgentLoop({
      llmWithTools: llmWithTools as any,
      initialMessages: [],
      tools: [
        { name: 'createAddress', invoke: createInvoke },
        { name: 'updateAddress', invoke: updateInvoke },
      ] as any,
      agentName: 'user',
      logger: makeLogger() as any,
      confirmRequiredTools: new Set(['createAddress', 'updateAddress']),
    });

    expect(createInvoke).not.toHaveBeenCalled();
    expect(updateInvoke).not.toHaveBeenCalled();
    expect(result.pendingToolCall).toEqual({
      name: 'createAddress',
      args: { contactName: 'A', phone: '1' },
    });
  });

  it('未在确认名单中的读工具正常执行', async () => {
    const readInvoke = jest.fn().mockResolvedValue('ok');
    const llmWithTools = {
      invoke: jest
        .fn()
        .mockResolvedValueOnce({
          content: '',
          tool_calls: [{ name: 'listAddresses', args: {}, id: 'call-1' }],
        })
        .mockResolvedValueOnce({ content: 'done', tool_calls: [] }),
    };

    await runAgentLoop({
      llmWithTools: llmWithTools as any,
      initialMessages: [],
      tools: [{ name: 'listAddresses', invoke: readInvoke }] as any,
      agentName: 'user',
      logger: makeLogger() as any,
      confirmRequiredTools: new Set(['createAddress', 'updateAddress']),
    });

    expect(readInvoke).toHaveBeenCalledWith({});
  });
});
