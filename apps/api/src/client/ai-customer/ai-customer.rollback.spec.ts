import { AiCustomerService } from './ai-customer.service';
import { REMOVE_ALL_MESSAGES } from '@langchain/langgraph';

jest.mock('uuid', () => ({ v4: jest.fn(() => 'test-token') }));
jest.mock('meilisearch', () => ({ Meilisearch: class {} }));

function makeService() {
  const prisma: any = {
    conversation: {
      findUnique: jest.fn().mockResolvedValue({ threadId: 'thread-1' }),
    },
  };
  const unused = () => ({}) as any;
  const service = new AiCustomerService(
    unused(),
    unused(),
    unused(),
    prisma,
    unused(),
    unused(),
    unused(),
    unused(),
    unused(),
    unused(),
    unused(),
    unused(),
    unused(),
    unused(),
    unused(),
    unused(),
    unused(),
    unused(),
    unused(),
    unused(),
  );
  jest
    .spyOn((service as any).logger, 'log')
    .mockImplementation(() => undefined);
  return { service, prisma };
}

function snapshot(checkpointId: string, values: Record<string, any>) {
  return { config: { configurable: { checkpoint_id: checkpointId } }, values };
}

describe('AiCustomerService.rollbackConversationState', () => {
  it('恢复目标 checkpoint 的 messages/flowState/contextState，并生成新 checkpoint', async () => {
    const { service } = makeService();
    const updateState = jest.fn().mockResolvedValue({
      configurable: { checkpoint_id: 'cp-rollback' },
    });
    (service as any).compiledGraph = {
      getStateHistory: async function* () {
        yield snapshot('cp-current', {
          messages: [{ id: 'm1' }, { id: 'm2' }],
          previousIntent: 'order',
        });
        yield snapshot('cp-old', {
          messages: [{ id: 'm1' }],
          previousIntent: 'wallet',
          flowState: { activeFlow: 'WITHDRAWAL', step: 'FILLING', data: {} },
          contextState: { activeEntity: '包包', corrections: [] },
        });
      },
      updateState,
    };

    const result = await (service as any).rollbackConversationState({
      conversationId: 'conv-1',
      checkpointId: 'cp-old',
    });

    expect(result).toEqual({ ok: true, checkpointId: 'cp-rollback' });

    const [, values] = updateState.mock.calls[0];
    expect(values.messages[0].id).toBe(REMOVE_ALL_MESSAGES);
    expect(values.messages.slice(1)).toEqual([{ id: 'm1' }]);
    expect(values.flowState.activeFlow).toBe('WITHDRAWAL');
    expect(values.contextState.activeEntity).toBe('包包');
    expect(values.pendingConfirm).toBeNull();
    expect(values.userMemory).toBe('');
  });

  it('checkpoint 不在历史中 → checkpoint_not_found', async () => {
    const { service } = makeService();
    (service as any).compiledGraph = {
      getStateHistory: async function* () {
        yield snapshot('cp-current', { messages: [] });
      },
      updateState: jest.fn(),
    };

    await expect(
      (service as any).rollbackConversationState({
        conversationId: 'conv-1',
        checkpointId: 'missing',
      }),
    ).resolves.toEqual({ ok: false, reason: 'checkpoint_not_found' });
  });

  it('目标是当前 checkpoint → same_checkpoint，不写新状态', async () => {
    const { service } = makeService();
    const updateState = jest.fn();
    (service as any).compiledGraph = {
      getStateHistory: async function* () {
        yield snapshot('cp-current', { messages: [] });
      },
      updateState,
    };

    await expect(
      (service as any).rollbackConversationState({
        conversationId: 'conv-1',
        checkpointId: 'cp-current',
      }),
    ).resolves.toEqual({ ok: false, reason: 'same_checkpoint' });
    expect(updateState).not.toHaveBeenCalled();
  });

  it('thread 不存在 → 拒绝', async () => {
    const { service, prisma } = makeService();
    prisma.conversation.findUnique.mockResolvedValue({ threadId: null });
    (service as any).compiledGraph = { getStateHistory: jest.fn() };

    await expect(
      (service as any).rollbackConversationState({
        conversationId: 'conv-1',
        checkpointId: 'cp-old',
      }),
    ).resolves.toEqual({ ok: false, reason: 'thread_not_found' });
  });
});
