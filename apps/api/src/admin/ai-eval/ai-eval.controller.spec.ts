/* eslint-disable @typescript-eslint/unbound-method -- 测试里把原型方法当值传给 Reflect.getMetadata，不存在 this 绑定风险 */
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

  const history = () => ({
    caseId: 'case-1',
    datasetId: 'dataset-1',
    case: {
      id: 'case-1',
      question: 'qa_eval_question_secret',
      tags: ['refund'],
      sourceFeedbackId: 'fb-1',
    },
    timeline: [
      {
        runId: 'run-1',
        status: 'COMPLETED',
        mode: 'STORED',
        scope: 'full',
        isBaseline: false,
        startedAt: new Date('2026-11-21T00:00:00Z'),
        verdict: 'unsolved',
        answerVerdict: null,
        judgeErrorKind: null,
        score: 0,
        answerScore: null,
        outcome: 'fail',
      },
    ],
  });

  const diff = () => ({
    runId: 'run-2',
    baselineRunId: 'run-1',
    metricFamily: 'verdict3',
    comparability: { compared: 1, undecided: 0, missingBaseline: 0 },
    counts: { newFailure: 0, fixed: 1, regressed: 0, stillFailing: 0 },
    classes: {
      newFailure: [],
      fixed: [
        {
          caseId: 'case-1',
          question: 'qa_eval_question_secret',
          baselineVerdict: 'unsolved',
          currentVerdict: 'solved',
        },
      ],
      regressed: [],
      stillFailing: [],
    },
    note: '描述性分类，不构成统计显著性结论；显著性由 compare.py 配对检验给出。',
  });

  const datasetService = {
    // Return a fresh object on every call: redaction mutates in place.
    getDataset: jest.fn().mockImplementation(() => Promise.resolve(dataset())),
    getRun: jest.fn().mockImplementation(() => Promise.resolve(run())),
    getCaseHistory: jest
      .fn()
      .mockImplementation(() => Promise.resolve(history())),
    getRunDiff: jest.fn().mockImplementation(() => Promise.resolve(diff())),
    cancelRun: jest
      .fn()
      .mockResolvedValue({ id: 'run-1', status: 'CANCELLED' }),
    createExternalRun: jest.fn().mockResolvedValue({
      runId: 'run-ext-1',
      status: 'RUNNING',
      caseCount: 2,
    }),
    ingestExternalResults: jest.fn().mockResolvedValue({
      id: 'run-ext-1',
      status: 'COMPLETED',
    }),
    promoteRun: jest
      .fn()
      .mockResolvedValue({ id: 'run-ext-1', isBaseline: true }),
  };
  const judgeService = { judge: jest.fn() };

  return {
    datasetService,
    controller: new AiEvalController(
      judgeService as any,
      datasetService as any,
    ),
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

describe('AiEvalController 外部运行（harness 写入）', () => {
  const originalEvalFlag = process.env.AI_EVAL_ENABLED;

  beforeAll(() => {
    process.env.AI_EVAL_ENABLED = 'true';
  });

  afterAll(() => {
    if (originalEvalFlag === undefined) delete process.env.AI_EVAL_ENABLED;
    else process.env.AI_EVAL_ENABLED = originalEvalFlag;
  });

  it('三个写入端点仅允许 SUPER_ADMIN / ADMIN', () => {
    for (const method of [
      AiEvalController.prototype.createExternalRun,
      AiEvalController.prototype.ingestExternalResults,
      AiEvalController.prototype.promoteRun,
    ]) {
      const roles = Reflect.getMetadata(ROLES_KEY, method) as Role[];
      expect(roles).toEqual(
        expect.arrayContaining([Role.SUPER_ADMIN, Role.ADMIN]),
      );
      expect(roles).not.toContain(Role.VIEWER);
      expect(roles).not.toContain(Role.EDITOR);
    }
  });

  it('创建外部运行：DTO 与操作人原样转发', async () => {
    const { controller, datasetService } = createController();
    const dto = {
      datasetFingerprint: 'fp-1',
      cases: [{ caseId: 'knowledge:delivery', question: '多久送达？' }],
      codeVersion: 'abc1234',
      gateMode: 'shadow',
      judgeSpecVersion: 'v1',
      metricSpecVersion: '1',
    } as any;

    await controller.createExternalRun(dto, 'admin-1');

    expect(datasetService.createExternalRun).toHaveBeenCalledWith(
      dto,
      'admin-1',
    );
  });

  it('写入外部结果：runId 与结果原样转发', async () => {
    const { controller, datasetService } = createController();
    const dto = {
      status: 'COMPLETED',
      cases: [
        { caseId: 'knowledge:delivery', answerVerdict: 'correct' },
        {
          caseId: 'read:balance',
          answerVerdict: 'judge_error',
          judgeErrorKind: 'not_applicable',
        },
      ],
    } as any;

    await controller.ingestExternalResults('run-ext-1', dto);

    expect(datasetService.ingestExternalResults).toHaveBeenCalledWith(
      'run-ext-1',
      dto,
    );
  });

  it('登记基线：runId 原样转发', async () => {
    const { controller, datasetService } = createController();

    await controller.promoteRun('run-ext-1');

    expect(datasetService.promoteRun).toHaveBeenCalledWith('run-ext-1');
  });
});

describe('AiEvalController VIEWER 脱敏', () => {
  it('数据集详情：VIEWER 的用例原文与期望置空，保留 id/tags', async () => {
    const { controller } = createController();

    const result: any = await controller.getDataset(
      'dataset-1',
      {},
      Role.VIEWER,
    );

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

    const result: any = await controller.getDataset(
      'dataset-1',
      {},
      Role.ADMIN,
    );

    expect(result.cases[0].question).toBe('qa_eval_question_secret');
    expect(result.cases[0].answer).toBe('qa_eval_answer_secret');
    expect(result.cases[0].expected).toBe('应说明退款时效');
    expect(result.cases[0].expect).toEqual({ mustMention: ['退款'] });
  });

  it('运行结果：VIEWER 不返回实际回答/判分理由/用例原文，保留判分元信息', async () => {
    const { controller } = createController();

    const result: any = await controller.getRun('run-1', {}, Role.VIEWER);

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

    const result: any = await controller.getRun('run-1', {}, Role.ADMIN);

    expect(result.results[0].actualAnswer).toBe('qa_eval_actual_answer_secret');
    expect(result.results[0].reason).toBe('qa_eval_reason_secret');
    expect(result.results[0].case.question).toBe('qa_eval_question_secret');
    expect(result.results[0].case.answer).toBe('qa_eval_answer_secret');
    expect(result.results[0].case.expected).toBe('应说明退款时效');
    expect(result.results[0].case.expect).toEqual({ mustMention: ['退款'] });
  });

  it('外部运行：VIEWER 仍能看到答案准确性三态，看不到判分理由与原文', async () => {
    const { controller, datasetService } = createController();
    datasetService.getRun.mockResolvedValueOnce({
      id: 'run-ext-1',
      datasetId: 'dataset-1',
      mode: 'EXTERNAL',
      status: 'COMPLETED',
      summary: {
        total: 3,
        accuracy: 0.5,
        judgeErrorRate: 0.3333,
        judgeError: 1,
        judgeErrorKinds: [{ kind: 'timeout', count: 1 }],
      },
      results: [
        {
          id: 'result-ext-1',
          runId: 'run-ext-1',
          caseId: 'case-1',
          // 任务完成度两列在 EXTERNAL 下就是 null，不拿 0 冒充
          verdict: null,
          score: null,
          answerVerdict: 'correct',
          answerScore: 1,
          judgeErrorKind: null,
          grounding: 'kb',
          reason: 'qa_eval_reason_secret',
          actualAnswer: 'qa_eval_actual_answer_secret',
          latencyMs: 900,
          createdAt: new Date('2026-11-24T00:00:00Z'),
          case: {
            id: 'case-1',
            datasetId: 'dataset-1',
            question: 'qa_eval_question_secret',
            answer: null,
            expect: null,
            expected: null,
            tags: ['delivery'],
            metadata: { source: 'harness' },
            sourceFeedbackId: null,
            source: 'external',
            createdAt: new Date('2026-11-24T00:00:00Z'),
          },
        },
      ],
    });

    const result: any = await controller.getRun('run-ext-1', {}, Role.VIEWER);

    expect(result.mode).toBe('EXTERNAL');
    // 判官错误率与错误类型分布对 VIEWER 可见：这是质量信号，不是原文
    expect(result.summary.judgeErrorRate).toBe(0.3333);
    expect(result.summary.judgeErrorKinds).toEqual([
      { kind: 'timeout', count: 1 },
    ]);
    expect(result.results[0]).toMatchObject({
      verdict: null,
      score: null,
      answerVerdict: 'correct',
      answerScore: 1,
      judgeErrorKind: null,
      grounding: 'kb',
      latencyMs: 900,
      // 判分理由与原文仍按既有规则隐藏
      reason: null,
      actualAnswer: null,
    });
    expect(result.results[0].case.question).toBeNull();
  });
});

describe('AiEvalController 回归用例可解释', () => {
  it('时间线与差异端点仍允许 VIEWER 读取', () => {
    for (const method of [
      AiEvalController.prototype.getCaseHistory,
      AiEvalController.prototype.getRunDiff,
    ]) {
      const roles = Reflect.getMetadata(ROLES_KEY, method) as Role[];
      expect(roles).toContain(Role.VIEWER);
      expect(roles).toContain(Role.ADMIN);
    }
  });

  it('用例时间线：VIEWER 看不到用例原文，ADMIN 可见', async () => {
    const { controller, datasetService } = createController();

    const viewer: any = await controller.getCaseHistory(
      'run-1',
      { caseId: 'case-1' },
      Role.VIEWER,
    );
    expect(viewer.case.question).toBeNull();
    expect(viewer.timeline[0].outcome).toBe('fail');
    expect(datasetService.getCaseHistory).toHaveBeenCalledWith(
      'run-1',
      'case-1',
    );

    const admin: any = await controller.getCaseHistory(
      'run-1',
      { caseId: 'case-1' },
      Role.ADMIN,
    );
    expect(admin.case.question).toBe('qa_eval_question_secret');
  });

  it('两次运行差异：VIEWER 看不到用例原文，admin 可见；基线参数原样转发', async () => {
    const { controller, datasetService } = createController();

    const viewer: any = await controller.getRunDiff(
      'run-2',
      { baselineRunId: 'run-1' },
      Role.VIEWER,
    );
    expect(viewer.classes.fixed[0].question).toBeNull();
    expect(viewer.counts.fixed).toBe(1);
    expect(datasetService.getRunDiff).toHaveBeenCalledWith('run-2', {
      baselineRunId: 'run-1',
    });

    const admin: any = await controller.getRunDiff(
      'run-2',
      {},
      Role.ADMIN,
    );
    expect(admin.classes.fixed[0].question).toBe('qa_eval_question_secret');
  });
});
