import { BadRequestException, ConflictException } from '@nestjs/common';
import { createHash } from 'crypto';
import { JudgeFailureError } from './ai-eval-judge.service';
import {
  AiEvalDatasetService,
  DEFAULT_EVAL_RUN_TOKEN_BUDGET,
  estimateEvalCaseTokens,
  snapshotHashOfCaseIds,
} from './ai-eval-dataset.service';

/**
 * 评测执行链路单测：
 * - STORED 保持历史回答判定
 * - LIVE 调用真实客服 testChat，拿到实际回答后再 judge
 * - 单条 LIVE 失败不拖垮整次运行
 * - 基线对比产出 delta / newFailures / fixed
 */

function makeCase(id: string, question: string, answer: string) {
  return {
    id,
    datasetId: 'ds-1',
    question,
    answer,
    expect: { mustMention: ['关键信息'] },
    expected: null,
    tags: [],
    createdAt: new Date(),
  };
}

function makeRun(
  mode: 'STORED' | 'LIVE',
  cases: ReturnType<typeof makeCase>[],
  baselineRunId: string | null = null,
) {
  return {
    id: 'run-1',
    datasetId: 'ds-1',
    status: 'RUNNING',
    mode,
    baselineRunId,
    judgeSpecVersion: 'task-judge-v2',
    // run 行在启动时快照判官模型，成本按它取价。
    judgeModel: 'llama-3.3-70b-versatile',
    dataset: { cases },
  };
}

function verdictOf(verdict: string) {
  return {
    verdict,
    score: verdict === 'solved' ? 0.9 : verdict === 'partial' ? 0.5 : 0,
    reason: `judged:${verdict}`,
    judgeModel: 'llama-3.3-70b-versatile',
    judgeVendor: 'groq',
    vendorIndependent: true,
  };
}

function makeService() {
  const prisma = {
    aiScore: { create: jest.fn().mockResolvedValue({ id: 'score-1' }) },
    aiEvalDataset: { findUnique: jest.fn(), create: jest.fn() },
    aiEvalRun: {
      create: jest.fn(),
      // 状态检查走 select.status；默认视为 RUNNING，具体用例可覆盖。
      findUnique: jest
        .fn()
        .mockImplementation((args: any) =>
          Promise.resolve(args?.select?.status ? { status: 'RUNNING' } : null),
        ),
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    aiEvalCase: {
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      createMany: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    aiEvalResult: {
      create: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    aiEvalAnnotation: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    aiEvalJudgeAttempt: {
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    // 交互式事务：测试里直接以同一个 mock 作为 tx，断言与单写路径一致。
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation((cb: (tx: any) => unknown) => cb(prisma));
  const judge = {
    judge: jest.fn(),
    spec: jest.fn().mockReturnValue({
      version: 'task-judge-v2',
      promptHash: 'f'.repeat(64),
      model: 'llama-3.3-70b-versatile',
      vendor: 'groq',
      sampleCount: 1,
    }),
  };
  const aiCustomer = { testChat: jest.fn() };
  const queue = { add: jest.fn().mockResolvedValue({ id: 'job-1' }) };
  const corpusFingerprint = {
    getCurrent: jest.fn().mockResolvedValue({
      fingerprint: 'corpus-test',
      docs: [],
      pendingActivation: [],
      generatedAt: '2026-11-24T00:00:00.000Z',
    }),
  };
  const service = new AiEvalDatasetService(
    prisma as any,
    judge as any,
    aiCustomer as any,
    queue as any,
    corpusFingerprint as any,
  );
  return { service, prisma, judge, aiCustomer, queue, corpusFingerprint };
}

function summaryOf(prisma: ReturnType<typeof makeService>['prisma']) {
  // 终态更新改为条件 updateMany；兼容旧的 update 断言。
  const manyCalls = prisma.aiEvalRun.updateMany.mock.calls;
  const many = manyCalls[manyCalls.length - 1]?.[0]?.data?.summary;
  if (many) return many;
  const calls = prisma.aiEvalRun.update.mock.calls;
  const call = calls[calls.length - 1];
  return call?.[0]?.data?.summary;
}

describe('AiEvalDatasetService', () => {
  beforeEach(() => {
    process.env.AI_EVAL_LIVE_USER_ID = 'eval-test-user';
  });

  afterEach(() => {
    delete process.env.AI_EVAL_RUN_TOKEN_BUDGET;
    delete process.env.AI_PRICE_INPUT_PER_1M;
    delete process.env.AI_PRICE_OUTPUT_PER_1M;
  });

  it('STORED 保持历史回答判定，并记录 judge 元数据', async () => {
    const { service, prisma, judge, aiCustomer } = makeService();
    const cases = [makeCase('c1', '怎么退款', '历史回答：走退款流程')];
    prisma.aiEvalRun.findUnique.mockResolvedValue(makeRun('STORED', cases));
    judge.judge.mockResolvedValue(verdictOf('solved'));

    await (service as any).executeRun('run-1');

    expect(aiCustomer.testChat).not.toHaveBeenCalled();
    expect(judge.judge).toHaveBeenCalledWith({
      question: '怎么退款',
      answer: '历史回答：走退款流程',
      expectTask: { mustMention: ['关键信息'] },
      pendingConfirm: null,
    });
    const result = prisma.aiEvalResult.create.mock.calls[0][0].data;
    expect(result).toMatchObject({
      verdict: 'solved',
      actualAnswer: null,
      judgeModel: 'llama-3.3-70b-versatile',
      judgeVendor: 'groq',
      vendorIndependent: true,
    });
    expect(summaryOf(prisma)).toMatchObject({
      mode: 'STORED',
      baselineRunId: null,
      total: 1,
      solved: 1,
      passRate: 1,
    });
  });

  it('内部执行在事务内留痕判官尝试，原始输出落库前脱敏', async () => {
    const { service, prisma, judge } = makeService();
    const cases = [makeCase('c1', '怎么退款', '历史回答')];
    prisma.aiEvalRun.findUnique.mockResolvedValue(makeRun('STORED', cases));
    judge.judge.mockResolvedValue({
      ...verdictOf('solved'),
      rawOutput:
        '{"verdict":"solved","reason":"联系 13800000000 或 alice@example.com"}',
      rawTruncated: false,
    });

    await (service as any).executeRun('run-1');

    // 结果行与尝试行同一事务：要么一起可见，要么一起回滚。
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    const attempts = prisma.aiEvalJudgeAttempt.createMany.mock.calls[0][0].data;
    expect(attempts).toEqual([
      {
        runId: 'run-1',
        caseId: 'c1',
        source: 'task',
        attemptIndex: 0,
        outcome: 'success',
        verdict: 'solved',
        score: 0.9,
        errorKind: null,
        rawOutput:
          '{"verdict":"solved","reason":"联系 138****0000 或 a***@example.com"}',
        rawTruncated: false,
        judgeVersion: 'task-judge-v2',
        judgeInputHash: null,
      },
    ]);
  });

  it('判官解析失败留痕原始输出，结果行仍按判官失败记账', async () => {
    const { service, prisma, judge } = makeService();
    const cases = [makeCase('c1', '怎么退款', '历史回答')];
    prisma.aiEvalRun.findUnique.mockResolvedValue(makeRun('STORED', cases));
    judge.judge.mockRejectedValue(
      new JudgeFailureError(
        'output_format',
        'AI eval judge output is not valid JSON',
        '这不是 JSON 13800000000',
        true,
      ),
    );

    await (service as any).executeRun('run-1');

    const attempts = prisma.aiEvalJudgeAttempt.createMany.mock.calls[0][0].data;
    expect(attempts[0]).toMatchObject({
      caseId: 'c1',
      outcome: 'parse_failed',
      errorKind: 'output_format',
      verdict: null,
      score: null,
      rawOutput: '这不是 JSON 138****0000',
      rawTruncated: true,
    });
    const result = prisma.aiEvalResult.create.mock.calls[0][0].data;
    expect(result.judgeErrorKind).toBe('output_format');
  });

  it('判官调用失败留痕为调用失败，且没有原始输出', async () => {
    const { service, prisma, judge } = makeService();
    const cases = [makeCase('c1', '怎么退款', '历史回答')];
    prisma.aiEvalRun.findUnique.mockResolvedValue(makeRun('STORED', cases));
    judge.judge.mockRejectedValue(new Error('Request timed out after 30s'));

    await (service as any).executeRun('run-1');

    const attempts = prisma.aiEvalJudgeAttempt.createMany.mock.calls[0][0].data;
    expect(attempts[0]).toMatchObject({
      caseId: 'c1',
      outcome: 'call_error',
      errorKind: 'timeout',
      rawOutput: null,
      rawTruncated: false,
    });
  });

  it('尝试留痕写入失败只告警，判分与运行状态不变', async () => {
    const { service, prisma, judge } = makeService();
    const cases = [makeCase('c1', '怎么退款', '历史回答')];
    prisma.aiEvalRun.findUnique.mockResolvedValue(makeRun('STORED', cases));
    judge.judge.mockResolvedValue({
      ...verdictOf('solved'),
      rawOutput: '{"verdict":"solved"}',
      rawTruncated: false,
    });
    prisma.aiEvalJudgeAttempt.createMany.mockRejectedValue(
      new Error('relation "ai_eval_judge_attempts" does not exist'),
    );

    await (service as any).executeRun('run-1');

    // 第一次事务整体回滚，回退为只写结果；结论与终态不受影响。
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    const createCalls = prisma.aiEvalResult.create.mock.calls;
    const result = createCalls[createCalls.length - 1][0].data;
    expect(result.verdict).toBe('solved');
    expect(summaryOf(prisma)).toMatchObject({
      mode: 'STORED',
      total: 1,
      solved: 1,
    });
  });

  it('LIVE 调用真实 AI 并以实际回答判分', async () => {
    const { service, prisma, judge, aiCustomer } = makeService();
    const cases = [makeCase('c1', '怎么退款', '旧的历史回答')];
    prisma.aiEvalRun.findUnique.mockResolvedValue(makeRun('LIVE', cases));
    aiCustomer.testChat.mockResolvedValue({
      agentOutput: '实时回答：请点申请退款',
      pendingConfirm: { action: 'claim_coupon' },
    });
    judge.judge.mockResolvedValue(verdictOf('solved'));

    await (service as any).executeRun('run-1');

    expect(aiCustomer.testChat).toHaveBeenCalledWith(
      '怎么退款',
      expect.any(String),
      false,
      expect.stringContaining('eval-run-1-c1'),
      // 用量采集器随调用传入（task 5.1 / 5.2）。
      { usageCollector: expect.objectContaining({ role: 'chat' }) },
    );
    expect(judge.judge).toHaveBeenCalledWith({
      question: '怎么退款',
      answer: '实时回答：请点申请退款',
      expectTask: { mustMention: ['关键信息'] },
      pendingConfirm: { action: 'claim_coupon' },
    });
    const result = prisma.aiEvalResult.create.mock.calls[0][0].data;
    expect(result.actualAnswer).toBe('实时回答：请点申请退款');
    expect(result.traceId).toBeNull();
    expect(summaryOf(prisma)).toMatchObject({
      mode: 'LIVE',
      total: 1,
      solved: 1,
    });
  });

  it('LIVE 单条执行失败单独记账，不污染回答准确性', async () => {
    const { service, prisma, judge, aiCustomer } = makeService();
    const cases = [
      makeCase('c1', '会失败的问题', '历史回答 1'),
      makeCase('c2', '会成功的问题', '历史回答 2'),
    ];
    prisma.aiEvalRun.findUnique.mockResolvedValue(makeRun('LIVE', cases));
    aiCustomer.testChat
      .mockRejectedValueOnce(new Error('provider down'))
      .mockResolvedValueOnce({ agentOutput: '正常回答' });
    judge.judge.mockResolvedValue(verdictOf('solved'));

    await (service as any).executeRun('run-1');

    // 执行失败的那条根本不进判官：没有回答可判。
    expect(judge.judge).toHaveBeenCalledTimes(1);
    const first = prisma.aiEvalResult.create.mock.calls[0][0].data;
    expect(first).toMatchObject({
      caseId: 'c1',
      verdict: null,
      score: null,
      actualAnswer: null,
    });
    expect(first.reason).toContain('execution_error');
    const second = prisma.aiEvalResult.create.mock.calls[1][0].data;
    expect(second).toMatchObject({ caseId: 'c2', verdict: 'solved' });
    const completed = prisma.aiEvalRun.updateMany.mock.calls
      .map(([arg]: any[]) => arg)
      .find((arg: any) => arg?.data?.status === 'COMPLETED');
    expect(completed).toBeTruthy();
    expect(completed.data.executionErrorKind).toBe('live_call');
    expect(summaryOf(prisma)).toMatchObject({
      mode: 'LIVE',
      total: 2,
      solved: 1,
      // 执行失败不进 unsolved：否则系统故障会被算成「回答错了」。
      unsolved: 0,
      executionError: 1,
    });
    expect(summaryOf(prisma).executionErrorKinds).toMatchObject({
      live_call: 1,
    });
    // 评测分是 0..1 连续分，与分诊的 0/1 判定不同量纲，必须显式标 graded。
    expect(prisma.aiScore.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        source: 'LLM',
        valueKind: 'graded',
      }),
    });
  });

  it('基线对比产出 baselinePassRate / delta / newFailures / fixed', async () => {
    const { service, prisma, judge } = makeService();
    const cases = [
      makeCase('c1', 'q1', 'a1'),
      makeCase('c2', 'q2', 'a2'),
      makeCase('c3', 'q3', 'a3'),
    ];
    // 第一次 findUnique 取本次 run，第二次取基线。
    prisma.aiEvalRun.findUnique
      .mockResolvedValueOnce(makeRun('STORED', cases, 'baseline-1'))
      .mockResolvedValueOnce({
        summary: { passRate: 0.667 },
        results: [
          { caseId: 'c1', verdict: 'solved' },
          { caseId: 'c2', verdict: 'solved' },
          { caseId: 'c3', verdict: 'unsolved' },
        ],
      });
    judge.judge
      .mockResolvedValueOnce(verdictOf('solved'))
      .mockResolvedValueOnce(verdictOf('unsolved'))
      .mockResolvedValueOnce(verdictOf('solved'));

    await (service as any).executeRun('run-1');

    expect(summaryOf(prisma)).toMatchObject({
      mode: 'STORED',
      baselineRunId: 'baseline-1',
      passRate: 0.667,
      baselinePassRate: 0.667,
      delta: 0,
      newFailures: 1, // c2: 基线通过 → 本次未通过
      fixed: 1, // c3: 基线未通过 → 本次通过
    });
  });

  it('内部 run 不把 EXTERNAL answer_accuracy 基线算进同族 delta', async () => {
    const { service, prisma, judge } = makeService();
    const cases = [makeCase('c1', 'q1', 'a1')];
    prisma.aiEvalRun.findUnique
      .mockResolvedValueOnce(makeRun('STORED', cases, 'baseline-ext'))
      .mockResolvedValueOnce({
        // 外部族的同名 key 是准确率，拿来当任务通过率基线会算出假的 delta。
        summary: { metricFamily: 'answer_accuracy-v3', accuracy: 0.9 },
        results: [{ caseId: 'c1', verdict: null }],
      });
    judge.judge.mockResolvedValue(verdictOf('solved'));

    await (service as any).executeRun('run-1');

    const summary = summaryOf(prisma);
    expect(summary.metricFamily).toBe('verdict3');
    expect(summary.baselineRunId).toBe('baseline-ext');
    expect(summary).not.toHaveProperty('baselinePassRate');
    expect(summary).not.toHaveProperty('delta');
    expect(summary).not.toHaveProperty('newFailures');
    expect(summary).not.toHaveProperty('fixed');
  });

  it('startRun 显式传 baselineRunId=null 时不回退到已登记基线', async () => {
    const { service, prisma } = makeService();
    prisma.aiEvalDataset.findUnique.mockResolvedValue({
      id: 'ds-1',
      cases: [makeCase('c1', 'q1', 'a1')],
    });
    // 已有一条 promoted 基线；RUNNING 检查要单独回答，否则 startRun 直接报「已有运行」。
    prisma.aiEvalRun.findFirst.mockImplementation(async (arg: any) =>
      arg?.where?.isBaseline ? { id: 'baseline-1' } : null,
    );
    prisma.aiEvalRun.create.mockResolvedValue({ id: 'run-new' });

    await service.startRun('ds-1', 'admin-1', {
      mode: 'STORED',
      baselineRunId: null,
    });

    expect(prisma.aiEvalRun.findFirst).not.toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ isBaseline: true }),
      }),
    );
    expect(
      prisma.aiEvalRun.create.mock.calls[0][0].data.baselineRunId,
    ).toBeNull();
  });

  it('executeRun 不为 baselineRunId=null 的 run 补拾基线', async () => {
    const { service, prisma, judge } = makeService();
    prisma.aiEvalRun.findUnique.mockResolvedValue(
      makeRun('STORED', [makeCase('c1', 'q1', 'a1')]),
    );
    prisma.aiEvalRun.findFirst.mockResolvedValue({ id: 'baseline-1' });
    judge.judge.mockResolvedValue(verdictOf('solved'));

    await service.executeRun('run-1');

    expect(prisma.aiEvalRun.findFirst).not.toHaveBeenCalled();
    expect(summaryOf(prisma).baselineRunId).toBeNull();
  });

  it('startRun 拒绝非本评测集或未完成的基线', async () => {
    const { service, prisma } = makeService();
    prisma.aiEvalDataset.findUnique.mockResolvedValue({
      id: 'ds-1',
      cases: [makeCase('c1', 'q1', 'a1')],
    });
    prisma.aiEvalRun.findUnique.mockResolvedValue({
      id: 'baseline-1',
      datasetId: 'ds-1',
      status: 'RUNNING',
    });

    await expect(
      service.startRun('ds-1', 'admin-1', {
        mode: 'LIVE',
        baselineRunId: 'baseline-1',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.aiEvalRun.create).not.toHaveBeenCalled();
  });

  it('startRun 拒绝没有期望的用例', async () => {
    const { service, prisma } = makeService();
    prisma.aiEvalDataset.findUnique.mockResolvedValue({
      id: 'ds-1',
      cases: [
        {
          ...makeCase('c1', 'q1', 'a1'),
          expect: {},
          expected: null,
        },
      ],
    });

    await expect(
      service.startRun('ds-1', 'admin-1', { mode: 'STORED' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.aiEvalRun.create).not.toHaveBeenCalled();
  });

  it('startRun 接受非空字符串 expected', async () => {
    const { service, prisma } = makeService();
    prisma.aiEvalDataset.findUnique.mockResolvedValue({
      id: 'ds-1',
      cases: [
        {
          ...makeCase('c1', 'q1', 'a1'),
          expect: {},
          expected: 'must mention 7 days',
        },
      ],
    });
    prisma.aiEvalRun.create.mockResolvedValue({ id: 'run-new' });
    prisma.aiEvalRun.findUnique.mockResolvedValue(null);

    const run = await service.startRun('ds-1', 'admin-1', { mode: 'STORED' });

    expect(run).toEqual({ id: 'run-new' });
    expect(prisma.aiEvalRun.create).toHaveBeenCalled();
  });

  it('startRun 拒绝同一评测集的并发运行', async () => {
    const { service, prisma } = makeService();
    prisma.aiEvalDataset.findUnique.mockResolvedValue({
      id: 'ds-1',
      cases: [makeCase('c1', 'q1', 'a1')],
    });
    prisma.aiEvalRun.findFirst.mockResolvedValueOnce({ id: 'running-1' });

    await expect(
      service.startRun('ds-1', 'admin-1', { mode: 'STORED' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.aiEvalRun.create).not.toHaveBeenCalled();
  });

  it('startRun 并发撞上唯一约束时返回 409 并带出已有运行', async () => {
    const { service, prisma, queue } = makeService();
    prisma.aiEvalDataset.findUnique.mockResolvedValue({
      id: 'ds-1',
      cases: [makeCase('c1', 'q1', 'a1')],
    });
    prisma.aiEvalRun.findFirst
      .mockResolvedValueOnce(null) // 预检查：读时还没有 RUNNING
      .mockResolvedValueOnce(null) // 基线回退：没有基线
      .mockResolvedValueOnce({ id: 'run-existing' }); // 冲突后查出已有运行
    prisma.aiEvalRun.create.mockRejectedValueOnce(
      Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }),
    );

    const err = await service
      .startRun('ds-1', 'admin-1', { mode: 'STORED' })
      .catch((e) => e);

    expect(err).toBeInstanceOf(ConflictException);
    expect(err.getResponse()).toMatchObject({ runId: 'run-existing' });
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('startRun 用 run id 作为 jobId 入队，不再在请求线程执行', async () => {
    const { service, prisma, queue } = makeService();
    prisma.aiEvalDataset.findUnique.mockResolvedValue({
      id: 'ds-1',
      cases: [makeCase('c1', 'q1', 'a1')],
    });
    prisma.aiEvalRun.create.mockResolvedValue({ id: 'run-new' });

    const run = await service.startRun('ds-1', 'admin-1', { mode: 'STORED' });

    expect(run).toEqual({ id: 'run-new' });
    expect(queue.add).toHaveBeenCalledWith(
      'run-eval',
      { runId: 'run-new' },
      expect.objectContaining({ jobId: 'run-new', attempts: 1 }),
    );
  });

  it('startRun 未显式传基线时回退到当前 isBaseline 运行', async () => {
    const { service, prisma } = makeService();
    prisma.aiEvalDataset.findUnique.mockResolvedValue({
      id: 'ds-1',
      cases: [makeCase('c1', 'q1', 'a1')],
    });
    prisma.aiEvalRun.findFirst
      .mockResolvedValueOnce(null) // 没有并发 RUNNING
      .mockResolvedValueOnce({ id: 'baseline-1' }); // 当前基线
    prisma.aiEvalRun.create.mockResolvedValue({ id: 'run-new' });

    await service.startRun('ds-1', 'admin-1', { mode: 'STORED' });

    expect(prisma.aiEvalRun.create.mock.calls[0][0].data.baselineRunId).toBe(
      'baseline-1',
    );
  });

  it('入队失败时把 run 落 FAILED，避免永久 RUNNING', async () => {
    const { service, prisma, queue } = makeService();
    prisma.aiEvalDataset.findUnique.mockResolvedValue({
      id: 'ds-1',
      cases: [makeCase('c1', 'q1', 'a1')],
    });
    prisma.aiEvalRun.create.mockResolvedValue({ id: 'run-new' });
    queue.add.mockRejectedValueOnce(new Error('redis down'));

    await expect(
      service.startRun('ds-1', 'admin-1', { mode: 'STORED' }),
    ).rejects.toThrow('redis down');
    expect(prisma.aiEvalRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'run-new' },
        data: expect.objectContaining({
          status: 'FAILED',
          summary: expect.objectContaining({
            error: expect.stringContaining('enqueue failed'),
          }),
        }),
      }),
    );
  });

  it('cancelRun 只把 RUNNING 改成 CANCELLED', async () => {
    const { service, prisma } = makeService();
    prisma.aiEvalRun.updateMany.mockResolvedValueOnce({ count: 1 });
    prisma.aiEvalRun.findUnique.mockResolvedValue({
      id: 'run-1',
      status: 'CANCELLED',
      summary: { cancelled: true },
      results: [],
    });

    const run = await service.cancelRun('run-1');

    expect(prisma.aiEvalRun.updateMany).toHaveBeenCalledWith({
      where: { id: 'run-1', status: 'RUNNING' },
      data: expect.objectContaining({
        status: 'CANCELLED',
        summary: { cancelled: true },
      }),
    });
    expect(run).toMatchObject({ id: 'run-1', status: 'CANCELLED' });
  });

  it('cancelRun 遇到终态直接返回当前 run', async () => {
    const { service, prisma } = makeService();
    prisma.aiEvalRun.updateMany.mockResolvedValueOnce({ count: 0 });
    prisma.aiEvalRun.findUnique.mockResolvedValue({
      id: 'run-1',
      status: 'COMPLETED',
      summary: { passRate: 1 },
      results: [],
    });

    const run = await service.cancelRun('run-1');

    expect(run).toMatchObject({ id: 'run-1', status: 'COMPLETED' });
  });

  it('cancelRun 对不存在的 run 抛 404', async () => {
    const { service, prisma } = makeService();
    prisma.aiEvalRun.findUnique.mockResolvedValueOnce(null);

    await expect(service.cancelRun('missing')).rejects.toThrow(
      'Eval run not found',
    );
    expect(prisma.aiEvalRun.updateMany).not.toHaveBeenCalled();
  });

  it('executeRun 在第一条用例前发现 CANCELLED 即停止', async () => {
    const { service, prisma, judge } = makeService();
    prisma.aiEvalRun.findUnique
      .mockResolvedValueOnce(makeRun('STORED', [makeCase('c1', 'q1', 'a1')]))
      .mockResolvedValueOnce({ status: 'CANCELLED' });

    await service.executeRun('run-1');

    expect(judge.judge).not.toHaveBeenCalled();
    expect(prisma.aiEvalResult.create).not.toHaveBeenCalled();
    expect(prisma.aiEvalRun.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'CANCELLED',
          summary: expect.objectContaining({ cancelled: true }),
        }),
      }),
    );
  });

  it('executeRun 在用例开始时写心跳，30 秒内只写一次', async () => {
    const { service, prisma, judge } = makeService();
    // findUnique 需要同时服务「整行加载」与「状态检查」两种调用。
    prisma.aiEvalRun.findUnique.mockImplementation((args: any) =>
      Promise.resolve(
        args?.select?.status
          ? { status: 'RUNNING' }
          : makeRun('STORED', [
              makeCase('c1', 'q1', 'a1'),
              makeCase('c2', 'q2', 'a2'),
            ]),
      ),
    );
    judge.judge.mockResolvedValue(verdictOf('solved'));

    await service.executeRun('run-1');

    const beats = prisma.aiEvalRun.updateMany.mock.calls.filter(
      ([arg]) => arg?.data && 'heartbeatAt' in arg.data,
    );
    expect(beats).toHaveLength(1);
    expect(beats[0][0]).toMatchObject({
      where: { id: 'run-1', status: 'RUNNING' },
      data: { heartbeatAt: expect.any(Date) },
    });
  });

  it('executeRun 取消后停止写心跳', async () => {
    const { service, prisma, judge } = makeService();
    let status = 'RUNNING';
    prisma.aiEvalRun.findUnique.mockImplementation((args: any) =>
      Promise.resolve(
        args?.select?.status
          ? { status }
          : makeRun('STORED', [
              makeCase('c1', 'q1', 'a1'),
              makeCase('c2', 'q2', 'a2'),
            ]),
      ),
    );
    prisma.aiEvalRun.updateMany.mockImplementation((args: any) =>
      Promise.resolve(
        args?.data && 'heartbeatAt' in args.data
          ? { count: status === 'RUNNING' ? 1 : 0 }
          : { count: 1 },
      ),
    );
    judge.judge.mockImplementation(async () => {
      status = 'CANCELLED';
      return verdictOf('solved');
    });

    await service.executeRun('run-1');

    const beats = prisma.aiEvalRun.updateMany.mock.calls.filter(
      ([arg]) => arg?.data && 'heartbeatAt' in arg.data,
    );
    // 第一条用例前写一次；取消被读到后不再写。
    expect(beats).toHaveLength(1);
  });

  it('executeRun 在判分后发现 CANCELLED 时丢弃结果并停止', async () => {
    const { service, prisma, judge } = makeService();
    prisma.aiEvalRun.findUnique
      .mockResolvedValueOnce(
        makeRun('STORED', [
          makeCase('c1', 'q1', 'a1'),
          makeCase('c2', 'q2', 'a2'),
        ]),
      )
      .mockResolvedValueOnce({ status: 'RUNNING' })
      .mockResolvedValueOnce({ status: 'CANCELLED' });
    judge.judge.mockResolvedValue(verdictOf('solved'));

    await service.executeRun('run-1');

    expect(judge.judge).toHaveBeenCalledTimes(1);
    expect(prisma.aiEvalResult.create).not.toHaveBeenCalled();
    expect(prisma.aiEvalRun.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'CANCELLED',
          summary: expect.objectContaining({ cancelled: true }),
        }),
      }),
    );
    // 判分已经发生的 token 仍要记入取消快照。
    expect(summaryOf(prisma).usage).toMatchObject({
      estimatedTokens: estimateEvalCaseTokens('q1', 'a1').totalTokens,
      exceeded: false,
    });
  });

  it('超出 token 预算时停止后续用例并落 FAILED', async () => {
    process.env.AI_EVAL_RUN_TOKEN_BUDGET = '200';
    const { service, prisma, judge } = makeService();
    const cases = [makeCase('c1', 'q1', 'a1'), makeCase('c2', 'q2', 'a2')];
    prisma.aiEvalRun.findUnique.mockResolvedValue(makeRun('STORED', cases));
    judge.judge.mockResolvedValue(verdictOf('solved'));

    const oneCase = estimateEvalCaseTokens('q1', 'a1').totalTokens;
    expect(oneCase).toBeLessThanOrEqual(200);
    expect(oneCase * 2).toBeGreaterThan(200);

    await service.executeRun('run-1');

    // 第一条正常判分，第二条在发调前被预算拦下。
    expect(judge.judge).toHaveBeenCalledTimes(1);
    expect(prisma.aiEvalResult.create).toHaveBeenCalledTimes(1);
    expect(prisma.aiEvalRun.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { id: 'run-1', status: 'RUNNING' },
        data: expect.objectContaining({
          status: 'FAILED',
          summary: expect.objectContaining({
            error: 'token budget exceeded',
            usage: {
              estimatedTokens: oneCase,
              budget: 200,
              budgetBasis: 'estimated-v1',
              exceeded: true,
              source: 'estimated',
              unavailableCalls: 0,
              byRole: {
                chat: {
                  role: 'chat',
                  calls: 0,
                  measuredCalls: 0,
                  unavailableCalls: 0,
                  promptTokens: 0,
                  completionTokens: 0,
                  totalTokens: 0,
                },
                judge: {
                  role: 'judge',
                  calls: 0,
                  measuredCalls: 0,
                  unavailableCalls: 0,
                  promptTokens: 0,
                  completionTokens: 0,
                  totalTokens: 0,
                },
              },
              estimatedCostUsd: 0,
              costConfigured: false,
            },
          }),
        }),
      }),
    );
  });

  it('预算内完成时把 usage 写入 COMPLETED summary', async () => {
    process.env.AI_EVAL_RUN_TOKEN_BUDGET = '10000';
    const { service, prisma, judge } = makeService();
    prisma.aiEvalRun.findUnique.mockResolvedValue(
      makeRun('STORED', [makeCase('c1', 'q1', 'a1')]),
    );
    judge.judge.mockResolvedValue(verdictOf('solved'));

    await service.executeRun('run-1');

    expect(summaryOf(prisma)).toMatchObject({
      mode: 'STORED',
      total: 1,
      solved: 1,
      usage: {
        estimatedTokens: estimateEvalCaseTokens('q1', 'a1').totalTokens,
        budget: 10000,
        exceeded: false,
        estimatedCostUsd: 0,
        costConfigured: false,
      },
    });
    expect(prisma.aiEvalRun.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'COMPLETED' }),
      }),
    );
  });

  it('配置价格时写入 estimatedCostUsd 与 costConfigured', async () => {
    process.env.AI_PRICE_INPUT_PER_1M = '1';
    process.env.AI_PRICE_OUTPUT_PER_1M = '2';
    const { service, prisma, judge } = makeService();
    const answer = 'a'.repeat(40);
    prisma.aiEvalRun.findUnique.mockResolvedValue(
      makeRun('STORED', [makeCase('c1', 'q1', answer)]),
    );
    judge.judge.mockResolvedValue(verdictOf('solved'));

    await service.executeRun('run-1');

    const estimate = estimateEvalCaseTokens('q1', answer);
    expect(estimate.completionTokens).toBeGreaterThan(0);
    const expectedCost = Number(
      (
        (estimate.promptTokens / 1_000_000) * 1 +
        (estimate.completionTokens / 1_000_000) * 2
      ).toFixed(6),
    );
    expect(summaryOf(prisma).usage).toMatchObject({
      estimatedTokens: estimate.totalTokens,
      budget: DEFAULT_EVAL_RUN_TOKEN_BUDGET,
      costConfigured: true,
      estimatedCostUsd: expectedCost,
    });
  });

  it('AI_EVAL_RUN_TOKEN_BUDGET <= 0 时关闭预算护栏', async () => {
    process.env.AI_EVAL_RUN_TOKEN_BUDGET = '0';
    const { service, prisma, judge } = makeService();
    prisma.aiEvalRun.findUnique.mockResolvedValue(
      makeRun('STORED', [
        makeCase('c1', 'q1', 'a1'),
        makeCase('c2', 'q2', 'a2'),
      ]),
    );
    judge.judge.mockResolvedValue(verdictOf('solved'));

    await service.executeRun('run-1');

    expect(judge.judge).toHaveBeenCalledTimes(2);
    expect(summaryOf(prisma)).toMatchObject({
      usage: { budget: 0, exceeded: false },
    });
  });

  it('预算超限与取消竞争时保持 CANCELLED', async () => {
    process.env.AI_EVAL_RUN_TOKEN_BUDGET = '200';
    const { service, prisma, judge } = makeService();
    const cases = [makeCase('c1', 'q1', 'a1'), makeCase('c2', 'q2', 'a2')];
    // 并发取消在 FAILED 条件更新之前落地：之后的状态检查一律读到 CANCELLED。
    let cancelled = false;
    prisma.aiEvalRun.findUnique.mockImplementation((args: any) =>
      Promise.resolve(
        args?.select?.status
          ? { status: cancelled ? 'CANCELLED' : 'RUNNING' }
          : makeRun('STORED', cases),
      ),
    );
    prisma.aiEvalRun.updateMany.mockImplementation((args: any) => {
      // 心跳写入先于终态更新；按 payload 区分，避免依赖调用顺序。
      if (args?.data && 'heartbeatAt' in args.data) {
        return Promise.resolve({ count: 1 });
      }
      // FAILED 条件更新输给并发取消
      if (args?.data?.status === 'FAILED') {
        cancelled = true;
        return Promise.resolve({ count: 0 });
      }
      return Promise.resolve({ count: 1 });
    });
    judge.judge.mockResolvedValue(verdictOf('solved'));

    await service.executeRun('run-1');

    expect(prisma.aiEvalRun.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'CANCELLED',
          summary: expect.objectContaining({ cancelled: true }),
        }),
      }),
    );
  });

  it('updateCase 校验归属并写入期望', async () => {
    const { service, prisma } = makeService();
    prisma.aiEvalCase.findUnique.mockResolvedValue({
      id: 'case-1',
      datasetId: 'ds-1',
    });
    prisma.aiEvalDataset.findUnique.mockResolvedValue({
      id: 'ds-1',
      cases: [],
      runs: [],
      _count: { cases: 0, runs: 0 },
    });

    await service.updateCase('ds-1', 'case-1', {
      expected: '必须提到 7 天退款',
    });

    expect(prisma.aiEvalCase.update).toHaveBeenCalledWith({
      where: { id: 'case-1' },
      data: expect.objectContaining({
        expected: '必须提到 7 天退款',
      }),
    });
  });

  it('updateCase 对 expect 做字段级合并，保留动作与意图条件', async () => {
    const { service, prisma } = makeService();
    prisma.aiEvalCase.findUnique.mockResolvedValue({
      id: 'case-1',
      datasetId: 'ds-1',
      expect: {
        mustMention: ['旧要点'],
        confirmAction: 'refund.create',
        forbidExecution: true,
        intent: 'refund',
      },
    });
    prisma.aiEvalDataset.findUnique.mockResolvedValue({
      id: 'ds-1',
      cases: [],
      runs: [],
      _count: { cases: 0, runs: 0 },
    });

    await service.updateCase('ds-1', 'case-1', {
      expect: { mustMention: ['新要点'] },
    });

    expect(prisma.aiEvalCase.update).toHaveBeenCalledWith({
      where: { id: 'case-1' },
      data: expect.objectContaining({
        expect: {
          mustMention: ['新要点'],
          confirmAction: 'refund.create',
          forbidExecution: true,
          intent: 'refund',
        },
      }),
    });
  });

  it('updateCase 未传 expect 时不动判分条件', async () => {
    const { service, prisma } = makeService();
    prisma.aiEvalCase.findUnique.mockResolvedValue({
      id: 'case-1',
      datasetId: 'ds-1',
      expect: { mustMention: ['旧要点'] },
    });
    prisma.aiEvalDataset.findUnique.mockResolvedValue({
      id: 'ds-1',
      cases: [],
      runs: [],
      _count: { cases: 0, runs: 0 },
    });

    await service.updateCase('ds-1', 'case-1', { answer: '新答案' });

    const data = prisma.aiEvalCase.update.mock.calls[0][0].data;
    expect(data).not.toHaveProperty('expect');
  });

  it('判分以 expect 为准，expected 只在 expect 为空时回填', () => {
    const { service } = makeService();
    const resolve = (item: any) => (service as any).resolveExpectation(item);

    expect(
      resolve({
        expect: { mustMention: ['新要点'] },
        expected: '旧期望',
      }),
    ).toEqual({ mustMention: ['新要点'] });
    expect(resolve({ expect: {}, expected: '旧期望' })).toEqual({
      mustMention: ['旧期望'],
    });
  });

  it('deleteCase 校验归属后删除', async () => {
    const { service, prisma } = makeService();
    prisma.aiEvalCase.findUnique.mockResolvedValue({
      id: 'case-1',
      datasetId: 'ds-1',
    });
    prisma.aiEvalDataset.findUnique.mockResolvedValue({
      id: 'ds-1',
      cases: [],
      runs: [],
      _count: { cases: 0, runs: 0 },
    });

    await service.deleteCase('ds-1', 'case-1');

    expect(prisma.aiEvalCase.delete).toHaveBeenCalledWith({
      where: { id: 'case-1' },
    });
  });

  it('addCases 拒绝 e2e 数据集且不写库', async () => {
    const { service, prisma } = makeService();
    // mock 跟随 select：若生产代码不再取 name，守卫拿不到名字，测试会变红。
    prisma.aiEvalDataset.findUnique.mockImplementation((args: any) =>
      Promise.resolve(
        args?.select?.name ? { id: 'e2e-1', name: 'e2e:abc' } : { id: 'e2e-1' },
      ),
    );

    await expect(
      service.addCases('e2e-1', {
        cases: [{ question: 'q', answer: 'a' }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.aiEvalCase.createMany).not.toHaveBeenCalled();
  });

  it('updateCase 拒绝 e2e 数据集且不写库', async () => {
    const { service, prisma } = makeService();
    prisma.aiEvalCase.findUnique.mockResolvedValue({
      id: 'case-1',
      datasetId: 'e2e-1',
    });
    prisma.aiEvalDataset.findUnique.mockImplementation((args: any) =>
      Promise.resolve(
        args?.select?.name ? { id: 'e2e-1', name: 'E2E:abc' } : { id: 'e2e-1' },
      ),
    );

    await expect(
      service.updateCase('e2e-1', 'case-1', { expected: 'x' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.aiEvalCase.update).not.toHaveBeenCalled();
  });

  it('deleteCase 拒绝 e2e 数据集且不删库', async () => {
    const { service, prisma } = makeService();
    prisma.aiEvalCase.findUnique.mockResolvedValue({
      id: 'case-1',
      datasetId: 'e2e-1',
    });
    prisma.aiEvalDataset.findUnique.mockImplementation((args: any) =>
      Promise.resolve(
        args?.select?.name ? { id: 'e2e-1', name: 'e2e:abc' } : { id: 'e2e-1' },
      ),
    );

    await expect(service.deleteCase('e2e-1', 'case-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.aiEvalCase.delete).not.toHaveBeenCalled();
  });

  describe('addCases 题干规范化查重', () => {
    function wireDataset(prisma: any, existingQuestions: string[]) {
      prisma.aiEvalDataset.findUnique.mockImplementation((args: any) =>
        Promise.resolve(
          args?.select?.name
            ? { id: 'ds-1', name: 'qa' }
            : {
                id: 'ds-1',
                name: 'qa',
                cases: [],
                runs: [],
                _count: { runs: 0, cases: existingQuestions.length },
              },
        ),
      );
      prisma.aiEvalCase.findMany.mockResolvedValue(
        existingQuestions.map((question) => ({ question })),
      );
    }

    it('空白差异判为同数据集重复', async () => {
      const { service, prisma } = makeService();
      wireDataset(prisma, ['我的订单到哪了']);

      const result = await service.addCases('ds-1', {
        cases: [{ question: '  我的订单到哪了  ', answer: 'a' }],
      });

      expect(prisma.aiEvalCase.createMany).not.toHaveBeenCalled();
      expect(result.created).toBe(0);
      expect(result.skipped).toEqual([
        { question: '  我的订单到哪了  ', reason: 'DUPLICATE_IN_DATASET' },
      ]);
    });

    it('全半角差异判为重复', async () => {
      const { service, prisma } = makeService();
      wireDataset(prisma, ['我的订单到哪了？']);

      const result = await service.addCases('ds-1', {
        cases: [{ question: '我的订单到哪了?', answer: 'a' }],
      });

      expect(prisma.aiEvalCase.createMany).not.toHaveBeenCalled();
      expect(result.skipped[0].reason).toBe('DUPLICATE_IN_DATASET');
    });

    it('大小写差异判为重复', async () => {
      const { service, prisma } = makeService();
      wireDataset(prisma, ['Refund Policy']);

      const result = await service.addCases('ds-1', {
        cases: [{ question: 'REFUND   policy', answer: 'a' }],
      });

      expect(prisma.aiEvalCase.createMany).not.toHaveBeenCalled();
      expect(result.skipped[0].reason).toBe('DUPLICATE_IN_DATASET');
    });

    it('同批次内部重复：只写一条，其余标记批内重复', async () => {
      const { service, prisma } = makeService();
      wireDataset(prisma, []);

      const result = await service.addCases('ds-1', {
        cases: [
          { question: '怎么退款', answer: 'a' },
          { question: ' 怎么退款 ', answer: 'b' },
          { question: '怎么开发票', answer: 'c' },
        ],
      });

      expect(prisma.aiEvalCase.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({ question: '怎么退款' }),
            expect.objectContaining({ question: '怎么开发票' }),
          ]),
        }),
      );
      expect(prisma.aiEvalCase.createMany.mock.calls[0][0].data).toHaveLength(
        2,
      );
      expect(result.created).toBe(2);
      expect(result.skipped).toEqual([
        { question: ' 怎么退款 ', reason: 'DUPLICATE_IN_BATCH' },
      ]);
    });
  });

  it('addCases 守卫同样拦截空白前缀', async () => {
    const { service, prisma } = makeService();
    prisma.aiEvalDataset.findUnique.mockImplementation((args: any) =>
      Promise.resolve(
        args?.select?.name ? { id: 'e2e-2', name: ' e2e:x' } : { id: 'e2e-2' },
      ),
    );

    await expect(
      service.addCases('e2e-2', {
        cases: [{ question: 'q', answer: 'a' }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.aiEvalCase.createMany).not.toHaveBeenCalled();
  });

  it('createDataset 拒绝 e2e 前缀并允许普通名称', async () => {
    const { service, prisma } = makeService();
    prisma.aiEvalDataset.create.mockImplementation((args: any) =>
      Promise.resolve({ id: 'ds-new', name: args.data.name }),
    );

    await expect(
      service.createDataset({ name: ' e2e:abc' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.aiEvalDataset.create).not.toHaveBeenCalled();

    await service.createDataset({ name: '售后退款回归集' });
    expect(prisma.aiEvalDataset.create).toHaveBeenCalledWith({
      data: {
        name: '售后退款回归集',
        description: undefined,
        createdBy: undefined,
      },
    });
  });

  it('startRun 持久化 mode 与 baselineRunId', async () => {
    const { service, prisma } = makeService();
    prisma.aiEvalDataset.findUnique.mockResolvedValue({
      id: 'ds-1',
      cases: [makeCase('c1', 'q1', 'a1')],
    });
    prisma.aiEvalRun.findUnique
      // 基线校验
      .mockResolvedValueOnce({
        id: 'baseline-1',
        datasetId: 'ds-1',
        status: 'COMPLETED',
      })
      // 后台 executeRun 读本次 run（返回 null 即提前结束）
      .mockResolvedValueOnce(null);
    prisma.aiEvalRun.create.mockResolvedValue({
      id: 'run-new',
      mode: 'LIVE',
      baselineRunId: 'baseline-1',
    });

    const created = await service.startRun('ds-1', 'admin-1', {
      mode: 'LIVE',
      baselineRunId: 'baseline-1',
    });

    expect(created).toMatchObject({ id: 'run-new', mode: 'LIVE' });
    expect(prisma.aiEvalRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        datasetId: 'ds-1',
        createdBy: 'admin-1',
        mode: 'LIVE',
        baselineRunId: 'baseline-1',
      }),
    });
  });

  it('startRun 写入判官规格六字段与指标族', async () => {
    const { service, prisma } = makeService();
    prisma.aiEvalDataset.findUnique.mockResolvedValue({
      id: 'ds-1',
      cases: [makeCase('c1', 'q1', 'a1')],
    });
    prisma.aiEvalRun.create.mockResolvedValue({ id: 'run-new' });
    prisma.aiEvalRun.findUnique.mockResolvedValue(null); // executeRun 提前结束

    await service.startRun('ds-1', 'admin-1', { mode: 'STORED' });

    const data = prisma.aiEvalRun.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      judgeSpecVersion: 'task-judge-v2',
      judgePromptHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      judgeModel: 'llama-3.3-70b-versatile',
      judgeVendor: 'groq',
      judgeSampleCount: 1,
      metricFamily: 'verdict3',
    });
  });

  it('内部运行 COMPLETED 时写入用例快照与代码版本', async () => {
    process.env.APP_VERSION = 'sha-abc123';
    try {
      const { service, prisma, judge } = makeService();
      const cases = [makeCase('c1', 'q1', 'a1'), makeCase('c2', 'q2', 'a2')];
      prisma.aiEvalRun.findUnique.mockResolvedValue(makeRun('STORED', cases));
      judge.judge.mockResolvedValue(verdictOf('solved'));

      await service.executeRun('run-1');

      const completed = prisma.aiEvalRun.updateMany.mock.calls
        .map(([arg]: any[]) => arg)
        .find((arg: any) => arg?.data?.status === 'COMPLETED');
      expect(completed).toBeTruthy();
      // 独立复算：sha256("c1\nc2")，不依赖被测实现里的 hash 函数。
      const expectedHash = createHash('sha256').update('c1\nc2').digest('hex');
      expect(completed.data.datasetSnapshot).toEqual({
        hash: expectedHash,
        cases: ['c1', 'c2'],
      });
      expect(completed.data.codeVersion).toBe('sha-abc123');
    } finally {
      delete process.env.APP_VERSION;
    }
  });

  it('快照 hash 与用例顺序无关，同批用例复算一致', () => {
    expect(snapshotHashOfCaseIds(['c2', 'c1'])).toBe(
      snapshotHashOfCaseIds(['c1', 'c2']),
    );
    expect(snapshotHashOfCaseIds(['c1', 'c2'])).not.toBe(
      snapshotHashOfCaseIds(['c1', 'c3']),
    );
  });

  it('单条判官失败留痕后继续，运行仍 COMPLETED', async () => {
    const { service, prisma, judge } = makeService();
    prisma.aiEvalRun.findUnique.mockResolvedValue(
      makeRun('STORED', [
        makeCase('c1', 'q1', 'a1'),
        makeCase('c2', 'q2', 'a2'),
      ]),
    );
    judge.judge
      .mockRejectedValueOnce(
        new JudgeFailureError('timeout', 'judge timed out'),
      )
      .mockResolvedValueOnce(verdictOf('solved'));

    await service.executeRun('run-1');

    const completed = prisma.aiEvalRun.updateMany.mock.calls
      .map(([arg]: any[]) => arg)
      .find((arg: any) => arg?.data?.status === 'COMPLETED');
    expect(completed).toBeTruthy();
    expect(completed.data.summary).toMatchObject({
      total: 2,
      solved: 1,
      unsolved: 0,
      judgeErrors: 1,
    });
    // 失败的那条留痕：verdict 留空 + judgeErrorKind，不记成 unsolved。
    const errorRow = prisma.aiEvalResult.create.mock.calls[0][0].data;
    expect(errorRow).toMatchObject({
      caseId: 'c1',
      verdict: null,
      judgeErrorKind: 'timeout',
      reason: expect.stringContaining('judge_error'),
    });
  });

  it('连续 5 次判官失败整单 FAILED，summary 保留已判分计数', async () => {
    const { service, prisma, judge } = makeService();
    const cases = [
      makeCase('c0', 'q0', 'a0'),
      makeCase('c1', 'q1', 'a1'),
      makeCase('c2', 'q2', 'a2'),
      makeCase('c3', 'q3', 'a3'),
      makeCase('c4', 'q4', 'a4'),
      makeCase('c5', 'q5', 'a5'),
    ];
    prisma.aiEvalRun.findUnique.mockResolvedValue(makeRun('STORED', cases));
    judge.judge
      .mockResolvedValueOnce(verdictOf('solved'))
      .mockRejectedValue(new JudgeFailureError('output_format', 'not json'));

    await expect(service.executeRun('run-1')).rejects.toThrow(/judge/i);

    const updated = prisma.aiEvalRun.updateMany.mock.calls
      .map(([arg]: any[]) => arg)
      .filter((arg: any) => arg?.data?.status);
    const failed = updated.find((arg: any) => arg.data.status === 'FAILED');
    expect(failed).toBeTruthy();
    expect(updated.some((arg: any) => arg.data.status === 'COMPLETED')).toBe(
      false,
    );
    expect(failed.data.summary).toMatchObject({
      total: 6,
      solved: 1,
      judgeErrors: 5,
      // 整单因判官整体不可用而失败，类别要能落库，而不是只剩一段错误文本。
      failureCategory: 'judge_unavailable',
    });
  });

  it('summary 分账：judged / validPassRate / judgeErrorRate 与 passRate 各算各的', async () => {
    const { service, prisma, judge } = makeService();
    const cases = Array.from({ length: 10 }, (_, i) =>
      makeCase(`c${i}`, `q${i}`, `a${i}`),
    );
    prisma.aiEvalRun.findUnique.mockResolvedValue(makeRun('STORED', cases));
    let calls = 0;
    judge.judge.mockImplementation(async () => {
      calls += 1;
      // 前 2 条判官失败，其余 8 条判过：4 条 solved + 4 条 unsolved。
      if (calls <= 2) {
        throw new JudgeFailureError('timeout', 'judge timed out');
      }
      return verdictOf(calls <= 6 ? 'solved' : 'unsolved');
    });

    await service.executeRun('run-1');

    const summary = summaryOf(prisma);
    expect(summary).toMatchObject({
      total: 10,
      processed: 10,
      judged: 8,
      solved: 4,
      unsolved: 4,
      judgeErrors: 2,
      judgeErrorKinds: { timeout: 2 },
      executionError: 0,
      // 任务成功率语义不变：分母永远是全部用例。
      passRate: 0.4,
      // 有效通过率只在判过的条目里算：4/8，不能拿总失败数稀释。
      validPassRate: 0.5,
      judgeErrorRate: 0.2,
      executionErrorRate: 0,
      failureCategory: null,
      metricFamily: 'verdict3',
      metricSpecVersion: 'verdict3-1',
    });
  });

  describe('getRun 结果分页', () => {
    function wireRun(prisma: any, status: string) {
      prisma.aiEvalRun.findUnique.mockResolvedValue({
        id: 'run-1',
        status,
        datasetId: 'ds-1',
      });
    }

    it('2000 条结果默认返回 50 条并带总数', async () => {
      const { service, prisma } = makeService();
      wireRun(prisma, 'COMPLETED');
      prisma.aiEvalResult.count.mockResolvedValue(2000);
      prisma.aiEvalResult.findMany.mockResolvedValue(
        Array.from({ length: 50 }, (_, i) => ({ id: `r-${i}` })),
      );

      const run = await service.getRun('run-1');

      expect(run.results).toHaveLength(50);
      expect(run.resultsTotal).toBe(2000);
      expect(run.page).toBe(1);
      expect(run.pageSize).toBe(50);
      expect(prisma.aiEvalResult.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 50 }),
      );
    });

    it('页大小超过 200 直接 400，不查库', async () => {
      const { service, prisma } = makeService();
      wireRun(prisma, 'COMPLETED');

      await expect(
        service.getRun('run-1', { page: 1, pageSize: 10000 }),
      ).rejects.toThrow('pageSize');
      expect(prisma.aiEvalResult.findMany).not.toHaveBeenCalled();
    });

    it('RUNNING 按创建时间倒序，让最新结果落在第一页', async () => {
      const { service, prisma } = makeService();
      wireRun(prisma, 'RUNNING');

      await service.getRun('run-1');

      expect(prisma.aiEvalResult.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { createdAt: 'desc' } }),
      );
    });

    it('终态运行保持创建时间正序', async () => {
      const { service, prisma } = makeService();
      wireRun(prisma, 'COMPLETED');

      await service.getRun('run-1');

      expect(prisma.aiEvalResult.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { createdAt: 'asc' } }),
      );
    });
  });

  describe('addCases 返回新建用例标识', () => {
    it('分页后仍能拿到本次新建用例的 id', async () => {
      const { service, prisma } = makeService();
      prisma.aiEvalDataset.findUnique.mockResolvedValue({
        id: 'ds-1',
        name: 'qa',
        cases: [],
        runs: [],
        _count: { cases: 120, runs: 0 },
      });
      prisma.aiEvalCase.findMany.mockImplementation((args: any) => {
        if (args?.where?.question?.in) {
          return Promise.resolve(
            args.where.question.in.map((question: string, i: number) => ({
              id: `new-${i}`,
              question,
            })),
          );
        }
        return Promise.resolve([]);
      });

      const result = await service.addCases('ds-1', {
        cases: [{ question: '新问题', answer: 'a' }],
      });

      expect(result.created).toBe(1);
      expect(result.createdCases).toEqual([
        { id: 'new-0', question: '新问题' },
      ]);
    });
  });

  describe('getDataset 用例分页', () => {
    it('120 条用例默认返回 50 条，总数取 _count.cases', async () => {
      const { service, prisma } = makeService();
      prisma.aiEvalDataset.findUnique.mockResolvedValue({
        id: 'ds-1',
        name: 'qa',
        cases: [],
        runs: [],
        _count: { runs: 2, cases: 120 },
      });
      prisma.aiEvalCase.findMany.mockResolvedValue(
        Array.from({ length: 50 }, (_, i) => ({ id: `c-${i}` })),
      );

      const dataset = await service.getDataset('ds-1');

      expect(dataset.cases).toHaveLength(50);
      expect(dataset.casesTotal).toBe(120);
      expect(dataset.page).toBe(1);
      expect(dataset.pageSize).toBe(50);
      expect(prisma.aiEvalCase.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 50 }),
      );
    });

    it('页大小超过 200 直接 400', async () => {
      const { service } = makeService();

      await expect(
        service.getDataset('ds-1', { pageSize: 10000 }),
      ).rejects.toThrow('pageSize');
    });
  });

  describe('getCaseHistory 单用例时间线', () => {
    it('三次运行的判定按运行时间升序返回', async () => {
      const { service, prisma } = makeService();
      prisma.aiEvalRun.findUnique.mockResolvedValueOnce({
        id: 'run-3',
        datasetId: 'ds-1',
        mode: 'STORED',
      });
      prisma.aiEvalCase.findUnique.mockResolvedValueOnce({
        id: 'case-1',
        datasetId: 'ds-1',
        question: '怎么退款',
        tags: ['refund'],
        sourceFeedbackId: 'fb-1',
      });
      prisma.aiEvalRun.findMany.mockResolvedValueOnce([
        {
          id: 'run-1',
          status: 'COMPLETED',
          mode: 'STORED',
          createdAt: new Date('2026-11-01T00:00:00Z'),
          scope: 'full',
          isBaseline: false,
          summary: { metricFamily: 'verdict3' },
          results: [
            {
              verdict: 'unsolved',
              answerVerdict: null,
              judgeErrorKind: null,
              score: 0,
              answerScore: null,
            },
          ],
        },
        {
          id: 'run-2',
          status: 'COMPLETED',
          mode: 'STORED',
          createdAt: new Date('2026-11-02T00:00:00Z'),
          scope: 'full',
          isBaseline: true,
          summary: { metricFamily: 'verdict3' },
          results: [
            {
              verdict: 'solved',
              answerVerdict: null,
              judgeErrorKind: null,
              score: 0.9,
              answerScore: null,
            },
          ],
        },
        {
          id: 'run-3',
          status: 'COMPLETED',
          mode: 'STORED',
          createdAt: new Date('2026-11-03T00:00:00Z'),
          scope: 'full',
          isBaseline: false,
          summary: { metricFamily: 'verdict3' },
          results: [
            {
              verdict: 'unsolved',
              answerVerdict: null,
              judgeErrorKind: null,
              score: 0,
              answerScore: null,
            },
          ],
        },
      ]);

      const history = await service.getCaseHistory('run-3', 'case-1');

      expect(history.caseId).toBe('case-1');
      expect(history.case.question).toBe('怎么退款');
      expect(history.timeline.map((point) => point.runId)).toEqual([
        'run-1',
        'run-2',
        'run-3',
      ]);
      expect(history.timeline.map((point) => point.outcome)).toEqual([
        'fail',
        'pass',
        'fail',
      ]);
      expect(history.timeline[1].isBaseline).toBe(true);
      expect(prisma.aiEvalRun.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            datasetId: 'ds-1',
            results: { some: { caseId: 'case-1' } },
            // 运行中/失败的过程快照不参与时间线（6.3）。
            status: { notIn: ['RUNNING', 'FAILED'] },
          },
          orderBy: [{ startedAt: 'asc' }, { id: 'asc' }],
        }),
      );
    });

    it('运行不存在时 404', async () => {
      const { service, prisma } = makeService();
      prisma.aiEvalRun.findUnique.mockResolvedValueOnce(null);

      await expect(service.getCaseHistory('run-x', 'case-1')).rejects.toThrow(
        'Eval run not found',
      );
    });

    it('用例不属于该运行所在数据集时 404', async () => {
      const { service, prisma } = makeService();
      prisma.aiEvalRun.findUnique.mockResolvedValueOnce({
        id: 'run-1',
        datasetId: 'ds-1',
        mode: 'STORED',
      });
      prisma.aiEvalCase.findUnique.mockResolvedValueOnce({
        id: 'case-other',
        datasetId: 'ds-2',
        question: '别的数据集',
        tags: [],
        sourceFeedbackId: null,
      });

      await expect(
        service.getCaseHistory('run-1', 'case-other'),
      ).rejects.toThrow('Case not found in this run dataset');
    });
  });

  describe('getRunDiff 两次运行四分类', () => {
    function answerResult(caseId: string, answerVerdict: string) {
      return {
        caseId,
        answerVerdict,
        verdict: null,
        judgeErrorKind:
          answerVerdict === 'judge_error' ? 'output_format' : null,
        case: { question: `问题-${caseId}` },
      };
    }

    function stubDiffRuns(
      prisma: ReturnType<typeof makeService>['prisma'],
      currentResults: ReturnType<typeof answerResult>[] = [],
    ) {
      // getRunDiff 先读当前 run，再读基线 run。
      prisma.aiEvalRun.findUnique
        .mockResolvedValueOnce({
          id: 'run-3',
          datasetId: 'ds-1',
          baselineRunId: 'run-2',
          mode: 'EXTERNAL',
          summary: { metricFamily: 'answer_accuracy-v3' },
          results: currentResults,
        })
        .mockResolvedValueOnce({
          id: 'run-2',
          datasetId: 'ds-1',
          mode: 'EXTERNAL',
          createdAt: new Date('2026-11-02T00:00:00Z'),
          summary: { metricFamily: 'answer_accuracy-v3' },
          results: [
            answerResult('c-new', 'correct'),
            answerResult('c-regressed', 'correct'),
            answerResult('c-fixed', 'incorrect'),
            answerResult('c-still', 'incorrect'),
            answerResult('c-judge', 'correct'),
          ],
        });
      // 基线之前的 run-1：c-regressed 已经失败过，属于「修复后再次失败」。
      prisma.aiEvalRun.findMany.mockResolvedValueOnce([
        {
          results: [
            {
              caseId: 'c-regressed',
              answerVerdict: 'incorrect',
              verdict: null,
            },
            { caseId: 'c-fixed', answerVerdict: 'incorrect', verdict: null },
          ],
        },
      ]);
    }

    it('新增失败/修复/回退/仍失败各自归类，未结论的不计入', async () => {
      const { service, prisma } = makeService();
      stubDiffRuns(prisma, [
        answerResult('c-new', 'incorrect'),
        answerResult('c-regressed', 'incorrect'),
        answerResult('c-fixed', 'correct'),
        answerResult('c-still', 'incorrect'),
        answerResult('c-judge', 'judge_error'),
        {
          caseId: 'c-missing',
          answerVerdict: 'correct',
          verdict: null,
          judgeErrorKind: null,
          case: { question: '基线没跑到的用例' },
        },
      ]);

      const diff = await service.getRunDiff('run-3');

      expect(diff.baselineRunId).toBe('run-2');
      expect(diff.metricFamily).toBe('answer_accuracy-v3');
      expect(diff.counts!).toEqual({
        newFailure: 1,
        fixed: 1,
        regressed: 1,
        stillFailing: 1,
      });
      expect(diff.classes!.newFailure.map((item) => item.caseId)).toEqual([
        'c-new',
      ]);
      expect(diff.classes!.fixed.map((item) => item.caseId)).toEqual([
        'c-fixed',
      ]);
      expect(diff.classes!.regressed.map((item) => item.caseId)).toEqual([
        'c-regressed',
      ]);
      expect(diff.classes!.stillFailing.map((item) => item.caseId)).toEqual([
        'c-still',
      ]);
      expect(diff.classes!.newFailure[0].question).toBe('问题-c-new');
      expect(diff.comparability).toEqual({
        compared: 4,
        undecided: 1,
        missingBaseline: 1,
      });
      expect(diff.note).toContain('不构成统计显著性');
    });

    it('未显式传基线时回退到 run.baselineRunId', async () => {
      const { service, prisma } = makeService();
      stubDiffRuns(prisma);
      prisma.aiEvalRun.findUnique.mockResolvedValueOnce({
        id: 'run-3',
        datasetId: 'ds-1',
        baselineRunId: 'run-2',
        mode: 'EXTERNAL',
        summary: { metricFamily: 'answer_accuracy-v3' },
        results: [],
      });

      const diff = await service.getRunDiff('run-3');

      expect(diff.baselineRunId).toBe('run-2');
    });

    it('运行没有基线且未显式传时 400', async () => {
      const { service, prisma } = makeService();
      prisma.aiEvalRun.findUnique.mockResolvedValueOnce({
        id: 'run-3',
        datasetId: 'ds-1',
        baselineRunId: null,
        mode: 'EXTERNAL',
        summary: { metricFamily: 'answer_accuracy-v3' },
      });

      await expect(service.getRunDiff('run-3')).rejects.toThrow(
        'Run has no baseline',
      );
    });

    it('跨数据集或跨指标族拒绝相减', async () => {
      const { service, prisma } = makeService();
      prisma.aiEvalRun.findUnique
        .mockResolvedValueOnce({
          id: 'run-3',
          datasetId: 'ds-1',
          baselineRunId: 'run-2',
          mode: 'EXTERNAL',
          summary: { metricFamily: 'answer_accuracy-v3' },
        })
        .mockResolvedValueOnce({
          id: 'run-2',
          datasetId: 'ds-2',
          mode: 'EXTERNAL',
          summary: { metricFamily: 'answer_accuracy-v3' },
          results: [],
        });

      await expect(service.getRunDiff('run-3')).rejects.toThrow('same dataset');
    });
  });

  describe('getRunCalibration 判官校准', () => {
    function taskResult(
      caseId: string,
      verdict: string,
      judgeErrorKind: string | null = null,
    ) {
      return {
        caseId,
        verdict,
        answerVerdict: null,
        judgeErrorKind,
        reason: `judge:${verdict}`,
        case: { question: `问题-${caseId}` },
      };
    }

    function humanAnnotation(caseId: string, correctness: string) {
      return {
        caseId,
        labelerId: 'admin-1',
        turn: 0,
        source: 'human',
        correctness,
        comment: `备注-${caseId}`,
      };
    }

    function stubRun(
      prisma: ReturnType<typeof makeService>['prisma'],
      results: ReturnType<typeof taskResult>[],
    ) {
      prisma.aiEvalRun.findUnique.mockResolvedValueOnce({
        id: 'run-cal',
        datasetId: 'ds-1',
        mode: 'STORED',
        summary: { metricFamily: 'verdict3' },
        results,
      });
    }

    it('样本不足 20 条：返回 insufficientSample，不给一致率百分比', async () => {
      const { service, prisma } = makeService();
      stubRun(
        prisma,
        Array.from({ length: 10 }, (_, i) =>
          taskResult(`c${i}`, 'solved'),
        ),
      );
      // 10 条人工标注，其中 c0/c1/c2 与判官结论不一致。
      prisma.aiEvalAnnotation.findMany.mockResolvedValueOnce(
        Array.from({ length: 10 }, (_, i) =>
          humanAnnotation(`c${i}`, i < 3 ? 'unsolved' : 'solved'),
        ),
      );

      const calibration = await service.getRunCalibration('run-cal');

      expect(calibration.status).toBe('insufficientSample');
      expect(calibration.n).toBe(10);
      expect(calibration.threshold).toBe(20);
      expect(calibration.disagreements).toHaveLength(3);
      expect(calibration.disagreements[0]).toMatchObject({
        caseId: 'c0',
        judgeVerdict: 'solved',
        humanCorrectness: 'unsolved',
        judgeReason: 'judge:solved',
        humanComment: '备注-c0',
      });
      // 样本不足不得给出百分比结论：字段本身不存在，而不是 0。
      expect(calibration).not.toHaveProperty('agreementRate');
      expect(calibration.note).toContain('样本不足');
    });

    it('样本充足时给出一致率、样本量与逐条分歧明细', async () => {
      const { service, prisma } = makeService();
      stubRun(
        prisma,
        Array.from({ length: 22 }, (_, i) =>
          taskResult(`c${i}`, 'solved'),
        ),
      );
      prisma.aiEvalAnnotation.findMany.mockResolvedValueOnce([
        ...Array.from({ length: 17 }, (_, i) => humanAnnotation(`c${i}`, 'solved')),
        ...Array.from({ length: 5 }, (_, i) =>
          humanAnnotation(`c${17 + i}`, 'unsolved'),
        ),
        // 人工标了判官不产出的类别：不计入分母。
        {
          ...humanAnnotation('c-unsafe', 'unsafe'),
        },
        // 预标注不参与校准。
        {
          caseId: 'c-prelabel',
          labelerId: 'prelabel',
          turn: 0,
          source: 'prelabel',
          correctness: 'solved',
          comment: '',
        },
      ]);

      const calibration = await service.getRunCalibration('run-cal');

      expect(calibration.status).toBe('ok');
      expect(calibration.n).toBe(22);
      expect(calibration.excluded).toBe(2);
      expect(calibration).toMatchObject({ agreements: 17, agreementRate: 77.3 });
      expect(calibration.disagreements).toHaveLength(5);
      expect(calibration.disagreements.map((d) => d.caseId)).toEqual([
        'c17',
        'c18',
        'c19',
        'c20',
        'c21',
      ]);
    });

    it('判官失败没有结论的标注不计入比对', async () => {
      const { service, prisma } = makeService();
      stubRun(prisma, [
        taskResult('c1', 'solved'),
        taskResult('c2', 'solved', 'output_format'),
      ]);
      prisma.aiEvalAnnotation.findMany.mockResolvedValueOnce([
        humanAnnotation('c1', 'solved'),
        humanAnnotation('c2', 'unsolved'),
      ]);

      const calibration = await service.getRunCalibration('run-cal');

      expect(calibration.n).toBe(1);
      expect(calibration.excluded).toBe(1);
    });

    it('运行不存在时 404', async () => {
      const { service, prisma } = makeService();
      prisma.aiEvalRun.findUnique.mockResolvedValueOnce(null);

      await expect(service.getRunCalibration('missing')).rejects.toThrow(
        'Eval run not found',
      );
    });
  });
});

describe('AiEvalDatasetService advancePendingVerification', () => {
  function stubPendingRun(
    prisma: ReturnType<typeof makeService>['prisma'],
    results: Array<{
      caseId: string;
      verdict: string | null;
      judgeErrorKind?: string | null;
    }>,
  ) {
    (prisma as any).aiAnswerFeedback = {
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    };
    prisma.aiEvalRun.findUnique.mockResolvedValueOnce({
      id: 'run-1',
      mode: 'STORED',
      summary: { metricFamily: 'verdict3' },
    });
    prisma.aiEvalResult.findMany.mockResolvedValueOnce(
      results.map((item) => ({
        answerVerdict: null,
        judgeErrorKind: null,
        ...item,
      })),
    );
    prisma.aiEvalCase.findMany.mockResolvedValueOnce(
      results.map((item, index) => ({
        id: item.caseId,
        sourceFeedbackId: `fb-${index + 1}`,
      })),
    );
    return (prisma as any).aiAnswerFeedback;
  }

  it('待验用例判定通过：自动关闭并清掉回退时间', async () => {
    const { service, prisma } = makeService();
    const feedback = stubPendingRun(prisma, [
      { caseId: 'case-1', verdict: 'solved' },
      { caseId: 'case-2', verdict: 'unsolved' },
    ]);

    const result = await service.advancePendingVerification('run-1');

    expect(result).toEqual({ closed: 1, regressed: 1 });
    expect(feedback.updateMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['fb-1'] },
        resolution: 'FIXED_PENDING_VERIFY',
      },
      data: {
        resolution: 'CLOSED',
        reviewStatus: 'REVIEWED',
        reviewedAt: expect.any(Date),
        regressedAt: null,
      },
    });
  });

  it('待验用例判定失败：打回 OPEN 并记回退时间', async () => {
    const { service, prisma } = makeService();
    const feedback = stubPendingRun(prisma, [
      { caseId: 'case-1', verdict: 'solved' },
      { caseId: 'case-2', verdict: 'unsolved' },
    ]);

    await service.advancePendingVerification('run-1');

    expect(feedback.updateMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['fb-2'] },
        resolution: 'FIXED_PENDING_VERIFY',
      },
      data: {
        resolution: 'OPEN',
        reviewStatus: 'PENDING',
        reviewedBy: null,
        reviewedAt: null,
        regressedAt: expect.any(Date),
      },
    });
  });

  it('判官没给出结论时不推进状态，避免把故障当失败', async () => {
    const { service, prisma } = makeService();
    const feedback = stubPendingRun(prisma, [
      { caseId: 'case-1', verdict: null, judgeErrorKind: 'timeout' },
    ]);

    const result = await service.advancePendingVerification('run-1');

    expect(result).toEqual({ closed: 0, regressed: 0 });
    expect(feedback.updateMany).not.toHaveBeenCalled();
  });

  it('没有关联反馈的用例不写任何状态', async () => {
    const { service, prisma } = makeService();
    prisma.aiEvalRun.findUnique.mockResolvedValueOnce({
      id: 'run-1',
      mode: 'STORED',
      summary: { metricFamily: 'verdict3' },
    });
    prisma.aiEvalResult.findMany.mockResolvedValueOnce([
      { caseId: 'case-1', verdict: 'solved', answerVerdict: null, judgeErrorKind: null },
    ]);
    prisma.aiEvalCase.findMany.mockResolvedValueOnce([
      { id: 'case-1', sourceFeedbackId: null },
    ]);
    (prisma as any).aiAnswerFeedback = {
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    };

    const result = await service.advancePendingVerification('run-1');

    expect(result).toEqual({ closed: 0, regressed: 0 });
    expect((prisma as any).aiAnswerFeedback.updateMany).not.toHaveBeenCalled();
  });
});

/**
 * 运行摘要的用量来源（eval-ingestion-hardening 5.2）
 *
 * 估算账本必须原样保留；真实账本按角色分账，来源用 real / mixed / estimated 三档，
 * 不可得调用单独计数——「没数据」不能被写成 0 token。
 */
describe('AiEvalDatasetService · 用量来源', () => {
  const judgeUsage = (
    overrides: Partial<Record<string, unknown>> = {},
  ) => ({
    role: 'judge',
    calls: 1,
    measuredCalls: 1,
    unavailableCalls: 0,
    promptTokens: 100,
    completionTokens: 20,
    totalTokens: 120,
    ...overrides,
  });

  afterEach(() => {
    delete process.env.AI_EVAL_RUN_TOKEN_BUDGET;
  });

  it('真实：判官调用拿到 provider 用量 → source=real，按角色分账', async () => {
    const { service, prisma, judge } = makeService();
    prisma.aiEvalRun.findUnique.mockResolvedValue(
      makeRun('STORED', [makeCase('c1', 'q1', 'a1')]),
    );
    judge.judge.mockResolvedValue({
      ...verdictOf('solved'),
      usage: judgeUsage(),
    });

    await (service as any).executeRun('run-1');

    const usage = summaryOf(prisma).usage;
    expect(usage).toMatchObject({
      source: 'real',
      unavailableCalls: 0,
      // 已有真实样本，预算口径随之切到真实移动平均（5.4）。
      budgetBasis: 'real-ewma-v1',
      // 既有估算字段保持不变
      estimatedTokens: estimateEvalCaseTokens('q1', 'a1').totalTokens,
    });
    expect(usage.byRole.judge).toMatchObject({
      calls: 1,
      measuredCalls: 1,
      totalTokens: 120,
    });
    expect(usage.byRole.chat).toMatchObject({ calls: 0, totalTokens: 0 });
  });

  it('混合：判官有真实用量、聊天不可得 → source=mixed', async () => {
    const { service, prisma, judge, aiCustomer } = makeService();
    prisma.aiEvalRun.findUnique.mockResolvedValue(
      makeRun('LIVE', [makeCase('c1', 'q1', 'a1')]),
    );
    aiCustomer.testChat.mockImplementation(
      async (_q: string, _u: string, _d: boolean, _s: string, options: any) => {
        // provider 没回传 usage：调用照记，token 不可得。
        options?.usageCollector?.handleLLMEnd({
          generations: [[{ text: 'no usage' }]],
        });
        return { agentOutput: '实时回答' };
      },
    );
    judge.judge.mockResolvedValue({
      ...verdictOf('solved'),
      usage: judgeUsage(),
    });

    await (service as any).executeRun('run-1');

    const usage = summaryOf(prisma).usage;
    expect(usage.source).toBe('mixed');
    expect(usage.unavailableCalls).toBe(1);
    expect(usage.byRole.chat).toMatchObject({
      calls: 1,
      measuredCalls: 0,
      unavailableCalls: 1,
      totalTokens: 0,
    });
    expect(usage.byRole.judge.totalTokens).toBe(120);
  });

  it('不可得：所有调用都没有 usage → source=estimated，token 不补 0', async () => {
    const { service, prisma, judge } = makeService();
    prisma.aiEvalRun.findUnique.mockResolvedValue(
      makeRun('STORED', [makeCase('c1', 'q1', 'a1')]),
    );
    judge.judge.mockResolvedValue({
      ...verdictOf('solved'),
      usage: judgeUsage({
        measuredCalls: 0,
        unavailableCalls: 1,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
      }),
    });

    await (service as any).executeRun('run-1');

    const usage = summaryOf(prisma).usage;
    expect(usage.source).toBe('estimated');
    expect(usage.unavailableCalls).toBe(1);
    expect(usage.byRole.judge).toMatchObject({
      calls: 1,
      measuredCalls: 0,
      unavailableCalls: 1,
      totalTokens: 0,
    });
  });

  it('取消：取消快照里也带真实用量账本', async () => {
    const { service, prisma, judge } = makeService();
    prisma.aiEvalRun.findUnique
      .mockResolvedValueOnce(
        makeRun('STORED', [makeCase('c1', 'q1', 'a1'), makeCase('c2', 'q2', 'a2')]),
      )
      .mockResolvedValueOnce({ status: 'RUNNING' })
      .mockResolvedValueOnce({ status: 'CANCELLED' });
    judge.judge.mockResolvedValue({
      ...verdictOf('solved'),
      usage: judgeUsage({ totalTokens: 42, promptTokens: 30, completionTokens: 12 }),
    });

    await (service as any).executeRun('run-1');

    const usage = summaryOf(prisma).usage;
    expect(summaryOf(prisma).cancelled).toBe(true);
    expect(usage).toMatchObject({ source: 'real', budgetBasis: 'real-ewma-v1' });
    expect(usage.byRole.judge.totalTokens).toBe(42);
  });
});

/**
 * 摘要成本改走价目表（eval-ingestion-hardening 5.3）
 *
 * 真实用量按角色各自的模型取价；模型缺价且无全局回退时显式未配置。
 */
describe('AiEvalDatasetService · 成本按模型计价', () => {
  const judgeUsageOf = (promptTokens: number, completionTokens: number) => ({
    role: 'judge',
    calls: 1,
    measuredCalls: 1,
    unavailableCalls: 0,
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
  });

  beforeEach(() => {
    process.env.AI_EVAL_LIVE_USER_ID = 'eval-test-user';
    process.env.AI_LLM_TYPE = 'online';
    delete process.env.OLLAMA_MODEL;
    delete process.env.AI_EVAL_MODEL_PRICES;
    delete process.env.AI_PRICE_FX_JSON;
  });

  afterEach(() => {
    delete process.env.AI_LLM_TYPE;
    delete process.env.AI_PRICE_INPUT_PER_1M;
    delete process.env.AI_PRICE_OUTPUT_PER_1M;
  });

  it('判官真实用量按判官模型单价计价，优先于全局单价', async () => {
    process.env.AI_PRICE_INPUT_PER_1M = '3';
    const { service, prisma, judge } = makeService();
    prisma.aiEvalRun.findUnique.mockResolvedValue(
      makeRun('STORED', [makeCase('c1', 'q1', 'a1')]),
    );
    judge.judge.mockResolvedValue({
      ...verdictOf('solved'),
      usage: judgeUsageOf(1_000_000, 0),
    });

    await service.executeRun('run-1');

    // llama-3.3-70b-versatile 输入 $0.59/1M；全局价 $3 不应覆盖模型价。
    expect(summaryOf(prisma).usage).toMatchObject({
      costConfigured: true,
      estimatedCostUsd: 0.59,
    });
  });

  it('聊天真实用量按聊天模型计价（deepseek-chat 输入+输出）', async () => {
    const { service, prisma, judge, aiCustomer } = makeService();
    prisma.aiEvalRun.findUnique.mockResolvedValue(
      makeRun('LIVE', [makeCase('c1', 'q1', 'a1')]),
    );
    aiCustomer.testChat.mockImplementation(
      async (_q: string, _u: string, _d: boolean, _s: string, options: any) => {
        options?.usageCollector?.handleLLMEnd({
          generations: [
            [
              {
                message: {
                  usage_metadata: { input_tokens: 1_000_000, output_tokens: 1_000_000 },
                },
              },
            ],
          ],
        });
        return { agentOutput: '实时回答' };
      },
    );
    judge.judge.mockResolvedValue(verdictOf('solved'));

    await service.executeRun('run-1');

    // deepseek-chat 输入 $0.27 + 输出 $1.10 = $1.37
    expect(summaryOf(prisma).usage).toMatchObject({
      costConfigured: true,
      estimatedCostUsd: 1.37,
    });
  });

  it('判官模型缺价且无全局价：显式未配置，不写 0 冒充已配置', async () => {
    const { service, prisma, judge } = makeService();
    prisma.aiEvalRun.findUnique.mockResolvedValue({
      ...makeRun('STORED', [makeCase('c1', 'q1', 'a1')]),
      judgeModel: 'unknown-judge-model',
    });
    judge.judge.mockResolvedValue({
      ...verdictOf('solved'),
      usage: judgeUsageOf(10, 5),
    });

    await service.executeRun('run-1');

    expect(summaryOf(prisma).usage).toMatchObject({
      costConfigured: false,
      estimatedCostUsd: 0,
    });
  });
});

/**
 * 预算口径 real-ewma-v1（eval-ingestion-hardening 5.4）
 *
 * 首条没有真实样本只能用估算；此后用最近真实用量做指数移动平均 × 安全系数，
 * 与下一条估算取较大值。恰好等于阈值放行，阈值 <= 0 关闭护栏。
 */
describe('AiEvalDatasetService · 预算口径 real-ewma-v1', () => {
  const verdictWithUsage = (totalTokens: number) => ({
    ...verdictOf('solved'),
    usage: {
      role: 'judge',
      calls: 1,
      measuredCalls: 1,
      unavailableCalls: 0,
      promptTokens: totalTokens,
      completionTokens: 0,
      totalTokens,
    },
  });

  beforeEach(() => {
    process.env.AI_EVAL_LIVE_USER_ID = 'eval-test-user';
  });

  afterEach(() => {
    delete process.env.AI_EVAL_RUN_TOKEN_BUDGET;
  });

  it('首条没有真实样本：按估算拦下，口径记为 estimated-v1', async () => {
    const estimate = estimateEvalCaseTokens('q1', 'a1').totalTokens;
    process.env.AI_EVAL_RUN_TOKEN_BUDGET = String(estimate - 1);
    const { service, prisma, judge } = makeService();
    prisma.aiEvalRun.findUnique.mockResolvedValue(
      makeRun('STORED', [makeCase('c1', 'q1', 'a1')]),
    );

    await service.executeRun('run-1');

    expect(judge.judge).not.toHaveBeenCalled();
    const summary = summaryOf(prisma);
    expect(summary.failureCategory).toBe('budget');
    expect(summary.usage).toMatchObject({
      exceeded: true,
      budgetBasis: 'estimated-v1',
    });
  });

  it('第二条起用真实用量的移动平均预测，并切换到 real-ewma-v1', async () => {
    // 估算 ~151；真实 3000；预测 = 3000 × 1.1 = 3300。
    process.env.AI_EVAL_RUN_TOKEN_BUDGET = '3200';
    const { service, prisma, judge } = makeService();
    prisma.aiEvalRun.findUnique.mockResolvedValue(
      makeRun('STORED', [
        makeCase('c1', 'q1', 'a1'),
        makeCase('c2', 'q2', 'a2'),
      ]),
    );
    judge.judge.mockResolvedValue(verdictWithUsage(3000));

    await service.executeRun('run-1');

    expect(judge.judge).toHaveBeenCalledTimes(1);
    const summary = summaryOf(prisma);
    expect(summary.failureCategory).toBe('budget');
    expect(summary.usage).toMatchObject({
      exceeded: true,
      budgetBasis: 'real-ewma-v1',
    });
    expect(summary.usage.byRole.judge.totalTokens).toBe(3000);
  });

  it('累计用量恰好等于阈值时放行', async () => {
    const e1 = estimateEvalCaseTokens('q1', 'a1').totalTokens;
    const e2 = estimateEvalCaseTokens('q2', 'a2').totalTokens;
    process.env.AI_EVAL_RUN_TOKEN_BUDGET = String(e1 + e2);
    const { service, prisma, judge } = makeService();
    prisma.aiEvalRun.findUnique.mockResolvedValue(
      makeRun('STORED', [
        makeCase('c1', 'q1', 'a1'),
        makeCase('c2', 'q2', 'a2'),
      ]),
    );
    judge.judge.mockResolvedValue(verdictOf('solved'));

    await service.executeRun('run-1');

    expect(judge.judge).toHaveBeenCalledTimes(2);
    expect(summaryOf(prisma)).toMatchObject({ failureCategory: null });
    expect(summaryOf(prisma).usage).toMatchObject({ exceeded: false });
  });

  it('阈值 <= 0 关闭护栏：真实用量再大也不停', async () => {
    process.env.AI_EVAL_RUN_TOKEN_BUDGET = '0';
    const { service, prisma, judge } = makeService();
    prisma.aiEvalRun.findUnique.mockResolvedValue(
      makeRun('STORED', [
        makeCase('c1', 'q1', 'a1'),
        makeCase('c2', 'q2', 'a2'),
      ]),
    );
    judge.judge.mockResolvedValue(verdictWithUsage(900_000));

    await service.executeRun('run-1');

    expect(judge.judge).toHaveBeenCalledTimes(2);
    expect(summaryOf(prisma).usage).toMatchObject({
      budget: 0,
      exceeded: false,
    });
  });

  it('没有真实样本时预测回退估算，口径保持 estimated-v1', async () => {
    const e1 = estimateEvalCaseTokens('q1', 'a1').totalTokens;
    const e2 = estimateEvalCaseTokens('q2', 'a2').totalTokens;
    process.env.AI_EVAL_RUN_TOKEN_BUDGET = String(e1 + e2 - 1);
    const { service, prisma, judge } = makeService();
    prisma.aiEvalRun.findUnique.mockResolvedValue(
      makeRun('STORED', [
        makeCase('c1', 'q1', 'a1'),
        makeCase('c2', 'q2', 'a2'),
      ]),
    );
    judge.judge.mockResolvedValue(verdictOf('solved'));

    await service.executeRun('run-1');

    expect(judge.judge).toHaveBeenCalledTimes(1);
    expect(summaryOf(prisma).usage).toMatchObject({
      exceeded: true,
      budgetBasis: 'estimated-v1',
    });
  });
});

/**
 * 差异接口的可比性与抖动（eval-ingestion-hardening 6.2）
 *
 * 元数据不一致 → 只给原因不给数字；缺失只降级为警告。
 * 翻转率只在两次都拿到布尔结论的用例上计算，低样本显式标注。
 */
describe('AiEvalDatasetService · getRunDiff 可比性与抖动', () => {
  const extResult = (caseId: string, answerVerdict: string) => ({
    caseId,
    answerVerdict,
    verdict: null,
    judgeErrorKind: answerVerdict === 'judge_error' ? 'output_format' : null,
    actualAnswer: `答-${caseId}`,
    judgeInputHash: `hash-${caseId}`,
    case: { question: `问题-${caseId}` },
  });

  const runRow = (overrides: Record<string, unknown> = {}) => ({
    id: 'run-3',
    datasetId: 'ds-1',
    baselineRunId: 'run-2',
    mode: 'EXTERNAL',
    status: 'COMPLETED',
    scope: 'full',
    judgeSpecVersion: 'task-judge-v2',
    datasetSnapshot: { hash: 'fp-1' },
    startedAt: new Date('2026-11-03T00:00:00Z'),
    summary: { metricFamily: 'answer_accuracy-v3', metricSpecVersion: '3' },
    results: [],
    ...overrides,
  });

  function stubRuns(
    prisma: ReturnType<typeof makeService>['prisma'],
    current: Record<string, unknown>,
    baseline: Record<string, unknown>,
  ) {
    prisma.aiEvalRun.findUnique
      .mockResolvedValueOnce(runRow(current))
      .mockResolvedValueOnce(runRow({ id: 'run-2', baselineRunId: null, ...baseline }));
    prisma.aiEvalRun.findMany.mockResolvedValueOnce([]);
  }

  it('两端元数据齐全且一致时可比，并返回两端元数据与抖动块', async () => {
    const { service, prisma } = makeService();
    stubRuns(
      prisma,
      { results: [extResult('c1', 'incorrect')] },
      { results: [extResult('c1', 'correct')] },
    );

    const diff = await service.getRunDiff('run-3');

    expect(diff.comparable).toBe(true);
    expect(diff.incomparableReasons).toEqual([]);
    expect(diff.runs.current).toMatchObject({
      id: 'run-3',
      mode: 'EXTERNAL',
      scope: 'full',
      metricSpecVersion: '3',
      judgeSpecVersion: 'task-judge-v2',
      datasetHash: 'fp-1',
    });
    expect(diff.runs.baseline).toMatchObject({ id: 'run-2' });
    expect(diff.drift).toMatchObject({
      sample: 1,
      flips: 1,
      flipRate: 1,
      direction: { improved: 0, worsened: 1 },
      sameInput: true,
      judgeNondeterminismLikely: true,
      lowSample: true,
    });
  });

  it.each([
    ['metricSpecVersion', { summary: { metricFamily: 'answer_accuracy-v3', metricSpecVersion: '4' } }, 'metricSpecVersion mismatch'],
    ['judgeSpecVersion', { judgeSpecVersion: 'task-judge-v3' }, 'judgeSpecVersion mismatch'],
    ['datasetSnapshot', { datasetSnapshot: { hash: 'fp-2' } }, 'datasetSnapshot.hash mismatch'],
    ['scope', { scope: 'subset' }, 'scope mismatch'],
    ['mode', { mode: 'LIVE' }, 'mode mismatch'],
  ])('%s 不一致时只给原因，不给差异数字', async (_label, baselineOverride, reason) => {
    const { service, prisma } = makeService();
    stubRuns(
      prisma,
      { results: [extResult('c1', 'incorrect')] },
      { results: [extResult('c1', 'correct')], ...(baselineOverride as any) },
    );

    const diff = await service.getRunDiff('run-3');

    expect(diff.comparable).toBe(false);
    expect(diff.incomparableReasons).toContain(reason);
    expect(diff.drift).toBeNull();
    expect(diff.counts).toBeNull();
    expect(diff.classes).toBeNull();
  });

  it('元数据缺失只降级为警告，仍给差异数字', async () => {
    const { service, prisma } = makeService();
    stubRuns(
      prisma,
      { results: [extResult('c1', 'incorrect')], judgeSpecVersion: null },
      {
        results: [extResult('c1', 'correct')],
        datasetSnapshot: null,
      },
    );

    const diff = await service.getRunDiff('run-3');

    expect(diff.comparable).toBe(true);
    expect(diff.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining('judgeSpecVersion'),
        expect.stringContaining('datasetSnapshot.hash'),
      ]),
    );
    expect(diff.counts).toMatchObject({ newFailure: 1 });
  });

  it('空结果：样本为零，翻转率为 null 且标低样本', async () => {
    const { service, prisma } = makeService();
    stubRuns(prisma, { results: [] }, { results: [] });

    const diff = await service.getRunDiff('run-3');

    expect(diff.drift).toMatchObject({
      sample: 0,
      flips: 0,
      flipRate: null,
      direction: { improved: 0, worsened: 0 },
      lowSample: true,
    });
  });

  it('全未判定：样本为零，不计入翻转率', async () => {
    const { service, prisma } = makeService();
    stubRuns(
      prisma,
      { results: [extResult('c1', 'judge_error')] },
      { results: [extResult('c1', 'correct')] },
    );

    const diff = await service.getRunDiff('run-3');

    expect(diff.drift!.sample).toBe(0);
    expect(diff.drift!.flipRate).toBeNull();
    expect(diff.comparability).toMatchObject({ compared: 0, undecided: 1 });
  });

  it('基线缺该用例：计入 missingBaseline，不进入翻转样本', async () => {
    const { service, prisma } = makeService();
    stubRuns(
      prisma,
      { results: [extResult('c1', 'incorrect'), extResult('c2', 'correct')] },
      { results: [extResult('c1', 'correct')] },
    );

    const diff = await service.getRunDiff('run-3');

    expect(diff.comparability).toMatchObject({ missingBaseline: 1 });
    expect(diff.drift!.sample).toBe(1);
  });

  it('判官输入不同时，翻转不再归因于判官非确定性', async () => {
    const { service, prisma } = makeService();
    stubRuns(
      prisma,
      { results: [{ ...extResult('c1', 'incorrect'), judgeInputHash: 'h-a' }] },
      { results: [{ ...extResult('c1', 'correct'), judgeInputHash: 'h-b' }] },
    );

    const diff = await service.getRunDiff('run-3');

    expect(diff.drift!.flips).toBe(1);
    expect(diff.drift!.sameInput).toBe(false);
    expect(diff.drift!.judgeNondeterminismLikely).toBe(false);
  });
});

/**
 * 用例历史的可比性标注（eval-ingestion-hardening 6.3）
 *
 * 每个时间点都要说清算不算同口径，否则不同快照的用例会被串成一条翻转线。
 */
describe('AiEvalDatasetService · getCaseHistory 可比性标注', () => {
  const historyRun = (overrides: Record<string, unknown> = {}) => ({
    id: 'run-1',
    status: 'COMPLETED',
    mode: 'STORED',
    scope: 'full',
    judgeSpecVersion: 'task-judge-v2',
    datasetSnapshot: { hash: 'fp-1' },
    summary: { metricFamily: 'verdict3', metricSpecVersion: 'verdict3-1' },
    isBaseline: false,
    results: [
      {
        verdict: 'solved',
        answerVerdict: null,
        judgeErrorKind: null,
        score: 0.9,
        answerScore: null,
      },
    ],
    ...overrides,
  });

  function stubHistory(
    prisma: ReturnType<typeof makeService>['prisma'],
    reference: Record<string, unknown>,
    points: Record<string, unknown>[],
  ) {
    prisma.aiEvalRun.findUnique.mockResolvedValueOnce({
      id: 'run-3',
      datasetId: 'ds-1',
      mode: 'STORED',
      status: 'COMPLETED',
      scope: 'full',
      judgeSpecVersion: 'task-judge-v2',
      datasetSnapshot: { hash: 'fp-1' },
      summary: { metricFamily: 'verdict3', metricSpecVersion: 'verdict3-1' },
      ...reference,
    });
    prisma.aiEvalCase.findUnique.mockResolvedValueOnce({
      id: 'case-1',
      datasetId: 'ds-1',
      question: '怎么退款',
      tags: [],
      sourceFeedbackId: null,
    });
    prisma.aiEvalRun.findMany.mockResolvedValueOnce(points);
  }

  it('逐点标注可比性：快照不同的点给出原因', async () => {
    const { service, prisma } = makeService();
    stubHistory(prisma, {}, [
      historyRun({ id: 'run-1', datasetSnapshot: { hash: 'fp-2' } }),
      historyRun({ id: 'run-2' }),
    ]);

    const history = await service.getCaseHistory('run-3', 'case-1');

    expect(history.timeline[0].comparability).toEqual({
      comparable: false,
      reasons: ['datasetSnapshot.hash mismatch'],
    });
    expect(history.timeline[1].comparability).toEqual({
      comparable: true,
      reasons: [],
    });
  });

  it('运行中与失败的运行不进入时间线', async () => {
    const { service, prisma } = makeService();
    stubHistory(prisma, {}, [
      historyRun({ id: 'run-running', status: 'RUNNING' }),
      historyRun({ id: 'run-failed', status: 'FAILED' }),
      historyRun({ id: 'run-done' }),
    ]);

    const history = await service.getCaseHistory('run-3', 'case-1');

    expect(history.timeline.map((point) => point.runId)).toEqual(['run-done']);
  });
});
