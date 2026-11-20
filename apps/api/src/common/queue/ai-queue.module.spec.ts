import { AiQueueService } from './ai-queue.module';

/**
 * 队列参数是「可靠性承诺」本身：
 *   - jobId = messageId   → 同一条消息不重复入队
 *   - attempts/backoff    → 短暂故障自动重试
 *   - removeOnFail:false  → 失败任务留在 failed 集合，可排查/重放（死信）
 * 参数改错不会有类型错误，只会在线上丢任务，所以用测试钉住。
 */
describe('AiQueueService', () => {
  function makeService() {
    const add = jest.fn().mockResolvedValue(undefined);
    const service = new AiQueueService({ add } as any);
    return { service, add };
  }

  it('以 messageId 作为 jobId 去重，并保留失败任务', async () => {
    const { service, add } = makeService();

    await service.enqueue({
      conversationId: 'conv-1',
      content: 'hi',
      userId: 'u1',
      messageId: 'msg-1',
    });

    expect(add).toHaveBeenCalledWith(
      'process-message',
      {
        conversationId: 'conv-1',
        content: 'hi',
        userId: 'u1',
        messageId: 'msg-1',
      },
      expect.objectContaining({
        jobId: 'msg-1',
        attempts: 3,
        // 必须大于会话锁 TTL（120s），否则重试会立刻撞锁
        backoff: { type: 'fixed', delay: 130_000 },
        removeOnFail: false,
      }),
    );
  });

  it('没有 messageId 时不伪造 jobId（交给 BullMQ 生成）', async () => {
    const { service, add } = makeService();

    await service.enqueue({
      conversationId: 'conv-1',
      content: 'hi',
      userId: 'u1',
    });

    expect(add.mock.calls[0][2].jobId).toBeUndefined();
  });

  it('入队失败向上抛，调用方才能降级到进程内事件', async () => {
    const { service, add } = makeService();
    add.mockRejectedValue(new Error('redis down'));

    await expect(
      service.enqueue({
        conversationId: 'conv-1',
        content: 'hi',
        userId: 'u1',
        messageId: 'msg-1',
      }),
    ).rejects.toThrow('redis down');
  });
});
