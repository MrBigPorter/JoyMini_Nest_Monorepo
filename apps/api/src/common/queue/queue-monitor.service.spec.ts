import { QueueMonitorService } from './queue-monitor.service';

function makeService() {
  const blogQueue: any = {
    clean: jest.fn().mockResolvedValue([]),
  };
  const aiQueue: any = {
    getFailed: jest.fn().mockResolvedValue([]),
    getJob: jest.fn(),
    clean: jest.fn().mockResolvedValue([]),
  };
  const prisma: any = {
    chatMessage: { findFirst: jest.fn().mockResolvedValue(null) },
  };
  const service = new QueueMonitorService(
    blogQueue,
    {} as any,
    {} as any,
    {} as any,
    aiQueue,
    {} as any,
    { get: jest.fn() } as any,
    prisma,
  );
  return { service, blogQueue, aiQueue, prisma };
}

describe('QueueMonitorService · AI 死信重放', () => {
  it('已有 AI 回复：拒绝重放，避免工具副作用执行第二次', async () => {
    const { service, aiQueue, prisma } = makeService();
    prisma.chatMessage.findFirst.mockResolvedValue({ id: 'reply-1' });

    await expect(service.replayAiJob('msg-1')).resolves.toEqual({
      ok: false,
      reason: 'already_replied',
    });
    expect(aiQueue.getJob).not.toHaveBeenCalled();
  });

  it('failed job：使用 Job.retry 重置并重放，不重新 queue.add', async () => {
    const { service, aiQueue } = makeService();
    const job = {
      getState: jest.fn().mockResolvedValue('failed'),
      retry: jest.fn().mockResolvedValue(undefined),
    };
    aiQueue.getJob.mockResolvedValue(job);

    await expect(service.replayAiJob('msg-1')).resolves.toEqual({ ok: true });
    expect(job.retry).toHaveBeenCalledWith('failed', {
      resetAttemptsMade: true,
    });
  });

  it('job 不存在：返回明确原因', async () => {
    const { service, aiQueue } = makeService();
    aiQueue.getJob.mockResolvedValue(undefined);

    await expect(service.replayAiJob('missing')).resolves.toEqual({
      ok: false,
      reason: 'job_not_found',
    });
  });

  it('已完成 job：不重放', async () => {
    const { service, aiQueue } = makeService();
    aiQueue.getJob.mockResolvedValue({
      getState: jest.fn().mockResolvedValue('completed'),
      retry: jest.fn(),
    });

    await expect(service.replayAiJob('msg-1')).resolves.toEqual({
      ok: false,
      reason: 'already_completed',
    });
  });

  it('默认只清理 completed，不碰 failed 死信', async () => {
    const { service, blogQueue } = makeService();
    blogQueue.clean.mockResolvedValueOnce(['job-1', 'job-2']);

    const result = await service.cleanQueue('blog-ai', 1000);

    expect(blogQueue.clean).toHaveBeenCalledTimes(1);
    expect(blogQueue.clean).toHaveBeenCalledWith(1000, 1000, 'completed');
    expect(result).toEqual({ cleanedCount: 2, failedCleanedCount: 0 });
  });

  it('includeFailed=true 时才额外清理 failed', async () => {
    const { service, blogQueue } = makeService();
    blogQueue.clean
      .mockResolvedValueOnce(['job-1'])
      .mockResolvedValueOnce(['failed-1', 'failed-2']);

    const result = await service.cleanQueue('blog-ai', 1000, true);

    expect(blogQueue.clean).toHaveBeenNthCalledWith(1, 1000, 1000, 'completed');
    expect(blogQueue.clean).toHaveBeenNthCalledWith(2, 1000, 1000, 'failed');
    expect(result).toEqual({ cleanedCount: 1, failedCleanedCount: 2 });
  });

  it('queue.clean 抛错时向上抛，避免把失败伪装成清理 0 条', async () => {
    const { service, blogQueue } = makeService();
    blogQueue.clean.mockRejectedValueOnce(new Error('redis down'));

    await expect(service.cleanQueue('blog-ai', 1000)).rejects.toThrow(
      'redis down',
    );
  });

  it('失败列表只暴露排查所需字段', async () => {
    const { service, aiQueue } = makeService();
    aiQueue.getFailed.mockResolvedValue([
      {
        id: 'msg-1',
        data: { conversationId: 'conv-1' },
        attemptsMade: 3,
        failedReason: 'boom',
        finishedOn: 1_700_000_000_000,
      },
    ]);

    await expect(service.getAiFailedJobs(10)).resolves.toEqual([
      {
        messageId: 'msg-1',
        conversationId: 'conv-1',
        attemptsMade: 3,
        failedReason: 'boom',
        failedAt: new Date(1_700_000_000_000),
      },
    ]);
  });
});
