import { AiEvalProcessor } from './ai-eval.processor';

describe('AiEvalProcessor', () => {
  it('把 run-eval job 交给 executeRun(runId)', async () => {
    const datasetService = {
      executeRun: jest.fn().mockResolvedValue(undefined),
    };
    const processor = new AiEvalProcessor(datasetService as any);

    await processor.process({
      name: 'run-eval',
      data: { runId: 'run-1' },
    } as any);

    expect(datasetService.executeRun).toHaveBeenCalledWith('run-1');
  });

  it('忽略其他 job 名，不触发执行', async () => {
    const datasetService = { executeRun: jest.fn() };
    const processor = new AiEvalProcessor(datasetService as any);

    await processor.process({
      name: 'unknown',
      data: { runId: 'run-1' },
    } as any);

    expect(datasetService.executeRun).not.toHaveBeenCalled();
  });

  it('executeRun 抛错时向 BullMQ 冒泡，让 job 进入失败集合', async () => {
    const datasetService = {
      executeRun: jest.fn().mockRejectedValue(new Error('judge down')),
    };
    const processor = new AiEvalProcessor(datasetService as any);

    await expect(
      processor.process({ name: 'run-eval', data: { runId: 'run-1' } } as any),
    ).rejects.toThrow('judge down');
  });
});
