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
    metricSpecVersion: '3',
    knowledgeFingerprint: 'corpus-1',
    scope: 'full',
    knowledgeSnapshot: {
      fingerprint: 'corpus-1',
      before: { server: 'corpus-1', harness: 'corpus-1' },
    },
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

/** 满足最低样本量（总数 150、每种 kind ≥12）的全量用例快照。 */
function promotableCases() {
  return Array.from({ length: 150 }, (_, i) => ({
    caseId: `q${i}`,
    kind: i < 75 ? 'kb' : 'multi',
    question: `问题 ${i}`,
  }));
}

function promotableRun(overrides: Record<string, any> = {}) {
  return {
    id: 'run-ext-1',
    mode: 'EXTERNAL',
    datasetId: 'ds-e2e',
    status: 'COMPLETED',
    summary: {
      judgeErrorRate: 0.01,
      judgeErrorKinds: [],
      judgeAgreement: 0.98,
      judgeAgreementMeasured: 40,
      judgeDisagreement: 1,
    },
    codeVersion: 'sha-abc',
    judgeSpecVersion: 'v2',
    metricSpecVersion: '3',
    datasetSnapshot: { hash: 'fp1234', cases: promotableCases() },
    knowledgeSnapshot: { stable: true, stableReason: 'stable' },
    scope: 'full',
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
  const corpusFingerprint = {
    getCurrent: jest.fn().mockResolvedValue({
      fingerprint: 'corpus-1',
      docs: [
        {
          id: 'doc-1',
          docId: 'refund-policy',
          locale: 'en',
          title: 'Refund',
          activeVersion: 1,
          activeChunkHash: 'chunk-hash',
          activeChunkCount: 2,
        },
      ],
      pendingActivation: [],
      generatedAt: '2026-11-24T00:00:00.000Z',
    }),
  };
  const service = new AiEvalDatasetService(
    prisma,
    judge as any,
    aiCustomer as any,
    queue as any,
    corpusFingerprint as any,
  );
  return { service, prisma, judge, corpusFingerprint };
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
    expect(runData.knowledgeFingerprint).toBe('corpus-1');
    expect(runData.scope).toBe('full');
    expect(runData.knowledgeSnapshot.stable).toBe(false);
    expect(runData.knowledgeSnapshot.before.server).toBe('corpus-1');
    expect(runData.knowledgeSnapshot.docs).toHaveLength(1);
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

    await (service as any).sweepStaleRuns();

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

  it('收尾写入知识快照：服务端与 harness 前后一致时 stable=true', async () => {
    const { service, prisma } = makeService();
    prisma.aiEvalRun.findUnique.mockResolvedValue(makeExternalRun());

    await service.ingestExternalResults('run-ext-1', {
      cases: [
        { caseId: 'q1', answerVerdict: 'correct', reason: 'ok' },
        { caseId: 'q2', answerVerdict: 'correct', reason: 'ok' },
        { caseId: 'q3', answerVerdict: 'correct', reason: 'ok' },
      ],
      knowledgeFingerprintBefore: 'corpus-1',
      knowledgeFingerprintAfter: 'corpus-1',
    });

    const data = prisma.aiEvalRun.update.mock.calls[0][0].data;
    expect(data.knowledgeSnapshot.stable).toBe(true);
    expect(data.knowledgeSnapshot.stableReason).toBe('stable');
    expect(data.knowledgeSnapshot.after).toEqual({
      server: 'corpus-1',
      harness: 'corpus-1',
    });
    expect(data.knowledgeSnapshot.docs).toHaveLength(1);
  });

  it('运行中语料变化时快照记 stable=false 并给出原因', async () => {
    const { service, prisma } = makeService();
    prisma.aiEvalRun.findUnique.mockResolvedValue(makeExternalRun());

    await service.ingestExternalResults('run-ext-1', {
      cases: [
        { caseId: 'q1', answerVerdict: 'correct', reason: 'ok' },
        { caseId: 'q2', answerVerdict: 'correct', reason: 'ok' },
        { caseId: 'q3', answerVerdict: 'correct', reason: 'ok' },
      ],
      knowledgeFingerprintBefore: 'corpus-1',
      knowledgeFingerprintAfter: 'corpus-2',
    });

    const data = prisma.aiEvalRun.update.mock.calls[0][0].data;
    expect(data.knowledgeSnapshot.stable).toBe(false);
    expect(data.knowledgeSnapshot.stableReason).toBe('harness_corpus_changed');
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
          judgeAgreement: 1,
          judgeSuccessfulAttempts: 3,
        },
        {
          caseId: 'q2',
          answerVerdict: 'incorrect',
          reason: 'no',
          grounding: 'kb',
          judgeAgreement: 0.67,
          judgeSuccessfulAttempts: 3,
        },
        {
          caseId: 'q3',
          answerVerdict: 'judge_error',
          judgeErrorKind: 'timeout',
          reason: 'judge timeout',
          grounding: 'kb',
          judgeAgreement: 1,
          judgeSuccessfulAttempts: 3,
          judgeDisagreement: true,
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
    // 族随数字走：外部口径固定 answer_accuracy-v3，消费方不用猜 key 属于哪族。
    expect(summary.metricFamily).toBe('answer_accuracy-v3');
    // 判官稳定性进 summary Json（不加数据库列）：3 条都有 ≥2 次成功，1 条全票一致。
    expect(summary.judgeAgreement).toBe(0.3333);
    expect(summary.judgeAgreementMeasured).toBe(3);
    expect(summary.judgeDisagreement).toBe(1);
  });

  it('基线对比跳过未判定条目：判官失败不算回归，也不算修复', async () => {
    const { service, prisma } = makeService();
    const run = { ...makeExternalRun(), baselineRunId: 'run-base' };
    prisma.aiEvalRun.findUnique
      .mockResolvedValueOnce(run) // 本次 run
      .mockResolvedValueOnce({
        // 基线的 summary + 每条 answerVerdict
        summary: { accuracy: 0.5 },
        results: [
          { caseId: 'q1', answerVerdict: 'correct' },
          { caseId: 'q2', answerVerdict: 'judge_error' },
          { caseId: 'q3', answerVerdict: 'incorrect' },
        ],
      })
      .mockResolvedValueOnce({ status: 'RUNNING' }) // 事务内状态复核
      .mockResolvedValueOnce({ ...run, status: 'COMPLETED' }); // getRun

    await service.ingestExternalResults('run-ext-1', {
      cases: [
        // 基线 correct、本次判官失败：判官故障不能被记成一次回归。
        {
          caseId: 'q1',
          answerVerdict: 'judge_error',
          judgeErrorKind: 'timeout',
          reason: 'judge timeout',
        },
        // 基线判官失败、本次 correct：也不是「修复」，因为上一次根本没判定。
        { caseId: 'q2', answerVerdict: 'correct', reason: 'ok' },
        { caseId: 'q3', answerVerdict: 'incorrect', reason: 'no' },
      ],
      knowledgeFingerprintBefore: 'corpus-1',
      knowledgeFingerprintAfter: 'corpus-1',
    });

    const summary = prisma.aiEvalRun.update.mock.calls[0][0].data.summary;
    expect(summary.newFailures).toBe(0);
    expect(summary.fixed).toBe(0);
    // 准确率只看判过的：1 correct / 2 judged，与基线 0.5 持平。
    expect(summary.accuracy).toBe(0.5);
    expect(summary.delta).toBe(0);
  });

  it('EXTERNAL 不把内部 verdict3 基线算进同族 delta', async () => {
    const { service, prisma } = makeService();
    const run = { ...makeExternalRun(), baselineRunId: 'run-internal' };
    prisma.aiEvalRun.findUnique
      .mockResolvedValueOnce(run)
      .mockResolvedValueOnce({
        // 内部 run 的 summary：同名 key 是任务通过率，不是答案准确率。
        summary: { metricFamily: 'verdict3', passRate: 0.8 },
        results: [{ caseId: 'q1', verdict: 'solved' }],
      })
      .mockResolvedValueOnce({ status: 'RUNNING' })
      .mockResolvedValueOnce({ ...run, status: 'COMPLETED' });

    await service.ingestExternalResults('run-ext-1', {
      cases: [
        { caseId: 'q1', answerVerdict: 'correct', reason: 'ok' },
        { caseId: 'q2', answerVerdict: 'incorrect', reason: 'no' },
        { caseId: 'q3', answerVerdict: 'correct', reason: 'ok' },
      ],
      knowledgeFingerprintBefore: 'corpus-1',
      knowledgeFingerprintAfter: 'corpus-1',
    });

    const summary = prisma.aiEvalRun.update.mock.calls[0][0].data.summary;
    expect(summary.metricFamily).toBe('answer_accuracy-v3');
    expect(summary).not.toHaveProperty('baselineAccuracy');
    expect(summary).not.toHaveProperty('delta');
    expect(summary).not.toHaveProperty('newFailures');
    expect(summary).not.toHaveProperty('fixed');
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

  it('显式传 baselineRunId=null 表示不对比，不回退到已登记基线', async () => {
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
      baselineRunId: null,
    });

    expect(prisma.aiEvalRun.findFirst).not.toHaveBeenCalled();
    expect(
      prisma.aiEvalRun.create.mock.calls[0][0].data.baselineRunId,
    ).toBeNull();
  });

  it('收尾时不为 baselineRunId=null 的运行补拾基线', async () => {
    const { service, prisma } = makeService();
    const run = { ...makeExternalRun(), baselineRunId: null, status: 'RUNNING' };
    prisma.aiEvalRun.findUnique
      .mockResolvedValueOnce(run)
      .mockResolvedValueOnce({ status: 'RUNNING' })
      .mockResolvedValueOnce({ ...run, status: 'COMPLETED' });
    prisma.aiEvalRun.findFirst.mockResolvedValue({
      id: 'run-base',
      datasetSnapshot: { hash: 'fp1234', cases: [] },
    });

    await service.ingestExternalResults('run-ext-1', {
      cases: [
        { caseId: 'q1', answerVerdict: 'correct', reason: 'ok' },
        { caseId: 'q2', answerVerdict: 'correct', reason: 'ok' },
        { caseId: 'q3', answerVerdict: 'correct', reason: 'ok' },
      ],
    });

    expect(prisma.aiEvalRun.findFirst).not.toHaveBeenCalled();
    const summary = prisma.aiEvalRun.update.mock.calls[0][0].data.summary;
    expect(summary.baselineRunId).toBeNull();
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

  it('内部运行拒绝登记基线，并说明只有 EXTERNAL 可以', async () => {
    const { service, prisma } = makeService();
    prisma.aiEvalRun.findUnique.mockResolvedValue(
      promotableRun({ mode: 'STORED' }),
    );

    await expect(service.promoteRun('run-ext-1')).rejects.toThrow(
      /only EXTERNAL/i,
    );
    expect(prisma.aiEvalRun.update).not.toHaveBeenCalled();
  });

  it('scope 为空时拒绝（缺范围不等于全量）', async () => {
    const { service, prisma } = makeService();
    prisma.aiEvalRun.findUnique.mockResolvedValue(
      promotableRun({ scope: null }),
    );

    await expect(service.promoteRun('run-ext-1')).rejects.toThrow(
      /scope is missing/i,
    );
    expect(prisma.aiEvalRun.update).not.toHaveBeenCalled();
  });

  it('知识快照不稳定时拒绝', async () => {
    const { service, prisma } = makeService();
    prisma.aiEvalRun.findUnique.mockResolvedValue(
      promotableRun({
        knowledgeSnapshot: { stable: false, stableReason: 'server_changed' },
      }),
    );

    await expect(service.promoteRun('run-ext-1')).rejects.toThrow(
      /knowledge snapshot is not stable.*server_changed/i,
    );
  });

  it('总分不足 150 时拒绝登记基线', async () => {
    const { service, prisma } = makeService();
    prisma.aiEvalRun.findUnique.mockResolvedValue(
      promotableRun({
        datasetSnapshot: {
          hash: 'fp1234',
          cases: Array.from({ length: 149 }, (_, i) => ({
            caseId: `q${i}`,
            kind: 'kb',
          })),
        },
      }),
    );

    await expect(service.promoteRun('run-ext-1')).rejects.toThrow(
      /at least 150/i,
    );
  });

  it('单个意图样本不足 12 时拒绝登记基线', async () => {
    const { service, prisma } = makeService();
    const cases = Array.from({ length: 150 }, (_, i) => ({
      caseId: `q${i}`,
      // 149 条 kb + 1 条 action：总够但 action 意图只有 1 条。
      kind: i === 0 ? 'action' : 'kb',
    }));
    prisma.aiEvalRun.findUnique.mockResolvedValue(
      promotableRun({ datasetSnapshot: { hash: 'fp1234', cases } }),
    );

    await expect(service.promoteRun('run-ext-1')).rejects.toThrow(
      /kind "action" has 1 cases.*at least 12/i,
    );
  });

  it('快照 hash 与数据集当前基线不同源时拒绝', async () => {
    const { service, prisma } = makeService();
    prisma.aiEvalRun.findUnique.mockResolvedValue(promotableRun());
    prisma.aiEvalRun.findFirst.mockResolvedValue({
      id: 'run-base',
      datasetSnapshot: { hash: 'fp-other', cases: [] },
    });

    await expect(service.promoteRun('run-ext-1')).rejects.toThrow(
      /datasetSnapshot\.hash fp1234 differs from baseline fp-other/i,
    );
    expect(prisma.aiEvalRun.update).not.toHaveBeenCalled();
  });

  it('子集运行拒绝登记基线，并说明只能作为诊断', async () => {
    const { service, prisma } = makeService();
    prisma.aiEvalRun.findUnique.mockResolvedValue(
      promotableRun({ scope: 'subset' }),
    );

    await expect(service.promoteRun('run-ext-1')).rejects.toThrow(
      /Subset runs are diagnostic only.*full-scope/,
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
      promotableRun({ metricSpecVersion: '2' }),
    );

    await expect(service.promoteRun('run-ext-1')).rejects.toThrow(
      /metricSpecVersion 2 != current 3/,
    );
    expect(prisma.aiEvalRun.update).not.toHaveBeenCalled();
  });

  it('缺少 judgeAgreement 时拒绝，并提示如何测量', async () => {
    const { service, prisma } = makeService();
    prisma.aiEvalRun.findUnique.mockResolvedValue(
      promotableRun({
        summary: { judgeErrorRate: 0.01, judgeErrorKinds: [] },
      }),
    );

    await expect(service.promoteRun('run-ext-1')).rejects.toThrow(
      /no judgeAgreement.*EVAL_JUDGE_REPEATS/,
    );
    expect(prisma.aiEvalRun.update).not.toHaveBeenCalled();
  });

  it('judgeAgreement 低于 95% 时拒绝', async () => {
    const { service, prisma } = makeService();
    prisma.aiEvalRun.findUnique.mockResolvedValue(
      promotableRun({
        summary: {
          judgeErrorRate: 0.01,
          judgeErrorKinds: [],
          judgeAgreement: 0.9,
          judgeAgreementMeasured: 80,
        },
      }),
    );

    await expect(service.promoteRun('run-ext-1')).rejects.toThrow(
      /judgeAgreement 90\.00% is not at least 95\.00% \(measured on 80 cases\)/,
    );
    expect(prisma.aiEvalRun.update).not.toHaveBeenCalled();
  });

  it('judgeAgreement 达到 97% 时通过', async () => {
    const { service, prisma } = makeService();
    prisma.aiEvalRun.findUnique.mockResolvedValue(
      promotableRun({
        summary: {
          judgeErrorRate: 0.01,
          judgeErrorKinds: [],
          judgeAgreement: 0.97,
          judgeAgreementMeasured: 80,
        },
      }),
    );

    await service.promoteRun('run-ext-1');

    expect(prisma.aiEvalRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'run-ext-1' },
        data: { isBaseline: true },
      }),
    );
  });

  it('通过校验后在事务内清本数据集旧基线并登记新基线', async () => {
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
    // 只清同一数据集的旧基线：A 登记后 B 的基线必须还在。
    expect(clear?.[0].where).toEqual({
      isBaseline: true,
      datasetId: 'ds-e2e',
      id: { not: 'run-ext-1' },
    });
    const promote = prisma.aiEvalRun.update.mock.calls.find(
      (call: any[]) => call[0]?.data?.isBaseline === true,
    );
    expect(promote?.[0].where).toEqual({ id: 'run-ext-1' });
  });
});
