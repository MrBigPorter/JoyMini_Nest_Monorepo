import { BadRequestException } from '@nestjs/common';
import { AiEvalDatasetService } from './ai-eval-dataset.service';

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
    mode,
    baselineRunId,
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
    aiEvalDataset: { findUnique: jest.fn() },
    aiEvalRun: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    aiEvalResult: { create: jest.fn().mockResolvedValue({}) },
  };
  const judge = { judge: jest.fn() };
  const aiCustomer = { testChat: jest.fn() };
  const service = new AiEvalDatasetService(
    prisma as any,
    judge as any,
    aiCustomer as any,
  );
  return { service, prisma, judge, aiCustomer };
}

function summaryOf(prisma: ReturnType<typeof makeService>['prisma']) {
  const calls = prisma.aiEvalRun.update.mock.calls;
  const call = calls[calls.length - 1];
  return call?.[0]?.data?.summary;
}

describe('AiEvalDatasetService', () => {
  beforeEach(() => {
    process.env.AI_EVAL_LIVE_USER_ID = 'eval-test-user';
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
    );
    expect(judge.judge).toHaveBeenCalledWith({
      question: '怎么退款',
      answer: '实时回答：请点申请退款',
      expectTask: { mustMention: ['关键信息'] },
      pendingConfirm: { action: 'claim_coupon' },
    });
    const result = prisma.aiEvalResult.create.mock.calls[0][0].data;
    expect(result.actualAnswer).toBe('实时回答：请点申请退款');
    expect(result.traceId).toHaveLength(32);
    expect(summaryOf(prisma)).toMatchObject({
      mode: 'LIVE',
      total: 1,
      solved: 1,
    });
  });

  it('LIVE 单条失败记 unsolved，不影响整次运行', async () => {
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

    expect(judge.judge).toHaveBeenCalledTimes(1);
    const first = prisma.aiEvalResult.create.mock.calls[0][0].data;
    expect(first).toMatchObject({
      caseId: 'c1',
      verdict: 'unsolved',
      score: 0,
      actualAnswer: null,
    });
    expect(first.reason).toContain('live_failed');
    const second = prisma.aiEvalResult.create.mock.calls[1][0].data;
    expect(second).toMatchObject({ caseId: 'c2', verdict: 'solved' });
    expect(prisma.aiEvalRun.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'COMPLETED' }),
      }),
    );
    expect(summaryOf(prisma)).toMatchObject({
      mode: 'LIVE',
      total: 2,
      solved: 1,
      unsolved: 1,
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
      data: {
        datasetId: 'ds-1',
        createdBy: 'admin-1',
        mode: 'LIVE',
        baselineRunId: 'baseline-1',
      },
    });
  });
});
