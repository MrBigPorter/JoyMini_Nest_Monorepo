import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '@api/common/prisma/prisma.service';
import { redactPiiText } from '@api/common/utils/pii-redaction';
import { CorpusFingerprintService } from '@api/common/knowledge/corpus-fingerprint.service';
import { evaluateKnowledgeStability } from '@api/common/knowledge/corpus-fingerprint';
import type { AiCustomerService } from '@api/client/ai-customer/ai-customer.service';
import { runWithContext } from '@api/common/logger/trace-context';
import { AiEvalJudgeService } from './ai-eval-judge.service';
import { AddEvalCasesDto } from './dto/eval-dataset.dto';
import {
  CreateExternalRunDto,
  ExternalEvalCaseSnapshotDto,
  ExternalEvalResultDto,
  IngestExternalResultsDto,
  JUDGE_FAILURE_KINDS,
} from './dto/external-eval.dto';
import { AI_EVAL_QUEUE, AI_EVAL_RUN_JOB, AiEvalJobData } from './ai-eval.queue';
import { computeKbRegressionStatus } from './kb-regression.util';
import {
  evaluateRunEvidence,
  maxHarnessFailureRate,
} from './run-evidence.util';

export type EvalMode = 'STORED' | 'LIVE' | 'EXTERNAL';

/** 外部运行物化出的数据集名前缀；同时用于阻止对 harness 数据集启动 STORED/LIVE 重跑。 */
export const EXTERNAL_DATASET_PREFIX = 'e2e:';

/** EXTERNAL run 可能跑几小时，stale 清扫阈值放宽到 24 小时。 */
export const EXTERNAL_RUN_STALE_MS = 24 * 60 * 60 * 1000;

/** 内部 run 的 stale 阈值。 */
export const INTERNAL_RUN_STALE_MS = 30 * 60 * 1000;

/** 注入令牌：避免评测服务直接依赖客服 graph 的庞大运行时依赖。 */
export const AI_EVAL_LIVE_AI = 'AI_EVAL_LIVE_AI';

/**
 * 指标定义版本（与 tools/eval/e2e/metrics-spec.mjs 的 METRIC_SPEC_VERSION 同步）。
 * 只有同一版本下的运行才能登记为基线，否则数字不可直接比较。
 */
export const CURRENT_METRIC_SPEC_VERSION = '3';

/** 基线准入的判官失败率上限；可用 EVAL_MAX_JUDGE_ERROR_RATE 覆盖。 */
export const DEFAULT_MAX_JUDGE_ERROR_RATE = 0.02;

/**
 * 基线准入的判官一致性下限（judgeAgreement = 全票一致用例 / ≥2 次成功用例）；
 * 可用 EVAL_MIN_JUDGE_AGREEMENT 覆盖。缺失时视为无法验证稳定性，一律拒绝。
 */
export const DEFAULT_MIN_JUDGE_AGREEMENT = 0.95;

/**
 * promote 的事务级 advisory lock：并发提升基线时串行化「先清旧基线、再写新基线」，
 * 避免两个请求同时通过校验后各写一条 isBaseline=true。
 */
export const PROMOTE_BASELINE_LOCK_KEY = 4127401;

/**
 * Token 估算口径（不是真实 usage）。
 *
 * testChat / judge 都不回传 token 用量，所以只能按字符数估算：
 *   estimatedTokens = ceil((question.length + answer.length + overhead) / 4)
 * - 4 字符 ≈ 1 token（中英混排的粗估，中文会低估）；
 * - overhead 是固定指令/prompt 包装开销（字符），只覆盖 judge 提示词与
 *   JSON 外壳，不含 RAG 检索上下文；
 * - 估算只用于预算护栏和成本可见性，不能当作真实账单。
 */
export const EVAL_ESTIMATE_CHARS_PER_TOKEN = 4;
export const EVAL_ESTIMATE_PROMPT_OVERHEAD_CHARS = 600;

/** 单次 run 的默认 token 预算；AI_EVAL_RUN_TOKEN_BUDGET <= 0 时关闭护栏。 */
export const DEFAULT_EVAL_RUN_TOKEN_BUDGET = 200_000;

interface EvalUsageEstimate {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

interface EvalRunUsage {
  estimatedTokens: number;
  promptTokens: number;
  completionTokens: number;
  budget: number;
  exceeded: boolean;
}

/**
 * 估算一条用例的 token 用量。
 * 总量严格按需求公式一次取整；成本拆分用 prompt 部分，回答部分取差值。
 */
export function estimateEvalCaseTokens(
  question: string,
  answer: string | null | undefined,
  overheadChars = EVAL_ESTIMATE_PROMPT_OVERHEAD_CHARS,
): EvalUsageEstimate {
  const questionLength = typeof question === 'string' ? question.length : 0;
  const answerLength = typeof answer === 'string' ? answer.length : 0;
  const promptTokens = Math.ceil(
    (questionLength + overheadChars) / EVAL_ESTIMATE_CHARS_PER_TOKEN,
  );
  const totalTokens = Math.ceil(
    (questionLength + answerLength + overheadChars) /
      EVAL_ESTIMATE_CHARS_PER_TOKEN,
  );
  return {
    promptTokens,
    completionTokens: Math.max(0, totalTokens - promptTokens),
    totalTokens,
  };
}

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
  verdictByCase: Map<string, string | null>;
}

interface AnswerBaselineSnapshot {
  accuracy: number | null;
  verdictByCase: Map<string, string | null>;
}

/** run.datasetSnapshot 的结构；hash 存的是 harness 传来的 datasetFingerprint。 */
interface ExternalDatasetSnapshot {
  hash: string;
  cases: Array<{
    caseId: string;
    kind?: string;
    question: string;
    expectedDocIds: string[];
    lang?: string;
  }>;
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
    @InjectQueue(AI_EVAL_QUEUE)
    private readonly queue: Queue<AiEvalJobData>,
    private readonly corpusFingerprint: CorpusFingerprintService,
  ) {}

  async listDatasets() {
    await this.recoverStaleRuns();
    return this.prisma.aiEvalDataset.findMany({
      orderBy: { updatedAt: 'desc' },
      include: { _count: { select: { cases: true, runs: true } } },
    });
  }

  /** harness 物化的数据集是快照，任何控制台写操作都会破坏同步与历史证据。 */
  private assertDatasetWritable(
    name: string | null | undefined,
    action: string,
  ): void {
    if (
      typeof name === 'string' &&
      name.trim().toLowerCase().startsWith(EXTERNAL_DATASET_PREFIX)
    ) {
      throw new BadRequestException(
        `External harness datasets are read-only; cannot ${action}`,
      );
    }
  }

  async createDataset(input: {
    name: string;
    description?: string;
    createdBy?: string;
  }) {
    if (input.name.trim().toLowerCase().startsWith(EXTERNAL_DATASET_PREFIX)) {
      throw new BadRequestException(
        'Dataset name prefix "e2e:" is reserved for harness snapshots',
      );
    }
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
      select: { id: true, name: true },
    });
    if (!dataset) throw new NotFoundException('Eval dataset not found');
    this.assertDatasetWritable(dataset.name, 'add cases');

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
    const dataset = await this.prisma.aiEvalDataset.findUnique({
      where: { id: datasetId },
      select: { name: true },
    });
    this.assertDatasetWritable(dataset?.name, 'edit cases');
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
    const dataset = await this.prisma.aiEvalDataset.findUnique({
      where: { id: datasetId },
      select: { name: true },
    });
    this.assertDatasetWritable(dataset?.name, 'delete cases');
    await this.prisma.aiEvalCase.delete({ where: { id: caseId } });
    return this.getDataset(datasetId);
  }

  /**
   * 进程重启后遗留的 RUNNING 统一标 FAILED。
   * - 内部 run（STORED/LIVE）：30 分钟。
   * - EXTERNAL run：harness 可能跑几小时，阈值 24 小时，且不受内部清扫影响。
   */
  private async recoverStaleRuns(): Promise<void> {
    const now = Date.now();
    await this.prisma.aiEvalRun
      .updateMany({
        where: {
          status: 'RUNNING',
          mode: { not: 'EXTERNAL' },
          startedAt: { lt: new Date(now - INTERNAL_RUN_STALE_MS) },
        },
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
    await this.prisma.aiEvalRun
      .updateMany({
        where: {
          status: 'RUNNING',
          mode: 'EXTERNAL',
          startedAt: { lt: new Date(now - EXTERNAL_RUN_STALE_MS) },
        },
        data: {
          status: 'FAILED',
          finishedAt: new Date(),
          summary: {
            mode: 'EXTERNAL',
            error: 'run interrupted: stale EXTERNAL run',
          },
        },
      })
      .catch((err) =>
        this.logger.warn(
          `[eval] stale external run recovery failed: ${err?.message ?? err}`,
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
    // harness 物化的数据集只有快照，没有可复用的历史回答/期望；只能走外部写入。
    if (
      typeof dataset.name === 'string' &&
      dataset.name.startsWith(EXTERNAL_DATASET_PREFIX)
    ) {
      throw new BadRequestException(
        'External harness datasets cannot be started from the admin console',
      );
    }
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
    // EXTERNAL run 由 harness 写入，不占用「每数据集仅一个 RUNNING」的名额。
    const running = await this.prisma.aiEvalRun.findFirst({
      where: { datasetId, status: 'RUNNING', mode: { not: 'EXTERNAL' } },
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
    const baselineRunId = await this.resolveBaselineRunId(
      datasetId,
      options.baselineRunId,
    );

    const run = await this.prisma.aiEvalRun.create({
      data: { datasetId, createdBy, mode, baselineRunId },
    });
    try {
      await this.queue.add(
        AI_EVAL_RUN_JOB,
        { runId: run.id },
        {
          // run id 即 jobId：同一 run 重复投递只会保留一个作业。
          jobId: run.id,
          // executeRun 自己负责失败落库；重试会产生重复判分与重复结果。
          attempts: 1,
          removeOnComplete: 1_000,
          // 失败 job 保留，便于按 run id 排查；run 本身已落 FAILED。
          removeOnFail: false,
        },
      );
    } catch (err: any) {
      // Redis/队列不可用时不能留下一个永久 RUNNING 的 run。
      const error = String(err?.message ?? err).slice(0, 300);
      await this.prisma.aiEvalRun
        .update({
          where: { id: run.id },
          data: {
            status: 'FAILED',
            finishedAt: new Date(),
            summary: { mode, baselineRunId, error: `enqueue failed: ${error}` },
          },
        })
        .catch((updateErr) =>
          this.logger.error(
            `Eval run ${run.id} enqueue failed and FAILED update failed: ${updateErr?.message ?? updateErr}`,
          ),
        );
      throw err;
    }
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

  /**
   * 未显式指定 baselineRunId 时回退到当前基线。
   * 只认同一个 dataset 的基线：跨数据集（不同 fingerprint）的用例 id 无法对齐，
   * 拿来做对比只会产生假的「新增失败 / 修复」。
   */
  private async findBaselineRunId(datasetId: string): Promise<string | null> {
    const baseline = await this.prisma.aiEvalRun.findFirst({
      where: { isBaseline: true, datasetId },
      orderBy: { finishedAt: 'desc' },
      select: { id: true },
    });
    return baseline?.id ?? null;
  }

  private async resolveBaselineRunId(
    datasetId: string,
    explicit?: string | null,
  ): Promise<string | null> {
    const trimmed = explicit?.trim() || null;
    if (trimmed) {
      await this.assertBaselineRun(trimmed, datasetId);
      return trimmed;
    }
    return this.findBaselineRunId(datasetId);
  }

  private maxJudgeErrorRate(): number {
    const raw = process.env.EVAL_MAX_JUDGE_ERROR_RATE;
    if (raw == null || raw.trim() === '') {
      return DEFAULT_MAX_JUDGE_ERROR_RATE;
    }
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      this.logger.warn(
        `[eval] invalid EVAL_MAX_JUDGE_ERROR_RATE=${raw}; falling back to ${DEFAULT_MAX_JUDGE_ERROR_RATE}`,
      );
      return DEFAULT_MAX_JUDGE_ERROR_RATE;
    }
    return value;
  }

  private minJudgeAgreement(): number {
    const raw = process.env.EVAL_MIN_JUDGE_AGREEMENT;
    if (raw == null || raw.trim() === '') {
      return DEFAULT_MIN_JUDGE_AGREEMENT;
    }
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      this.logger.warn(
        `[eval] invalid EVAL_MIN_JUDGE_AGREEMENT=${raw}; falling back to ${DEFAULT_MIN_JUDGE_AGREEMENT}`,
      );
      return DEFAULT_MIN_JUDGE_AGREEMENT;
    }
    return value;
  }

  /**
   * 登记基线：只有 COMPLETED、判官失败率达标、版本齐全且指标版本一致时才允许。
   * 事务内用 advisory lock 串行化，保证全局至多一条 isBaseline。
   */
  async promoteRun(id: string) {
    const run = await this.prisma.aiEvalRun.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        summary: true,
        codeVersion: true,
        judgeSpecVersion: true,
        metricSpecVersion: true,
        datasetSnapshot: true,
        scope: true,
      },
    });
    if (!run) throw new NotFoundException('Eval run not found');
    if (run.status !== 'COMPLETED') {
      throw new BadRequestException(
        `Run is ${run.status}; only COMPLETED runs can be promoted`,
      );
    }
    // 子集是变更后的诊断结果，语料与用例集都不是全量，不能当基线。
    if (run.scope === 'subset') {
      throw new BadRequestException(
        'Subset runs are diagnostic only and cannot be promoted; ' +
          'run a full-scope regression first',
      );
    }

    const summary = (run.summary ?? {}) as Record<string, any>;
    const judgeErrorRate =
      typeof summary.judgeErrorRate === 'number'
        ? summary.judgeErrorRate
        : null;
    if (judgeErrorRate === null) {
      throw new BadRequestException(
        'Run summary has no judgeErrorRate; cannot verify judge reliability',
      );
    }
    const threshold = this.maxJudgeErrorRate();
    if (!(judgeErrorRate < threshold)) {
      const kinds = Array.isArray(summary.judgeErrorKinds)
        ? summary.judgeErrorKinds
            .map((item: any) => `${item.kind}×${item.count}`)
            .join(', ')
        : '—';
      throw new BadRequestException(
        `judgeErrorRate ${(judgeErrorRate * 100).toFixed(2)}% is not below ` +
          `${(threshold * 100).toFixed(2)}% (${kinds})`,
      );
    }

    const snapshot = (run.datasetSnapshot ?? null) as {
      hash?: unknown;
    } | null;
    const missing: string[] = [];
    if (!run.codeVersion?.trim()) missing.push('codeVersion');
    if (typeof snapshot?.hash !== 'string' || !snapshot.hash.trim()) {
      missing.push('datasetSnapshot.hash');
    }
    if (!run.judgeSpecVersion?.trim()) missing.push('judgeSpecVersion');
    if (!run.metricSpecVersion?.trim()) missing.push('metricSpecVersion');
    if (missing.length > 0) {
      throw new BadRequestException(
        `Cannot promote: missing ${missing.join(', ')}`,
      );
    }
    if (run.metricSpecVersion !== CURRENT_METRIC_SPEC_VERSION) {
      throw new BadRequestException(
        `metricSpecVersion ${run.metricSpecVersion} != current ` +
          `${CURRENT_METRIC_SPEC_VERSION}; results are not comparable`,
      );
    }

    const judgeAgreement =
      typeof summary.judgeAgreement === 'number' &&
      Number.isFinite(summary.judgeAgreement)
        ? summary.judgeAgreement
        : null;
    if (judgeAgreement === null) {
      throw new BadRequestException(
        'Run summary has no judgeAgreement; cannot verify judge stability ' +
          '(re-judge with EVAL_JUDGE_REPEATS >= 3 to measure it)',
      );
    }
    const minAgreement = this.minJudgeAgreement();
    if (!(judgeAgreement >= minAgreement)) {
      const measured =
        typeof summary.judgeAgreementMeasured === 'number'
          ? ` (measured on ${summary.judgeAgreementMeasured} cases)`
          : '';
      throw new BadRequestException(
        `judgeAgreement ${(judgeAgreement * 100).toFixed(2)}% is not at least ` +
          `${(minAgreement * 100).toFixed(2)}%${measured}`,
      );
    }

    await this.prisma.$transaction(async (tx) => {
      // pg_advisory_xact_lock 返回 void，Prisma 无法反序列化，显式转 text。
      await tx.$queryRawUnsafe(
        'SELECT pg_advisory_xact_lock($1)::text',
        PROMOTE_BASELINE_LOCK_KEY,
      );
      await tx.aiEvalRun.updateMany({
        where: { isBaseline: true, id: { not: id } },
        data: { isBaseline: false },
      });
      await tx.aiEvalRun.update({
        where: { id },
        data: { isBaseline: true },
      });
    });

    return this.getRun(id);
  }

  /**
   * 知识库回归状态：实时比对当前语料与上次全量运行快照。
   * 不缓存，也不订阅发布事件——事件只做通知，状态以本次查询为准。
   */
  async getKbRegressionStatus() {
    const current = await this.corpusFingerprint.getCurrent();
    const [baseline, lastSubsetRun] = await Promise.all([
      this.prisma.aiEvalRun.findFirst({
        where: {
          mode: 'EXTERNAL',
          status: 'COMPLETED',
          scope: 'full',
          knowledgeFingerprint: { not: null },
        },
        orderBy: [{ finishedAt: 'desc' }, { startedAt: 'desc' }],
        select: {
          id: true,
          finishedAt: true,
          knowledgeFingerprint: true,
          knowledgeSnapshot: true,
          datasetSnapshot: true,
        },
      }),
      this.prisma.aiEvalRun.findFirst({
        where: { mode: 'EXTERNAL', status: 'COMPLETED', scope: 'subset' },
        orderBy: [{ finishedAt: 'desc' }, { startedAt: 'desc' }],
        select: {
          id: true,
          finishedAt: true,
          knowledgeFingerprint: true,
          knowledgeSnapshot: true,
          summary: true,
        },
      }),
    ]);
    return computeKbRegressionStatus({ current, baseline, lastSubsetRun });
  }

  /**
   * 发布证据：逐项校验并返回可读原因。
   * 与 promote 共用同一批评测规则；部署 job 只读这里的结果。
   */
  async getRunEvidence(id: string) {
    const run = await this.prisma.aiEvalRun.findUnique({
      where: { id },
      include: { results: { select: { judgeErrorKind: true } } },
    });
    if (!run) throw new NotFoundException('Eval run not found');
    const current = await this.corpusFingerprint.getCurrent();
    return evaluateRunEvidence({
      run,
      results: run.results,
      currentFingerprint: current.fingerprint,
      config: {
        maxJudgeErrorRate: this.maxJudgeErrorRate(),
        minJudgeAgreement: this.minJudgeAgreement(),
        maxHarnessFailureRate: maxHarnessFailureRate(),
        currentMetricSpecVersion: CURRENT_METRIC_SPEC_VERSION,
      },
    });
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

  /**
   * 取消一次运行：只把 RUNNING 改成 CANCELLED。
   * 已是终态时不做任何修改，直接返回当前 run（幂等）。
   * 正在执行的 executeRun 会在下一条用例前/判分后看到 CANCELLED 并停止。
   */
  async cancelRun(id: string) {
    const existing = await this.prisma.aiEvalRun.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('Eval run not found');

    await this.prisma.aiEvalRun.updateMany({
      where: { id, status: 'RUNNING' },
      data: {
        status: 'CANCELLED',
        finishedAt: new Date(),
        summary: { cancelled: true },
      },
    });
    return this.getRun(id);
  }

  /**
   * 创建一次外部（harness）运行：只落 RUNNING 头，结果稍后分段写入。
   *
   * 首次遇到某个 datasetFingerprint 时，把它物化成 `e2e:<fingerprint>` 数据集，
   * 这样 AiEvalRun.datasetId / AiEvalResult.caseId 的非空外键不用放松；
   * 同一 fingerprint 的后续 run 复用同一数据集与用例行。
   */
  async createExternalRun(input: CreateExternalRunDto, createdBy?: string) {
    if (input.cases.length === 0) {
      throw new BadRequestException('external run requires at least one case');
    }
    const seen = new Set<string>();
    for (const item of input.cases) {
      if (seen.has(item.caseId)) {
        throw new BadRequestException(`duplicate caseId: ${item.caseId}`);
      }
      seen.add(item.caseId);
    }

    const dataset = await this.ensureExternalDataset(
      input.datasetFingerprint,
      input.cases,
      createdBy,
    );

    const baselineRunId = await this.resolveBaselineRunId(
      dataset.id,
      input.baselineRunId,
    );

    const snapshot: ExternalDatasetSnapshot = {
      hash: input.datasetFingerprint,
      cases: input.cases.map((item) => ({
        caseId: item.caseId,
        ...(item.kind ? { kind: item.kind } : {}),
        question: redactPiiText(item.question) ?? '',
        expectedDocIds: item.expectedDocIds ?? [],
        ...(item.lang ? { lang: item.lang } : {}),
      })),
    };

    // 运行开始时取一次语料指纹。收尾时再取一次，用两次结果判断语料是否稳定。
    const corpusBefore = await this.corpusFingerprint.getCurrent();
    const harnessBefore = input.knowledgeFingerprintBefore ?? null;

    return this.prisma.aiEvalRun.create({
      data: {
        datasetId: dataset.id,
        createdBy,
        mode: 'EXTERNAL',
        baselineRunId,
        datasetSnapshot: snapshot as any,
        codeVersion: input.codeVersion,
        gateMode: input.gateMode,
        judgeSpecVersion: input.judgeSpecVersion,
        metricSpecVersion: input.metricSpecVersion,
        knowledgeFingerprint: corpusBefore.fingerprint,
        scope: input.scope ?? 'full',
        knowledgeSnapshot: {
          fingerprint: corpusBefore.fingerprint,
          generatedAt: corpusBefore.generatedAt,
          docs: corpusBefore.docs,
          pendingActivation: corpusBefore.pendingActivation,
          before: {
            server: corpusBefore.fingerprint,
            harness: harnessBefore,
          },
          after: null,
          stable: false,
          stableReason: 'run_in_progress',
        } as any,
      },
    });
  }

  /**
   * 写入外部运行的结果并收尾。只接受 RUNNING 的 EXTERNAL run，且结果不可修改；
   * 需要重跑只能新建 run，避免历史报告被静默改写。
   */
  async ingestExternalResults(runId: string, dto: IngestExternalResultsDto) {
    const run = await this.prisma.aiEvalRun.findUnique({
      where: { id: runId },
      include: { dataset: { include: { cases: true } } },
    });
    if (!run) throw new NotFoundException('Eval run not found');
    if (run.mode !== 'EXTERNAL') {
      throw new BadRequestException(
        'Only EXTERNAL runs accept externally written results',
      );
    }
    if (run.status !== 'RUNNING') {
      throw new BadRequestException(
        `Run is ${run.status}; external results are immutable`,
      );
    }
    const snapshot = run.datasetSnapshot as ExternalDatasetSnapshot | null;
    if (!snapshot || !Array.isArray(snapshot.cases)) {
      throw new BadRequestException('Run has no dataset snapshot');
    }
    const results = dto.cases ?? [];

    // 收尾时再取一次指纹，与创建时那一次、harness 上报的 before/after
    // 共同判定「这次运行是否跑在稳定语料上」。任一来源缺失都按不稳定处理。
    const storedSnapshot = (run.knowledgeSnapshot as any) ?? null;
    const serverBefore =
      run.knowledgeFingerprint ?? storedSnapshot?.before?.server ?? null;
    const harnessBefore =
      dto.knowledgeFingerprintBefore ?? storedSnapshot?.before?.harness ?? null;
    const harnessAfter = dto.knowledgeFingerprintAfter ?? null;
    const corpusAfter = await this.corpusFingerprint.getCurrent();
    const stability = evaluateKnowledgeStability({
      serverBefore,
      serverAfter: corpusAfter.fingerprint,
      harnessBefore,
      harnessAfter,
    });
    const knowledgeSnapshot = {
      fingerprint: serverBefore,
      generatedAt: corpusAfter.generatedAt,
      docs: corpusAfter.docs,
      pendingActivation: corpusAfter.pendingActivation,
      before: { server: serverBefore, harness: harnessBefore },
      after: { server: corpusAfter.fingerprint, harness: harnessAfter },
      stable: stability.stable,
      stableReason: stability.stableReason,
    };

    if (dto.status === 'FAILED') {
      await this.prisma.aiEvalRun.updateMany({
        where: { id: runId, status: 'RUNNING' },
        data: {
          status: 'FAILED',
          finishedAt: new Date(),
          knowledgeSnapshot: knowledgeSnapshot as any,
          summary: {
            mode: 'EXTERNAL',
            datasetFingerprint: snapshot.hash,
            codeVersion: run.codeVersion,
            gateMode: run.gateMode,
            judgeSpecVersion: run.judgeSpecVersion,
            metricSpecVersion: run.metricSpecVersion,
            error: dto.error ?? 'external run failed',
          },
        },
      });
      return this.getRun(runId);
    }

    if (results.length !== snapshot.cases.length) {
      throw new BadRequestException(
        `Expected ${snapshot.cases.length} results, received ${results.length}`,
      );
    }

    const caseIdByExternalId = this.mapExternalCaseIds(run.dataset.cases);
    const seen = new Set<string>();
    const rows = results.map((item) => {
      if (seen.has(item.caseId)) {
        throw new BadRequestException(
          `duplicate result caseId: ${item.caseId}`,
        );
      }
      seen.add(item.caseId);
      const caseId = caseIdByExternalId.get(item.caseId);
      if (!caseId) {
        throw new BadRequestException(`unknown caseId: ${item.caseId}`);
      }
      if (item.answerVerdict === 'judge_error' && !item.judgeErrorKind) {
        throw new BadRequestException(
          `judge_error requires judgeErrorKind (case ${item.caseId})`,
        );
      }
      return {
        runId,
        caseId,
        answerVerdict: item.answerVerdict,
        answerScore: item.answerScore ?? this.defaultAnswerScore(item),
        grounding: item.grounding ?? 'unknown',
        judgeErrorKind: item.judgeErrorKind ?? null,
        judgeInputHash: item.judgeInputHash ?? null,
        judgeSpecVersion: run.judgeSpecVersion,
        reason: item.reason,
        traceId: item.traceId ?? null,
        latencyMs: item.latencyMs ?? null,
      };
    });

    // run 创建后可能才 promote 基线；收尾时再回退一次，保证对比用的是当前基线。
    const baselineRunId =
      run.baselineRunId ?? (await this.findBaselineRunId(run.datasetId));
    const summary = await this.buildExternalSummary(
      { ...run, baselineRunId },
      results,
    );

    await this.prisma.$transaction(async (tx) => {
      const current = await tx.aiEvalRun.findUnique({
        where: { id: runId },
        select: { status: true },
      });
      if (current?.status !== 'RUNNING') {
        throw new BadRequestException(
          `Run is ${current?.status ?? 'missing'}; external results are immutable`,
        );
      }
      await tx.aiEvalResult.createMany({ data: rows });
      await tx.aiEvalRun.update({
        where: { id: runId },
        data: {
          status: 'COMPLETED',
          finishedAt: new Date(),
          summary: summary as any,
          baselineRunId,
          knowledgeSnapshot: knowledgeSnapshot as any,
        },
      });
    });

    return this.getRun(runId);
  }

  /** 首次物化 e2e 数据集；同 fingerprint 的后续调用复用并校验用例一致。 */
  private async ensureExternalDataset(
    fingerprint: string,
    cases: ExternalEvalCaseSnapshotDto[],
    createdBy?: string,
  ) {
    const name = `${EXTERNAL_DATASET_PREFIX}${fingerprint}`;
    const existing = await this.prisma.aiEvalDataset.findUnique({
      where: { name },
      include: { cases: true },
    });
    if (existing) {
      if (existing.cases.length !== cases.length) {
        throw new BadRequestException(
          `Dataset snapshot mismatch: dataset has ${existing.cases.length} cases, snapshot has ${cases.length}`,
        );
      }
      const existingIds = this.mapExternalCaseIds(existing.cases);
      for (const item of cases) {
        if (!existingIds.has(item.caseId)) {
          throw new BadRequestException(
            `Dataset snapshot mismatch: caseId ${item.caseId} not found in dataset`,
          );
        }
      }
      return existing;
    }

    try {
      return await this.prisma.aiEvalDataset.create({
        data: {
          name,
          description: `External e2e harness dataset (${fingerprint})`,
          createdBy,
          cases: {
            create: cases.map((item) => ({
              question: redactPiiText(item.question) ?? '',
              // harness 用例没有历史回答/任务期望；空值会让 startRun 拒绝重跑。
              answer: '',
              expect: {} as any,
              expected: (item.expectedDocIds?.length
                ? item.expectedDocIds
                : undefined) as any,
              tags: (item.kind ? [item.kind] : []) as any,
              source: 'e2e',
              metadata: {
                e2eCaseId: item.caseId,
                datasetFingerprint: fingerprint,
              } as any,
            })),
          },
        },
        include: { cases: true },
      });
    } catch (err: any) {
      // 并发创建同 fingerprint 时唯一约束失败：回读已建好的那条。
      if (err?.code === 'P2002') {
        const raced = await this.prisma.aiEvalDataset.findUnique({
          where: { name },
          include: { cases: true },
        });
        if (raced) return raced;
      }
      throw err;
    }
  }

  /** AIEvalCase.metadata.e2eCaseId → 数据库 caseId（外部 id 不是主键）。 */
  private mapExternalCaseIds(
    cases: Array<{ id: string; metadata: unknown }>,
  ): Map<string, string> {
    const map = new Map<string, string>();
    for (const item of cases) {
      const meta = (item.metadata ?? null) as { e2eCaseId?: unknown } | null;
      if (meta && typeof meta.e2eCaseId === 'string') {
        map.set(meta.e2eCaseId, item.id);
      }
    }
    return map;
  }

  private defaultAnswerScore(item: ExternalEvalResultDto): number {
    return item.answerVerdict === 'correct' ? 1 : 0;
  }

  /**
   * 外部运行汇总：准确率分母只含 correct + incorrect，judge_error 单独计错误率。
   * 任务成功率字段（solved/partial/unsolved）不在这里出现。
   */
  private async buildExternalSummary(
    run: {
      id: string;
      baselineRunId: string | null;
      datasetSnapshot: unknown;
      codeVersion: string | null;
      gateMode: string | null;
      judgeSpecVersion: string | null;
      metricSpecVersion: string | null;
      scope?: string | null;
    },
    results: ExternalEvalResultDto[],
  ): Promise<Record<string, any>> {
    const counts = { correct: 0, incorrect: 0, judge_error: 0 };
    const grounding: Record<string, number> = {};
    const judgeErrorKindCounts = new Map<string, number>();
    let judgeAttempted = 0;
    let judgeFailures = 0;
    for (const item of results) {
      counts[item.answerVerdict] += 1;
      const kind = item.grounding ?? 'unknown';
      grounding[kind] = (grounding[kind] ?? 0) + 1;
      if (item.answerVerdict !== 'judge_error') {
        judgeAttempted += 1;
        continue;
      }
      const errorKind = item.judgeErrorKind ?? 'unknown';
      // harness / not_applicable 没有调用过判官，不进错误率的分子分母。
      if (!(JUDGE_FAILURE_KINDS as readonly string[]).includes(errorKind)) {
        continue;
      }
      judgeAttempted += 1;
      judgeFailures += 1;
      judgeErrorKindCounts.set(
        errorKind,
        (judgeErrorKindCounts.get(errorKind) ?? 0) + 1,
      );
    }
    const judgeErrorKinds = [...judgeErrorKindCounts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([kind, count]) => ({ kind, count }));
    // 判官稳定性（metric spec v3）：只统计有 ≥2 次成功判定的用例；
    // 逐次判定留在 detail.json，这里只把汇总写进 summary Json。
    const agreementRows = results.filter(
      (item) => (item.judgeSuccessfulAttempts ?? 0) >= 2,
    );
    const judgeDisagreement = agreementRows.filter(
      (item) => item.judgeDisagreement === true,
    ).length;
    const unanimous = agreementRows.filter(
      (item) => item.judgeDisagreement !== true && item.judgeAgreement === 1,
    ).length;
    const judgeAgreement =
      agreementRows.length > 0
        ? Number((unanimous / agreementRows.length).toFixed(4))
        : null;
    const judged = counts.correct + counts.incorrect;
    const accuracy =
      judged > 0 ? Number((counts.correct / judged).toFixed(4)) : null;
    // 与 METRICS.md 一致：分母是实际调用过判官的判定；0 次调用时无定义。
    const judgeErrorRate =
      judgeAttempted > 0
        ? Number((judgeFailures / judgeAttempted).toFixed(4))
        : null;
    const snapshot = run.datasetSnapshot as ExternalDatasetSnapshot | null;

    const summary: Record<string, any> = {
      mode: 'EXTERNAL',
      total: results.length,
      correct: counts.correct,
      incorrect: counts.incorrect,
      judgeError: counts.judge_error,
      accuracy,
      judgeErrorRate,
      judgeErrorKinds,
      judgeAgreement,
      judgeAgreementMeasured: agreementRows.length,
      judgeDisagreement,
      scope: run.scope ?? 'full',
      selectedCaseCount: snapshot?.cases?.length ?? null,
      answerVerdicts: counts,
      grounding,
      datasetFingerprint: snapshot?.hash ?? null,
      codeVersion: run.codeVersion,
      gateMode: run.gateMode,
      judgeSpecVersion: run.judgeSpecVersion,
      metricSpecVersion: run.metricSpecVersion,
      baselineRunId: run.baselineRunId,
    };

    if (!run.baselineRunId) return summary;

    const baseline = await this.loadAnswerBaseline(run.baselineRunId);
    if (!baseline) return summary;

    return {
      ...summary,
      ...this.buildAnswerComparison(results, baseline),
    };
  }

  private async loadAnswerBaseline(
    runId: string,
  ): Promise<AnswerBaselineSnapshot | null> {
    const baseline = await this.prisma.aiEvalRun.findUnique({
      where: { id: runId },
      select: {
        summary: true,
        results: { select: { caseId: true, answerVerdict: true } },
      },
    });
    if (!baseline) return null;
    const verdictByCase = new Map<string, string | null>();
    for (const item of baseline.results) {
      verdictByCase.set(item.caseId, item.answerVerdict);
    }
    const summary = (baseline.summary ?? {}) as Record<string, any>;
    return {
      accuracy: typeof summary.accuracy === 'number' ? summary.accuracy : null,
      verdictByCase,
    };
  }

  private buildAnswerComparison(
    results: ExternalEvalResultDto[],
    baseline: AnswerBaselineSnapshot,
  ): Record<string, any> {
    let newFailures = 0;
    let fixed = 0;
    for (const item of results) {
      const previous = baseline.verdictByCase.get(item.caseId);
      if (previous === undefined) continue;
      const wasCorrect = previous === 'correct';
      const isCorrect = item.answerVerdict === 'correct';
      if (wasCorrect && !isCorrect) newFailures += 1;
      if (!wasCorrect && isCorrect) fixed += 1;
    }
    const judged = results.filter(
      (item) => item.answerVerdict !== 'judge_error',
    ).length;
    const correct = results.filter(
      (item) => item.answerVerdict === 'correct',
    ).length;
    const accuracy = judged > 0 ? Number((correct / judged).toFixed(4)) : null;
    const delta =
      accuracy !== null && baseline.accuracy !== null
        ? Number((accuracy - baseline.accuracy).toFixed(4))
        : null;
    return {
      baselineAccuracy: baseline.accuracy,
      delta,
      newFailures,
      fixed,
    };
  }

  /**
   * 由 BullMQ processor 调用（也可直接调用，便于测试/手动重放）。
   *
   * 幂等保护：只有 RUNNING 的 run 会执行；重复投递、已取消、已终态的
   * run 直接返回。每条用例判分前后都会重读状态，取消后不再处理剩余用例。
   */
  async executeRun(runId: string): Promise<void> {
    const run = await this.prisma.aiEvalRun.findUnique({
      where: { id: runId },
      include: { dataset: { include: { cases: true } } },
    });
    if (!run) return;
    // EXTERNAL run 的结果由 harness 通过接口写入，队列重跑会覆盖判定口径。
    if (run.mode === 'EXTERNAL') return;
    if (run.status !== 'RUNNING') return;

    const mode: EvalMode = run.mode === 'LIVE' ? 'LIVE' : 'STORED';
    // run 入队后才 promote 基线时，这里补一次回退并把实际基线写回 run。
    const baselineRunId =
      run.baselineRunId ?? (await this.findBaselineRunId(run.datasetId));
    if (!run.baselineRunId && baselineRunId) {
      await this.prisma.aiEvalRun
        .update({ where: { id: runId }, data: { baselineRunId } })
        .catch((err) =>
          this.logger.warn(
            `[eval] run ${runId} baseline write-back failed: ${err?.message ?? err}`,
          ),
        );
    }
    const baseline = baselineRunId
      ? await this.loadBaseline(baselineRunId)
      : null;

    let solved = 0;
    let partial = 0;
    let unsolved = 0;
    let budgetExceeded = false;
    const caseVerdicts: CaseVerdict[] = [];
    const usage = this.createUsageAccumulator();
    try {
      for (const item of run.dataset.cases) {
        // 进入下一条用例前先看状态：取消后不再发起新的 AI/judge 调用。
        if (!(await this.ensureRunning(runId, usage))) return;

        // 预算护栏：用「题目 + 历史回答 + 固定 prompt 开销」预估本条成本。
        // LIVE 模式跑之前拿不到实际回答，只能用用例里保存的回答做代理。
        const caseEstimate = estimateEvalCaseTokens(item.question, item.answer);
        if (
          usage.budget > 0 &&
          usage.estimatedTokens + caseEstimate.totalTokens > usage.budget
        ) {
          budgetExceeded = true;
          this.logger.warn(
            `[eval] run ${runId} token budget exceeded: used=${usage.estimatedTokens}, next=${caseEstimate.totalTokens}, budget=${usage.budget}`,
          );
          break;
        }

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

        // 已经发生的 AI/judge 调用要计入本 run；LIVE 用实际回答修正估算。
        this.addUsage(
          usage,
          estimateEvalCaseTokens(item.question, actualAnswer ?? answer),
        );

        // 判分期间可能已被取消：取消后丢弃这条结果，不再写库。
        if (!(await this.ensureRunning(runId, usage))) return;

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

      // 预算超限：停止后续用例并落 FAILED。条件更新保证 CANCELLED 优先。
      if (budgetExceeded) {
        usage.exceeded = true;
        const failed = await this.prisma.aiEvalRun.updateMany({
          where: { id: runId, status: 'RUNNING' },
          data: {
            status: 'FAILED',
            finishedAt: new Date(),
            summary: {
              mode,
              baselineRunId,
              error: 'token budget exceeded',
              usage: this.buildUsageSummary(usage),
            },
          },
        });
        if (failed.count === 0) await this.ensureRunning(runId, usage);
        return;
      }

      const total = run.dataset.cases.length;
      const passRate = total > 0 ? Number((solved / total).toFixed(3)) : 0;
      // 条件更新：若最后一条用例期间被取消，不要把 CANCELLED 覆盖回 COMPLETED。
      const completed = await this.prisma.aiEvalRun.updateMany({
        where: { id: runId, status: 'RUNNING' },
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
            usage,
          }),
        },
      });
      if (completed.count === 0) await this.ensureRunning(runId, usage);
    } catch (err: any) {
      // 条件更新：取消优先于失败，避免把 CANCELLED 覆盖成 FAILED。
      await this.prisma.aiEvalRun
        .updateMany({
          where: { id: runId, status: 'RUNNING' },
          data: {
            status: 'FAILED',
            finishedAt: new Date(),
            summary: {
              mode,
              baselineRunId,
              error: String(err?.message ?? err).slice(0, 300),
              usage: this.buildUsageSummary(usage),
            },
          },
        })
        .catch((updateErr) =>
          this.logger.error(
            `Eval run ${runId} FAILED update failed: ${updateErr?.message ?? updateErr}`,
          ),
        );
      throw err;
    }
  }

  /**
   * 读一次状态并返回是否还能继续。
   * - RUNNING：继续；
   * - CANCELLED：补齐 finishedAt/summary 后停止；
   * - 其他终态或行已不存在：静默停止（不覆盖已有终态）。
   */
  private async ensureRunning(
    runId: string,
    usage?: EvalRunUsage,
  ): Promise<boolean> {
    const current = await this.prisma.aiEvalRun.findUnique({
      where: { id: runId },
      select: { status: true },
    });
    if (!current) return false;
    if (current.status === 'RUNNING') return true;
    if (current.status === 'CANCELLED') await this.markCancelled(runId, usage);
    return false;
  }

  private async markCancelled(
    runId: string,
    usage?: EvalRunUsage,
  ): Promise<void> {
    // 取消发生在 executeRun 内时会把已消耗的估算一并落库；
    // 外部 cancelRun 没有内存累计值，只写 cancelled 标记。
    const summary: Record<string, any> = { cancelled: true };
    if (usage) summary.usage = this.buildUsageSummary(usage);
    // 只补 CANCELLED 行；避免极端竞态下把刚写好的 COMPLETED/FAILED 覆盖掉。
    await this.prisma.aiEvalRun.updateMany({
      where: { id: runId, status: 'CANCELLED' },
      data: {
        status: 'CANCELLED',
        finishedAt: new Date(),
        summary,
      },
    });
  }

  private createUsageAccumulator(): EvalRunUsage {
    return {
      estimatedTokens: 0,
      promptTokens: 0,
      completionTokens: 0,
      budget: this.resolveTokenBudget(),
      exceeded: false,
    };
  }

  /** 默认 200k；AI_EVAL_RUN_TOKEN_BUDGET <= 0 表示关闭预算护栏。 */
  private resolveTokenBudget(): number {
    const raw = Number(process.env.AI_EVAL_RUN_TOKEN_BUDGET);
    if (!Number.isFinite(raw)) return DEFAULT_EVAL_RUN_TOKEN_BUDGET;
    return raw <= 0 ? 0 : Math.floor(raw);
  }

  private addUsage(usage: EvalRunUsage, estimate: EvalUsageEstimate): void {
    usage.estimatedTokens += estimate.totalTokens;
    usage.promptTokens += estimate.promptTokens;
    usage.completionTokens += estimate.completionTokens;
  }

  /**
   * 只写 run.summary.usage，不写 ai_usage_daily：评测没有真实用户，
   * 记进用户用量会污染运营报表。价格未配置时 costConfigured=false。
   */
  private buildUsageSummary(usage: EvalRunUsage): Record<string, any> {
    const inputPer1M = this.numberEnv('AI_PRICE_INPUT_PER_1M', 0);
    const outputPer1M = this.numberEnv('AI_PRICE_OUTPUT_PER_1M', 0);
    const costConfigured = inputPer1M > 0 || outputPer1M > 0;
    const cost =
      (usage.promptTokens / 1_000_000) * inputPer1M +
      (usage.completionTokens / 1_000_000) * outputPer1M;
    return {
      estimatedTokens: usage.estimatedTokens,
      budget: usage.budget,
      exceeded: usage.exceeded,
      estimatedCostUsd: costConfigured ? Number(cost.toFixed(6)) : 0,
      costConfigured,
    };
  }

  private numberEnv(key: string, fallback: number): number {
    const value = Number(process.env[key]);
    return Number.isFinite(value) ? value : fallback;
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
    const verdictByCase = new Map<string, string | null>();
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
    usage: EvalRunUsage;
  }): Record<string, any> {
    const summary: Record<string, any> = {
      total: input.total,
      solved: input.solved,
      partial: input.partial,
      unsolved: input.unsolved,
      passRate: input.passRate,
      mode: input.mode,
      baselineRunId: input.baselineRunId,
      usage: this.buildUsageSummary(input.usage),
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
