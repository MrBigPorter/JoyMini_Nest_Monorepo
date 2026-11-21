import { Role } from '@lucky/shared';
import { ROLES_KEY } from '../auth/roles.decorator';
import { AiEvalController } from './ai-eval.controller';

function createController() {
  const dataset = () => ({
    id: 'dataset-1',
    name: 'qa_dataset',
    cases: [
      {
        id: 'case-1',
        datasetId: 'dataset-1',
        question: 'qa_eval_question_secret',
        answer: 'qa_eval_answer_secret',
        expect: { mustMention: ['退款'] },
        expected: '应说明退款时效',
        tags: ['refund'],
        metadata: { source: 'manual' },
        sourceFeedbackId: 'fb-1',
        source: 'feedback',
        createdAt: new Date('2026-11-21T00:00:00Z'),
      },
    ],
    runs: [],
  });

  const run = () => ({
    id: 'run-1',
    datasetId: 'dataset-1',
    status: 'COMPLETED',
    summary: { total: 1, solved: 1, partial: 0, unsolved: 0, passRate: 1 },
    results: [
      {
        id: 'result-1',
        runId: 'run-1',
        caseId: 'case-1',
        verdict: 'solved',
        score: 0.92,
        reason: 'qa_eval_reason_secret',
        actualAnswer: 'qa_eval_actual_answer_secret',
        judgeModel: 'deepseek-chat',
        judgeVendor: 'deepseek',
        vendorIndependent: true,
        traceId: 'trace-1',
        latencyMs: 1234,
        createdAt: new Date('2026-11-21T00:00:00Z'),
        case: {
          id: 'case-1',
          datasetId: 'dataset-1',
          question: 'qa_eval_question_secret',
          answer: 'qa_eval_answer_secret',
          expect: { mustMention: ['退款'] },
          expected: '应说明退款时效',
          tags: ['refund'],
          metadata: { source: 'manual' },
          sourceFeedbackId: 'fb-1',
          source: 'feedback',
          createdAt: new Date('2026-11-21T00:00:00Z'),
        },
      },
    ],
  });

  const datasetService = {
    // Return a fresh object on every call: redaction mutates in place.
    getDataset: jest.fn().mockImplementation(() => Promise.resolve(dataset())),
    getRun: jest.fn().mockImplementation(() => Promise.resolve(run())),
    cancelRun: jest.fn().mockResolvedValue({ id: 'run-1', status: 'CANCELLED' }),
  };
  const judgeService = { judge: jest.fn() };

  return {
    datasetService,
    controller: new AiEvalController(judgeService as any, datasetService as any),
  };
}

describe('AiEvalController 角色边界', () => {
  it('judge 不允许 VIEWER / EDITOR 调用', () => {
    const roles = Reflect.getMetadata(
      ROLES_KEY,
      AiEvalController.prototype.judge,
    ) as Role[];

    expect(roles).toEqual(
      expect.arrayContaining([Role.SUPER_ADMIN, Role.ADMIN]),
    );
    expect(roles).not.toContain(Role.VIEWER);
    expect(roles).not.toContain(Role.EDITOR);
  });

  it('评测读取仍允许 VIEWER', () => {
    const roles = Reflect.getMetadata(
      ROLES_KEY,
      AiEvalController.prototype.getRun,
    ) as Role[];

    expect(roles).toContain(Role.VIEWER);
  });

  it('取消运行仅允许 SUPER_ADMIN / ADMIN', () => {
    const roles = Reflect.getMetadata(
      ROLES_KEY,
      AiEvalController.prototype.cancelRun,
    ) as Role[];

    expect(roles).toEqual(
      expect.arrayContaining([Role.SUPER_ADMIN, Role.ADMIN]),
    );
    expect(roles).not.toContain(Role.VIEWER);
    expect(roles).not.toContain(Role.EDITOR);
  });
});

describe('AiEvalController VIEWER 脱敏', () => {
  it('数据集详情：VIEWER 的用例原文与期望置空，保留 id/tags', async () => {
    const { controller } = createController();

    const result: any = await controller.getDataset('dataset-1', Role.VIEWER);

    expect(result.cases[0]).toEqual({
      id: 'case-1',
      datasetId: 'dataset-1',
      question: null,
      answer: null,
      expect: null,
      expected: null,
      tags: ['refund'],
      metadata: { source: 'manual' },
      sourceFeedbackId: 'fb-1',
      source: 'feedback',
      createdAt: expect.any(Date),
    });
  });

  it('数据集详情：ADMIN 保留用例原文与期望', async () => {
    const { controller } = createController();

    const result: any = await controller.getDataset('dataset-1', Role.ADMIN);

    expect(result.cases[0].question).toBe('qa_eval_question_secret');
    expect(result.cases[0].answer).toBe('qa_eval_answer_secret');
    expect(result.cases[0].expected).toBe('应说明退款时效');
    expect(result.cases[0].expect).toEqual({ mustMention: ['退款'] });
  });

  it('运行结果：VIEWER 不返回实际回答/判分理由/用例原文，保留判分元信息', async () => {
    const { controller } = createController();

    const result: any = await controller.getRun('run-1', Role.VIEWER);

    expect(result.results[0]).toEqual({
      id: 'result-1',
      runId: 'run-1',
      caseId: 'case-1',
      verdict: 'solved',
      score: 0.92,
      reason: null,
      actualAnswer: null,
      judgeModel: 'deepseek-chat',
      judgeVendor: 'deepseek',
      vendorIndependent: true,
      traceId: 'trace-1',
      latencyMs: 1234,
      createdAt: expect.any(Date),
      case: {
        id: 'case-1',
        datasetId: 'dataset-1',
        question: null,
        answer: null,
        expect: null,
        expected: null,
        tags: ['refund'],
        metadata: { source: 'manual' },
        sourceFeedbackId: 'fb-1',
        source: 'feedback',
        createdAt: expect.any(Date),
      },
    });
  });

  it('运行结果：ADMIN 保留实际回答/判分理由/用例原文', async () => {
    const { controller } = createController();

    const result: any = await controller.getRun('run-1', Role.ADMIN);

    expect(result.results[0].actualAnswer).toBe(
      'qa_eval_actual_answer_secret',
    );
    expect(result.results[0].reason).toBe('qa_eval_reason_secret');
    expect(result.results[0].case.question).toBe('qa_eval_question_secret');
    expect(result.results[0].case.answer).toBe('qa_eval_answer_secret');
    expect(result.results[0].case.expected).toBe('应说明退款时效');
    expect(result.results[0].case.expect).toEqual({ mustMention: ['退款'] });
  });
});
