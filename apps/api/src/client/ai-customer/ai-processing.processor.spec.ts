jest.mock('meilisearch', () => ({ Meilisearch: class {} }));
jest.mock('uuid', () => ({ v4: jest.fn(() => 'test-uuid') }));

import { AiProcessingProcessor } from './ai-processing.processor';
import {
  renderMetrics,
  resetMetricsForTest,
} from '@api/common/metrics/metrics';

function makeJob(overrides: Record<string, unknown> = {}) {
  return {
    id: 'job-1',
    name: 'process-message',
    data: { conversationId: 'c1', content: 'hi', userId: 'u1' },
    attemptsMade: 1,
    opts: { attempts: 2 },
    ...overrides,
  } as any;
}

describe('AiProcessingProcessor 失败可观测（2.4）', () => {
  beforeEach(() => resetMetricsForTest());

  it('把 job 交给 listener', async () => {
    const listener = {
      handleAiMessageRequest: jest.fn().mockResolvedValue(undefined),
    };
    const processor = new AiProcessingProcessor(listener as any);

    await processor.process(makeJob());

    expect(listener.handleAiMessageRequest).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: 'c1' }),
    );
  });

  it('listener 抛错时向外传播，交给 BullMQ 重试', async () => {
    const listener = {
      handleAiMessageRequest: jest.fn().mockRejectedValue(new Error('boom')),
    };
    const processor = new AiProcessingProcessor(listener as any);

    await expect(processor.process(makeJob())).rejects.toThrow('boom');
  });

  it('还有重试次数：计 retry，不落 dead 日志', () => {
    const processor = new AiProcessingProcessor({} as any);
    const warn = jest.spyOn((processor as any).logger, 'warn');
    const error = jest.spyOn((processor as any).logger, 'error');

    processor.onFailed(makeJob({ attemptsMade: 1, opts: { attempts: 2 } }), new Error('x'));

    expect(renderMetrics()).toContain(
      'ai_queue_jobs_failed_total{final="retry",queue="ai-processing"} 1',
    );
    expect(warn).toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it('最后一次仍失败：计 dead，写 error 日志（死信可告警）', () => {
    const processor = new AiProcessingProcessor({} as any);
    const warn = jest.spyOn((processor as any).logger, 'warn');
    const error = jest.spyOn((processor as any).logger, 'error');

    processor.onFailed(makeJob({ attemptsMade: 2, opts: { attempts: 2 } }), new Error('boom'));

    expect(renderMetrics()).toContain(
      'ai_queue_jobs_failed_total{final="dead",queue="ai-processing"} 1',
    );
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('dead=true'),
    );
    expect(warn).not.toHaveBeenCalled();
  });
});
