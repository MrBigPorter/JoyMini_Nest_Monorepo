import { BadRequestException } from '@nestjs/common';
import {
  AiEvalDatasetService,
  EXTERNAL_RUN_STALE_MS,
  PROMOTE_BASELINE_LOCK_KEY,
} from './ai-eval-dataset.service';

/**
 * 外部（harness）运行单测：
 * - 首次按 fingerprint 物化数据集，同 fingerprint 复用
 * - 结果只写 answerVerdict / answerScore，verdict / score 为 null
 * - 三态分账：judge_error 不进准确率分母
 * - EXTERNAL 不受内部 stale 清扫与单 RUNNING 守卫影响
 */

function snapshotCases() {
  return [
    {
      caseId: 'q1',
      kind: 'kb',
      question: '联系 alice@example.com 怎么退款',
      expectedDocIds: ['doc-1'],
      lang: 'zh',
    },
    {
      caseId: 'q2',
      kind: 'kb',
      question: '到账要多久',
      expectedDocIds: ['doc-2'],
      lang: 'zh',
    },
    {
      caseId: 'q3',
      kind: 'kb',
      question: '优惠券怎么用',
      expectedDocIds: ['doc-3'],
      lang: 'zh',
    },
  ];
}

function makeExternalRun() {
  const cases = snapshotCases();
  return {
    id: 'run-ext-1',
    datasetId: 'ds-e2e',
    status: 'RUNNING',
    mode: 'EXTERNAL',
    baselineRunId: null,
    datasetSnapshot: { hash: 'fp1234', cases },
    codeVersion: 'sha-abc',
    gateMode: 'shadow',
    judgeSpecVersion: 'v1',
    metricSpecVersion: '2',
    dataset: {
      id: 'ds-e2e',
      name: 'e2e:fp1234',
      cases: cases.map((item, index) => ({
        id: `case-db-${index + 1}`,
        metadata: { e2eCaseId: item.caseId },
      })),
    },
  };
}

function promotableRun(overrides: Record<string, any> = {}) {
  return {
    id: 'run-ext-1',
    status: 'COMPLETED',
    summary: { judgeErrorRate: 0.01, judgeErrorKinds: [] },
    codeVersion: 'sha-abc',
    judgeSpecVersion: 'v2',
    metricSpecVersion: '2',
    datasetSnapshot: { hash: 'fp1234', cases: [] },
    ...overrides,
  };
}

function makeService() {
  const prisma: any = {
    aiEvalDataset: { findUnique: jest.fn(), create: jest.fn() },
    aiEvalRun: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    aiEvalResult: { createMany: jest.fn().mockResolvedValue({ count: 3 }) },
    aiScore: { create: jest.fn() },
    $queryRawUnsafe: jest.fn().mockResolvedValue([{}]),
  };
  prisma.$transaction = jest.fn(async (cb: (tx: any) => unknown) => cb(prisma));
  const judge = { judge: jest.fn() };
  const aiCustomer = { testChat: jest.fn() };
  const queue = { add: jest.fn() };
  const service = new AiEvalDatasetService(
    prisma,
    judge as any,
    aiCustomer as any,
    queue as any,
  );
  return { service, prisma, judge };
}

describe('AiEvalDatasetService external runs', () => {
  it('首次创建按 fingerprint 物化数据集，并脱敏快照中的 PII', async () => {
    const { service, prisma } = makeService();
    const cases = snapshotCases();
    prisma.aiEvalDataset.findUnique.mockResolvedValue(null);
    prisma.aiEvalDataset.create.mockImplementation(({ data }: any) => ({
      id: 'ds-e2e',
      name: data.name,
      cases: data.cases.create.map((item: any, index: number) => ({
        id: `case-db-${index + 1}`,
        metadata: item.metadata,
      })),
    }));
    prisma.aiEvalRun.create.mockResolvedValue({ id: 'run-ext-1' });

    await service.createExternalRun(
      {
        datasetFingerprint: 'fp1234',
        cases,
        codeVersion: 'sha-abc',
        gateMode: 'shadow',
        judgeSpecVersion: 'v1',
        metricSpecVersion: '2',
      },
      'admin-1',
    );

    const datasetData = prisma.aiEvalDataset.create.mock.calls[0][0].data;
    expect(datasetData.name).toBe('e2e:fp1234');
    expect(datasetData.cases.create[0].metadata.e2eCaseId).toBe('q1');
    expect(datasetData.cases.create[0].question).toContain('a***@example.com');
    expect(datasetData.cases.create[0].answer).toBe('');

    const runData = prisma.aiEvalRun.create.mock.calls[0][0].data;
    expect(runData.mode).toBe('EXTERNAL');
    expect(runData.datasetSnapshot.hash).toBe('fp1234');
    expect(runData.datasetSnapshot.cases[0].question).toContain(
      'a***@example.com',
    );
    expect(runData.codeVersion).toBe('sha-abc');
    expect(runData.metricSpecVersion).toBe('2');
  });

  it('同 fingerprint 复用已有数据集，不重复创建', async () => {
    const { service, prisma } = makeService();
    const run = makeExternalRun();
    prisma.aiEvalDataset.findUnique.mockResolvedValue(run.dataset);
    prisma.aiEvalRun.create.mockResolvedValue({ id: 'run-ext-1' });

    await service.createExternalRun({
      datasetFingerprint: 'fp1234',
      cases: snapshotCases(),
      codeVersion: 'sha-abc',
      gateMode: 'shadow',
      judgeSpecVersion: 'v1',
      metricSpecVersion: '2',
    });

    expect(prisma.aiEvalDataset.create).not.toHaveBeenCalled();
    expect(prisma.aiEvalRun.create.mock.calls[0][0].data.datasetId).toBe(
      'ds-e2e',
    );
  });

  it('快照与已有数据集用例数不一致时拒绝', async () => {
    const { service, prisma } = makeService();
    const run = makeExternalRun();
    prisma.aiEvalDataset.findUnique.mockResolvedValue({
      ...run.dataset,
      cases: run.dataset.cases.slice(0, 1),
    });

    await expect(
      service.createExternalRun({
        datasetFingerprint: 'fp1234',
        cases: snapshotCases(),
        codeVersion: 'sha-abc',
        gateMode: 'shadow',
        judgeSpecVersion: 'v1',
        metricSpecVersion: '2',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('EXTERNAL run 不被 executeRun 重跑', async () => {
    const { service, prisma, judge } = makeService();
    prisma.aiEvalRun.findUnique.mockResolvedValue(makeExternalRun());

    await service.executeRun('run-ext-1');

    expect(judge.judge).not.toHaveBeenCalled();
    expect(prisma.aiEvalResult.createMany).not.toHaveBeenCalled();
  });

  it('stale 清扫对 EXTERNAL 使用 24 小时阈值，且不混入内部清扫', async () => {
    const { service, prisma } = makeService();

    await (service as any).recoverStaleRuns();

    const calls = prisma.aiEvalRun.updateMany.mock.calls.map(
      (call: any[]) => call[0].where,
    );
    expect(calls[0].mode).toEqual({ not: 'EXTERNAL' });
    expect(calls[1].mode).toBe('EXTERNAL');
    const externalCutoff = calls[1].startedAt.lt.getTime();
    expect(Date.now() - externalCutoff).toBeGreaterThanOrEqual(
      EXTERNAL_RUN_STALE_MS - 5_000,
    );
  });

  it('写入三态结果：verdict/score 留空，judge_error 不进准确率分母', async () => {
    const { service, prisma } = makeService();
    const run = makeExternalRun();
    prisma.aiEvalRun.findUnique.mockResolvedValue(run);

    await service.ingestExternalResults('run-ext-1', {
      cases: [
        {
          caseId: 'q1',
          answerVerdict: 'correct',
          reason: 'ok',
          grounding: 'kb',
        },
        {
          caseId: 'q2',
          answerVerdict: 'incorrect',
          reason: 'no',
          grounding: 'kb',
        },
        {
          caseId: 'q3',
          answerVerdict: 'judge_error',
          judgeErrorKind: 'timeout',
          reason: 'judge timeout',
          grounding: 'kb',
        },
      ],
    });

    const rows = prisma.aiEvalResult.createMany.mock.calls[0][0].data;
    expect(rows).toHaveLength(3);
    expect(rows[0]).not.toHaveProperty('verdict');
    expect(rows[0]).not.toHaveProperty('score');
    expect(rows[0].answerScore).toBe(1);
    expect(rows[1].answerScore).toBe(0);
    expect(rows[2].judgeSpecVersion).toBe('v1');

    const summary = prisma.aiEvalRun.update.mock.calls[0][0].data.summary;
    expect(summary.total).toBe(3);
    expect(summary.accuracy).toBe(0.5);
    expect(summary.judgeErrorRate).toBe(0.3333);
    expect(summary.judgeErrorKinds).toEqual([{ kind: 'timeout', count: 1 }]);
    expect(summary.answerVerdicts).toEqual({
      correct: 1,
      incorrect: 1,
      judge_error: 1,
    });
    expect(summary.grounding).toEqual({ kb: 3 });
    expect(summary.mode).toBe('EXTERNAL');
  });

  it('汇总按 judgeErrorKind 输出错误类型分布（降序、同数按类型名）', async () => {
    const { service } = makeService();

    const summary = await (service as any).buildExternalSummary(
      {
        id: 'run-ext-1',
        baselineRunId: null,
        datasetSnapshot: { hash: 'fp1234', cases: [] },
        codeVersion: 'sha-abc',
        gateMode: 'shadow',
        judgeSpecVersion: 'v2',
        metricSpecVersion: '2',
      },
      [
        { caseId: 'q1', answerVerdict: 'correct', reason: 'ok' },
        {
          caseId: 'q2',
          answerVerdict: 'judge_error',
          judgeErrorKind: 'timeout',
          reason: 'judge timeout',
        },
        {
          caseId: 'q3',
          answerVerdict: 'judge_error',
          judgeErrorKind: 'timeout',
          reason: 'judge timeout',
        },
        {
          caseId: 'q4',
          answerVerdict: 'judge_error',
          judgeErrorKind: 'output_format',
          reason: 'bad json',
        },
        {
          caseId: 'q5',
          answerVerdict: 'judge_error',
          judgeErrorKind: 'auth',
          reason: '401',
        },
        { caseId: 'q6', answerVerdict: 'incorrect', reason: 'no' },
      ],
    );

    expect(summary.judgeErrorKinds).toEqual([
      { kind: 'timeout', count: 2 },
      { kind: 'auth', count: 1 },
      { kind: 'output_format', count: 1 },
    ]);
    expect(summary.judgeErrorRate).toBe(0.6667);
  });

  it('judge_error 缺少错误类型时拒绝', async () => {
    const { service, prisma } = makeService();
    prisma.aiEvalRun.findUnique.mockResolvedValue(makeExternalRun());

    await expect(
      service.ingestExternalResults('run-ext-1', {
        cases: [
          { caseId: 'q1', answerVerdict: 'judge_error', reason: 'x' },
          { caseId: 'q2', answerVerdict: 'correct', reason: 'ok' },
          { caseId: 'q3', answerVerdict: 'correct', reason: 'ok' },
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('结果数量与快照不一致时拒绝', async () => {
    const { service, prisma } = makeService();
    prisma.aiEvalRun.findUnique.mockResolvedValue(makeExternalRun());

    await expect(
      service.ingestExternalResults('run-ext-1', {
        cases: [{ caseId: 'q1', answerVerdict: 'correct', reason: 'ok' }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('已收尾的 run 不接受二次写入', async () => {
    const { service, prisma } = makeService();
    prisma.aiEvalRun.findUnique.mockResolvedValue({
      ...makeExternalRun(),
      status: 'COMPLETED',
    });

    await expect(
      service.ingestExternalResults('run-ext-1', { cases: [] }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('未显式指定 baselineRunId 时回退到同数据集的当前基线', async () => {
    const { service, prisma } = makeService();
    const run = makeExternalRun();
    prisma.aiEvalDataset.findUnique.mockResolvedValue(run.dataset);
    prisma.aiEvalRun.create.mockResolvedValue({ id: 'run-new' });
    prisma.aiEvalRun.findFirst.mockResolvedValue({ id: 'run-base' });

    await service.createExternalRun({
      datasetFingerprint: 'fp1234',
      cases: snapshotCases(),
      codeVersion: 'sha-abc',
      gateMode: 'shadow',
      judgeSpecVersion: 'v2',
      metricSpecVersion: '2',
    });

    expect(prisma.aiEvalRun.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { isBaseline: true, datasetId: 'ds-e2e' },
      }),
    );
    expect(prisma.aiEvalRun.create.mock.calls[0][0].data.baselineRunId).toBe(
      'run-base',
    );
  });
});

describe('AiEvalDatasetService promote baseline', () => {
  it('拒绝未完成的运行', async () => {
    const { service, prisma } = makeService();
    prisma.aiEvalRun.findUnique.mockResolvedValue(
      promotableRun({ status: 'RUNNING' }),
    );

    await expect(service.promoteRun('run-ext-1')).rejects.toThrow(
      /only COMPLETED/,
    );
    expect(prisma.aiEvalRun.update).not.toHaveBeenCalled();
  });

  it('判官失败率未低于阈值时拒绝，并列出错误类型', async () => {
    const { service, prisma } = makeService();
    prisma.aiEvalRun.findUnique.mockResolvedValue(
      promotableRun({
        summary: {
          judgeErrorRate: 0.05,
          judgeErrorKinds: [{ kind: 'timeout', count: 3 }],
        },
      }),
    );

    await expect(service.promoteRun('run-ext-1')).rejects.toThrow(/timeout×3/);
    expect(prisma.aiEvalRun.update).not.toHaveBeenCalled();
  });

  it('版本或快照缺失时拒绝，并列出缺失字段', async () => {
    const { service, prisma } = makeService();
    prisma.aiEvalRun.findUnique.mockResolvedValue(
      promotableRun({
        codeVersion: null,
        judgeSpecVersion: null,
        datasetSnapshot: null,
      }),
    );

    await expect(service.promoteRun('run-ext-1')).rejects.toThrow(
      /missing codeVersion, datasetSnapshot\.hash, judgeSpecVersion/,
    );
    expect(prisma.aiEvalRun.update).not.toHaveBeenCalled();
  });

  it('指标定义版本不一致时拒绝', async () => {
    const { service, prisma } = makeService();
    prisma.aiEvalRun.findUnique.mockResolvedValue(
      promotableRun({ metricSpecVersion: '1' }),
    );

    await expect(service.promoteRun('run-ext-1')).rejects.toThrow(
      /metricSpecVersion 1 != current 2/,
    );
    expect(prisma.aiEvalRun.update).not.toHaveBeenCalled();
  });

  it('通过校验后在事务内清旧基线并登记新基线', async () => {
    const { service, prisma } = makeService();
    prisma.aiEvalRun.findUnique.mockResolvedValue(promotableRun());

    await service.promoteRun('run-ext-1');

    expect(prisma.$queryRawUnsafe).toHaveBeenCalledWith(
      'SELECT pg_advisory_xact_lock($1)::text',
      PROMOTE_BASELINE_LOCK_KEY,
    );
    const clear = prisma.aiEvalRun.updateMany.mock.calls.find(
      (call: any[]) => call[0]?.data?.isBaseline === false,
    );
    expect(clear?.[0].where).toEqual({
      isBaseline: true,
      id: { not: 'run-ext-1' },
    });
    const promote = prisma.aiEvalRun.update.mock.calls.find(
      (call: any[]) => call[0]?.data?.isBaseline === true,
    );
    expect(promote?.[0].where).toEqual({ id: 'run-ext-1' });
  });
});
