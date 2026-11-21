import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@api/common/prisma/prisma.service';
import type { AiCustomerService } from '@api/client/ai-customer/ai-customer.service';
import { runWithContext } from '@api/common/logger/trace-context';
import { AiEvalJudgeService } from './ai-eval-judge.service';
import { AddEvalCasesDto } from './dto/eval-dataset.dto';

export type EvalMode = 'STORED' | 'LIVE';

/** 注入令牌：避免评测服务直接依赖客服 graph 的庞大运行时依赖。 */
export const AI_EVAL_LIVE_AI = 'AI_EVAL_LIVE_AI';

/** LIVE 模式只需要 testChat 这一条真实 AI 入口。 */
export interface LiveAiRunner {
  testChat(
    message: string,
    userId: string,
    debug?: boolean,
    sessionId?: string,
  ): Promise<{
    agentOutput: string;
    pendingConfirm?: Record<string, any> | null;
  }>;
}

export interface StartRunOptions {
  mode?: EvalMode;
  baselineRunId?: string;
}

interface BaselineSnapshot {
  passRate: number;
  verdictByCase: Map<string, string>;
}

interface CaseVerdict {
  caseId: string;
  verdict: string;
}

@Injectable()
export class AiEvalDatasetService {
  private readonly logger = new Logger(AiEvalDatasetService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly judge: AiEvalJudgeService,
    @Inject(AI_EVAL_LIVE_AI) private readonly aiCustomer: LiveAiRunner,
  ) {}

  async listDatasets() {
    await this.recoverStaleRuns();
    return this.prisma.aiEvalDataset.findMany({
      orderBy: { updatedAt: 'desc' },
      include: { _count: { select: { cases: true, runs: true } } },
    });
  }

  async createDataset(input: {
    name: string;
    description?: string;
    createdBy?: string;
  }) {
    return this.prisma.aiEvalDataset.create({
      data: {
        name: input.name,
        description: input.description,
        createdBy: input.createdBy,
      },
    });
  }

  async getDataset(id: string) {
    await this.recoverStaleRuns();
    const dataset = await this.prisma.aiEvalDataset.findUnique({
      where: { id },
      include: {
        cases: { orderBy: { createdAt: 'asc' } },
        runs: {
          orderBy: { startedAt: 'desc' },
          take: 20,
        },
        _count: { select: { runs: true, cases: true } },
      },
    });
    if (!dataset) throw new NotFoundException('Eval dataset not found');
    return dataset;
  }

  async addCases(datasetId: string, dto: AddEvalCasesDto) {
    const dataset = await this.prisma.aiEvalDataset.findUnique({
      where: { id: datasetId },
      select: { id: true },
    });
    if (!dataset) throw new NotFoundException('Eval dataset not found');

    await this.prisma.aiEvalCase.createMany({
      data: dto.cases.map((item) => ({
        datasetId,
        question: item.question,
        answer: item.answer,
        expect: (item.expect ?? {}) as any,
        expected: (item.expected ?? null) as any,
        metadata: (item.metadata ?? null) as any,
        sourceFeedbackId: item.sourceFeedbackId ?? null,
        source: item.source ?? null,
        tags: (item.tags ?? []) as any,
      })),
    });
    return this.getDataset(datasetId);
  }

  async updateCase(
    datasetId: string,
    caseId: string,
    dto: {
      question?: string;
      answer?: string;
      expect?: Record<string, any>;
      expected?: string | Record<string, any>;
      metadata?: Record<string, any>;
      tags?: string[];
    },
  ) {
    const existing = await this.prisma.aiEvalCase.findUnique({
      where: { id: caseId },
      select: { id: true, datasetId: true },
    });
    if (!existing || existing.datasetId !== datasetId) {
      throw new NotFoundException('Eval case not found');
    }
    await this.prisma.aiEvalCase.update({
      where: { id: caseId },
      data: {
        ...(dto.question !== undefined ? { question: dto.question } : {}),
        ...(dto.answer !== undefined ? { answer: dto.answer } : {}),
        ...(dto.expect !== undefined ? { expect: dto.expect as any } : {}),
        ...(dto.expected !== undefined
          ? { expected: dto.expected as any }
          : {}),
        ...(dto.metadata !== undefined
          ? { metadata: dto.metadata as any }
          : {}),
        ...(dto.tags !== undefined ? { tags: dto.tags as any } : {}),
      },
    });
    return this.getDataset(datasetId);
  }

  async deleteCase(datasetId: string, caseId: string) {
    const existing = await this.prisma.aiEvalCase.findUnique({
      where: { id: caseId },
      select: { id: true, datasetId: true },
    });
    if (!existing || existing.datasetId !== datasetId) {
      throw new NotFoundException('Eval case not found');
    }
    await this.prisma.aiEvalCase.delete({ where: { id: caseId } });
    return this.getDataset(datasetId);
  }

  /** 进程重启后遗留的 RUNNING：超过 30 分钟统一标 FAILED。 */
  private async recoverStaleRuns(): Promise<void> {
    const cutoff = new Date(Date.now() - 30 * 60 * 1000);
    await this.prisma.aiEvalRun
      .updateMany({
        where: { status: 'RUNNING', startedAt: { lt: cutoff } },
        data: {
          status: 'FAILED',
          finishedAt: new Date(),
          summary: { error: 'run interrupted: stale RUNNING' },
        },
      })
      .catch((err) =>
        this.logger.warn(
          `[eval] stale run recovery failed: ${err?.message ?? err}`,
        ),
      );
  }

  async startRun(
    datasetId: string,
    createdBy?: string,
    options: StartRunOptions = {},
  ) {
    const dataset = await this.prisma.aiEvalDataset.findUnique({
      where: { id: datasetId },
      include: { cases: true },
    });
    if (!dataset) throw new NotFoundException('Eval dataset not found');
    if (dataset.cases.length === 0) {
      throw new NotFoundException('Eval dataset has no cases');
    }

    const missingExpectation = dataset.cases.filter(
      (item) => !this.hasKeys(this.resolveExpectation(item)),
    );
    if (missingExpectation.length > 0) {
      throw new BadRequestException(
        `${missingExpectation.length} case(s) have no expectation; add expect.mustMention or expected before running`,
      );
    }

    await this.recoverStaleRuns();
    const running = await this.prisma.aiEvalRun.findFirst({
      where: { datasetId, status: 'RUNNING' },
      select: { id: true },
    });
    if (running) {
      throw new BadRequestException(
        'This dataset already has a run in progress',
      );
    }

    const mode: EvalMode = options.mode === 'LIVE' ? 'LIVE' : 'STORED';
    if (mode === 'LIVE' && !process.env.AI_EVAL_LIVE_USER_ID?.trim()) {
      throw new BadRequestException(
        'AI_EVAL_LIVE_USER_ID must be configured for live eval',
      );
    }
    const baselineRunId = options.baselineRunId?.trim() || null;
    if (baselineRunId) {
      await this.assertBaselineRun(baselineRunId, datasetId);
    }

    const run = await this.prisma.aiEvalRun.create({
      data: { datasetId, createdBy, mode, baselineRunId },
    });
    void this.executeRun(run.id).catch((err) => {
      this.logger.error(`Eval run ${run.id} failed: ${err?.message ?? err}`);
    });
    return run;
  }

  /** 基线必须是同一评测集、且已完成，避免拿半截运行做对比。 */
  private async assertBaselineRun(
    baselineRunId: string,
    datasetId: string,
  ): Promise<void> {
    const baseline = await this.prisma.aiEvalRun.findUnique({
      where: { id: baselineRunId },
      select: { id: true, datasetId: true, status: true },
    });
    if (!baseline || baseline.datasetId !== datasetId) {
      throw new BadRequestException(
        'baselineRunId must reference a run in the same dataset',
      );
    }
    if (baseline.status !== 'COMPLETED') {
      throw new BadRequestException('baselineRunId must be a completed run');
    }
  }

  async getRun(id: string) {
    await this.recoverStaleRuns();
    const run = await this.prisma.aiEvalRun.findUnique({
      where: { id },
      include: {
        results: {
          include: { case: true },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!run) throw new NotFoundException('Eval run not found');
    return run;
  }

  private async executeRun(runId: string): Promise<void> {
    const run = await this.prisma.aiEvalRun.findUnique({
      where: { id: runId },
      include: { dataset: { include: { cases: true } } },
    });
    if (!run) return;

    const mode: EvalMode = run.mode === 'LIVE' ? 'LIVE' : 'STORED';
    const baselineRunId = run.baselineRunId ?? null;
    const baseline = baselineRunId
      ? await this.loadBaseline(baselineRunId)
      : null;

    let solved = 0;
    let partial = 0;
    let unsolved = 0;
    const caseVerdicts: CaseVerdict[] = [];
    try {
      for (const item of run.dataset.cases) {
        const started = Date.now();
        const expectTask = this.resolveExpectation(item);

        // STORED：复用用例里保存的历史回答（原有行为）。
        // LIVE：真实调用 AI 客服链路，拿到实际回答后再判分。
        let answer = item.answer;
        let actualAnswer: string | null = null;
        let pendingConfirm: Record<string, any> | null = null;
        let traceId: string | null = null;
        let liveError: string | null = null;

        if (mode === 'LIVE') {
          try {
            const live = await this.runLiveCase(runId, item.id, item.question);
            answer = live.answer;
            actualAnswer = live.answer;
            pendingConfirm = live.pendingConfirm;
            // eval 不再伪造 traceId：testChat 不写 trace，留 null 比悬空 id 诚实。
            traceId = null;
          } catch (err: any) {
            // 单条用例的 AI 故障不拖垮整次评测：记 unsolved 并继续下一条。
            liveError = String(err?.message ?? err).slice(0, 200);
            this.logger.warn(
              `[eval] live case ${item.id} failed in run ${runId}: ${liveError}`,
            );
          }
        }

        const verdict = liveError
          ? {
              verdict: 'unsolved' as const,
              score: 0,
              reason: `live_failed: ${liveError}`,
              judgeModel: null,
              judgeVendor: null,
              vendorIndependent: null,
            }
          : await this.judge.judge({
              question: item.question,
              answer,
              expectTask: expectTask as any,
              pendingConfirm,
            });

        if (verdict.verdict === 'solved') solved += 1;
        else if (verdict.verdict === 'partial') partial += 1;
        else unsolved += 1;
        caseVerdicts.push({ caseId: item.id, verdict: verdict.verdict });

        const result = await this.prisma.aiEvalResult.create({
          data: {
            runId,
            caseId: item.id,
            verdict: verdict.verdict,
            score: verdict.score,
            reason: verdict.reason,
            actualAnswer,
            judgeModel: verdict.judgeModel ?? null,
            judgeVendor: verdict.judgeVendor ?? null,
            vendorIndependent: verdict.vendorIndependent ?? null,
            traceId,
            latencyMs: Date.now() - started,
          },
        });

        // 统一评分：评测结果同时落一条 AiScore，供 trace 详情和质量趋势复用。
        await this.prisma.aiScore
          .create({
            data: {
              traceId,
              conversationId: null,
              messageId: null,
              source: 'LLM',
              value: verdict.score,
              stringValue: verdict.verdict,
              comment: verdict.reason.slice(0, 500),
              metadata: {
                evalRunId: runId,
                evalResultId: result.id,
                caseId: item.id,
                judgeModel: verdict.judgeModel ?? null,
                judgeVendor: verdict.judgeVendor ?? null,
              },
            },
          })
          .catch((err) =>
            this.logger.warn(
              `[eval] score write failed for result ${result.id}: ${err?.message ?? err}`,
            ),
          );
      }
      const total = run.dataset.cases.length;
      const passRate =
        total > 0 ? Number((solved / total).toFixed(3)) : 0;
      await this.prisma.aiEvalRun.update({
        where: { id: runId },
        data: {
          status: 'COMPLETED',
          finishedAt: new Date(),
          summary: this.buildSummary({
            mode,
            baselineRunId,
            total,
            solved,
            partial,
            unsolved,
            passRate,
            caseVerdicts,
            baseline,
          }),
        },
      });
    } catch (err: any) {
      await this.prisma.aiEvalRun.update({
        where: { id: runId },
        data: {
          status: 'FAILED',
          finishedAt: new Date(),
          summary: {
            mode,
            baselineRunId,
            error: String(err?.message ?? err).slice(0, 300),
          },
        },
      });
      throw err;
    }
  }

  /**
   * 期望任务优先取 expect；旧用例的 expect 可能只是空对象，
   * 此时回退到新增的 expected 字段。
   */
  private resolveExpectation(item: {
    expect?: unknown;
    expected?: unknown;
  }): Record<string, any> {
    const primary = item.expect;
    if (this.hasKeys(primary)) return primary as Record<string, any>;
    const fallback = item.expected;
    // 允许调用方只给一句期望答案：等价于 mustMention。
    if (typeof fallback === 'string' && fallback.trim()) {
      return { mustMention: [fallback.trim()] };
    }
    if (this.hasKeys(fallback)) return fallback as Record<string, any>;
    return (primary as Record<string, any>) ?? {};
  }

  private hasKeys(value: unknown): boolean {
    return (
      !!value &&
      typeof value === 'object' &&
      Object.keys(value as Record<string, unknown>).length > 0
    );
  }

  /**
   * 实时评测适配器：走真实 AI 客服 graph（testChat），不复用 SSE/落库链路。
   * 每条用例独立 thread，避免上下文互相污染；testChat 不写 trace，结果 traceId 留空。
   */
  private async runLiveCase(
    runId: string,
    caseId: string,
    question: string,
  ): Promise<{
    answer: string;
    pendingConfirm: Record<string, any> | null;
  }> {
    const userId = process.env.AI_EVAL_LIVE_USER_ID?.trim();
    if (!userId) {
      throw new Error('AI_EVAL_LIVE_USER_ID is not configured');
    }
    const sessionId = `eval-${runId}-${caseId}`;
    const result = await runWithContext({ userId }, () =>
      this.aiCustomer.testChat(question, userId, false, sessionId),
    );
    const answer =
      typeof result?.agentOutput === 'string' ? result.agentOutput : '';
    if (!answer.trim()) {
      throw new Error('live AI returned an empty answer');
    }
    return {
      answer,
      pendingConfirm: result?.pendingConfirm ?? null,
    };
  }

  private async loadBaseline(runId: string): Promise<BaselineSnapshot> {
    const baseline = await this.prisma.aiEvalRun.findUnique({
      where: { id: runId },
      select: {
        summary: true,
        results: { select: { caseId: true, verdict: true } },
      },
    });
    if (!baseline) {
      return { passRate: 0, verdictByCase: new Map() };
    }
    const verdictByCase = new Map<string, string>();
    for (const item of baseline.results) {
      verdictByCase.set(item.caseId, item.verdict);
    }
    const summary = (baseline.summary ?? {}) as Record<string, any>;
    const solved = baseline.results.filter(
      (item) => item.verdict === 'solved',
    ).length;
    const passRate =
      typeof summary.passRate === 'number'
        ? summary.passRate
        : baseline.results.length > 0
          ? Number((solved / baseline.results.length).toFixed(3))
          : 0;
    return { passRate, verdictByCase };
  }

  private buildSummary(input: {
    mode: EvalMode;
    baselineRunId: string | null;
    total: number;
    solved: number;
    partial: number;
    unsolved: number;
    passRate: number;
    caseVerdicts: CaseVerdict[];
    baseline: BaselineSnapshot | null;
  }): Record<string, any> {
    const summary: Record<string, any> = {
      total: input.total,
      solved: input.solved,
      partial: input.partial,
      unsolved: input.unsolved,
      passRate: input.passRate,
      mode: input.mode,
      baselineRunId: input.baselineRunId,
    };
    if (!input.baselineRunId || !input.baseline) return summary;

    let newFailures = 0;
    let fixed = 0;
    for (const item of input.caseVerdicts) {
      const baselineVerdict = input.baseline.verdictByCase.get(item.caseId);
      if (!baselineVerdict) continue;
      const baselinePassed = baselineVerdict === 'solved';
      const currentPassed = item.verdict === 'solved';
      if (baselinePassed && !currentPassed) newFailures += 1;
      if (!baselinePassed && currentPassed) fixed += 1;
    }

    summary.baselinePassRate = input.baseline.passRate;
    summary.delta = Number(
      (input.passRate - input.baseline.passRate).toFixed(3),
    );
    summary.newFailures = newFailures;
    summary.fixed = fixed;
    return summary;
  }
}
