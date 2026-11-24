import { runAgentLoop } from './agent-runner';
import { attachPreConfirm } from '@api/client/ai-customer/graph/tools/pre-confirm';

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

describe('runAgentLoop 弹卡前校验', () => {
  it('校验失败时不弹卡：把原因喂回模型，循环继续', async () => {
    const deleteTool: any = { name: 'deleteAddress', invoke: jest.fn() };
    attachPreConfirm(deleteTool, ({ addressId }: any) =>
      addressId === 'user-id'
        ? 'address "user-id" does not exist for this user.'
        : null,
    );

    const llmWithTools = {
      invoke: jest
        .fn()
        // 第一次：模型把 userId 当 addressId
        .mockResolvedValueOnce({
          content: '',
          tool_calls: [
            { name: 'deleteAddress', args: { addressId: 'user-id' }, id: 'c1' },
          ],
        })
        // 第二次：模型改用真实地址
        .mockResolvedValueOnce({
          content: '',
          tool_calls: [
            { name: 'deleteAddress', args: { addressId: 'addr-1' }, id: 'c2' },
          ],
        }),
    };

    const result = await runAgentLoop({
      llmWithTools: llmWithTools as any,
      initialMessages: [],
      tools: [deleteTool],
      agentName: 'user',
      logger: makeLogger() as any,
      confirmRequiredTools: new Set(['deleteAddress']),
    });

    expect(deleteTool.invoke).not.toHaveBeenCalled();
    expect(result.pendingToolCall).toEqual({
      name: 'deleteAddress',
      args: { addressId: 'addr-1' },
    });
    // 第一次的失败原因作为 ToolMessage 进了上下文，模型才看得到
    const fedBack = result.currentMessages.filter(
      (message: any) =>
        message?._getType?.() === 'tool' &&
        String(message.content).includes('does not exist'),
    );
    expect(fedBack).toHaveLength(1);
  });

  it('校验函数抛错按失败处理（fail-closed），不弹卡', async () => {
    const deleteTool: any = { name: 'deleteAddress', invoke: jest.fn() };
    attachPreConfirm(deleteTool, () => {
      throw new Error('db down');
    });

    const result = await runAgentLoop({
      llmWithTools: {
        invoke: jest.fn().mockResolvedValue({
          content: '暂时无法处理',
          tool_calls: [
            { name: 'deleteAddress', args: { addressId: 'addr-1' }, id: 'c1' },
          ],
        }),
      } as any,
      initialMessages: [],
      tools: [deleteTool],
      agentName: 'user',
      logger: makeLogger() as any,
      confirmRequiredTools: new Set(['deleteAddress']),
    });

    expect(result.pendingToolCall).toBeNull();
    expect(deleteTool.invoke).not.toHaveBeenCalled();
  });
});
