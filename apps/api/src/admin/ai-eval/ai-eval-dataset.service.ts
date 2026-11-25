import {
  BadRequestException,
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { createHash } from 'crypto';
import { PrismaService } from '@api/common/prisma/prisma.service';
import { isPrismaUniqueConstraintError } from '@api/common/prisma/prisma-error';
import { redactPiiText } from '@api/common/utils/pii-redaction';
import { CorpusFingerprintService } from '@api/common/knowledge/corpus-fingerprint.service';
import { evaluateKnowledgeStability } from '@api/common/knowledge/corpus-fingerprint';
import type { AiCustomerService } from '@api/client/ai-customer/ai-customer.service';
import { runWithContext } from '@api/common/logger/trace-context';
import { classifyJudgeError } from '@api/admin/rag/judge-input-spec';
import { EVAL_RUN_RESULTS_LIMITS } from './dto/eval-input.validators';
import {
  AiEvalJudgeService,
  JudgeFailureError,
  TaskJudgeResult,
} from './ai-eval-judge.service';
import {
  EXTERNAL_METRIC_FAMILY,
  INTERNAL_METRIC_FAMILY,
  INTERNAL_METRIC_SPEC_VERSION,
} from './judge-spec';
import { PRELABEL_LABELER } from './annotation-labels';
import { AddEvalCasesDto } from './dto/eval-dataset.dto';
import {
  CreateExternalRunDto,
  ExternalEvalCaseSnapshotDto,
  ExternalEvalResultDto,
  IngestExternalResultsDto,
  JUDGE_ERROR_KINDS,
  JUDGE_FAILURE_KINDS,
  JudgeErrorKind,
} from './dto/external-eval.dto';
import { AI_EVAL_QUEUE, AI_EVAL_RUN_JOB, AiEvalJobData } from './ai-eval.queue';
import { computeKbRegressionStatus } from './kb-regression.util';
import {
  CaseDiffClass,
  CaseOutcome,
  classifyCaseDiff,
  outcomeFromAnswerVerdict,
  outcomeFromVerdict,
} from './case-history.util';
import {
  evaluateRunEvidence,
  maxHarnessFailureRate,
} from './run-evidence.util';

export type EvalMode = 'STORED' | 'LIVE' | 'EXTERNAL';

/**
 * run 级失败类别（见需求总纲 §4.2）：入队、预算、未捕获异常、心跳超时、判官整体不可用。
 * 单条失败不落这里——那是 judgeErrors / executionError 的事。
 */
/** 两次运行差异里单个用例的展示信息。 */
export interface CaseDiffItem {
  caseId: string;
  question: string;
  baselineVerdict: string | null;
  currentVerdict: string | null;
}

/** 判官三分类结论；只有这些值能与人工标注比对。 */
const JUDGE_VERDICT_VALUES = new Set(['solved', 'partial', 'unsolved']);

/** 校准最小样本量：低于它只报「样本不足」，不给百分比结论。 */
export const CALIBRATION_MIN_SAMPLE = 20;

export interface RunCalibrationDisagreement {
  caseId: string;
  question: string | null;
  judgeVerdict: string;
  humanCorrectness: string;
  judgeReason: string | null;
  humanComment: string;
  labelerId: string;
}

interface RunCalibrationBase {
  runId: string;
  datasetId: string;
  metricFamily: string;
  threshold: number;
  /** 可比对的标注数（人工标注 × 判官有结论） */
  n: number;
  /** 未纳入比对：预标注、判官失败、unsafe/abstain 等 */
  excluded: number;
  disagreements: RunCalibrationDisagreement[];
  note: string;
}

/**
 * 判官校准结果。样本充足时带一致率；样本不足时类型上就没有
 * agreementRate 字段，避免消费方把不存在的结论读成 0%。
 */
export type RunCalibration =
  | (RunCalibrationBase & {
      status: 'ok';
      agreements: number;
      /** 一致率百分比（保留一位小数） */
      agreementRate: number;
    })
  | (RunCalibrationBase & { status: 'insufficientSample' });

export type EvalFailureCategory =
  | 'enqueue'
  | 'budget'
  | 'unhandled'
  | 'heartbeat'
  | 'judge_unavailable';

/** 连续判官失败达熔断阈值：整单失败的专用错误，便于归类为 judge_unavailable。 */
export class JudgeCircuitOpenError extends Error {
  constructor(
    readonly failures: number,
    cause: string,
  ) {
    super(`judge failed ${failures} times in a row: ${cause}`);
    this.name = 'JudgeCircuitOpenError';
  }
}

/** 外部运行物化出的数据集名前缀；同时用于阻止对 harness 数据集启动 STORED/LIVE 重跑。 */
export const EXTERNAL_DATASET_PREFIX = 'e2e:';

/** EXTERNAL run 可能跑几小时，stale 清扫阈值放宽到 24 小时。 */
export const EXTERNAL_RUN_STALE_MS = 24 * 60 * 60 * 1000;

/** 内部 run 的 stale 阈值默认 30 分钟；可用 AI_EVAL_RUN_STALE_MS 覆盖（测试/压测）。 */
export const INTERNAL_RUN_STALE_MS = 30 * 60 * 1000;

/** 心跳最小写间隔：连跑时每条用例都写会把写放大成每 case 一次。 */
export const EVAL_HEARTBEAT_INTERVAL_MS = 30 * 1000;

/** 基线登记的最低样本量：总数与每种意图都要达标，防止小样本高准确率被登记。 */
export const MIN_PROMOTE_TOTAL_SAMPLES = 150;
export const MIN_PROMOTE_SAMPLES_PER_INTENT = 12;

function resolveInternalRunStaleMs(): number {
  const raw = Number(process.env.AI_EVAL_RUN_STALE_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : INTERNAL_RUN_STALE_MS;
}

/**
 * 连续判官失败熔断阈值（默认 5）。
 * 单条失败留痕后继续；连续失败到这个数说明判官整体不可用，
 * 再跑下去只会烧 token 产出一批同样不可信的数字，整单直接 FAILED。
 */
export const DEFAULT_JUDGE_FAILURE_CIRCUIT = 5;

function resolveJudgeFailureCircuit(): number {
  const raw = Number(process.env.AI_EVAL_JUDGE_FAILURE_CIRCUIT);
  return Number.isInteger(raw) && raw > 0 ? raw : DEFAULT_JUDGE_FAILURE_CIRCUIT;
}

/**
 * 内部 run 的用例快照哈希：只排序后的 caseId 集合，与顺序无关、与回答内容无关。
 * 同批用例任何时候复算都得到同一个值，用来回答「两次 run 是不是同一套题」。
 */
export function snapshotHashOfCaseIds(ids: string[]): string {
  return createHash('sha256')
    .update([...ids].sort().join('\n'))
    .digest('hex');
}

/**
 * 题干查重键：NFKC 抹平全半角，压缩空白并统一小写。
 * 只用于查重，不改写入值——审核者仍看到原始题干。
 */
export function normalizeEvalQuestion(question: string): string {
  return question.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
}

/** 运行代码版本：与 /health 同口径（APP_VERSION > GIT_SHA > unknown）。 */
export function resolveEvalCodeVersion(
  env: Record<string, string | undefined> = process.env,
): string {
  return env.APP_VERSION || env.GIT_SHA || 'unknown';
}

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
  /** 不传 = 回退到当前基线；null = 显式不对比 */
  baselineRunId?: string | null;
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

  /**
   * 每个 run 最近一次心跳写入时间（进程内）。
   * 只用来看是否到了 30s 写窗口，不参与存活判定——判定只认 DB 的 heartbeatAt。
   */
  private readonly lastHeartbeatAt = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly judge: AiEvalJudgeService,
    @Inject(AI_EVAL_LIVE_AI) private readonly aiCustomer: LiveAiRunner,
    @InjectQueue(AI_EVAL_QUEUE)
    private readonly queue: Queue<AiEvalJobData>,
    private readonly corpusFingerprint: CorpusFingerprintService,
  ) {}

  async listDatasets() {
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

  /** 分页参数统一入口：页大小上限由 spec 固定为 200。 */
  private resolvePage(options: { page?: number; pageSize?: number } = {}) {
    const page = options.page ?? 1;
    const pageSize =
      options.pageSize ?? EVAL_RUN_RESULTS_LIMITS.defaultPageSize;
    if (
      !Number.isInteger(pageSize) ||
      pageSize < 1 ||
      pageSize > EVAL_RUN_RESULTS_LIMITS.maxPageSize
    ) {
      throw new BadRequestException(
        `pageSize must be an integer between 1 and ${EVAL_RUN_RESULTS_LIMITS.maxPageSize}`,
      );
    }
    if (!Number.isInteger(page) || page < 1) {
      throw new BadRequestException('page must be an integer >= 1');
    }
    return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
  }

  /**
   * 数据集详情。`cases` 只承载当前页，总数用 `_count.cases`，
   * 避免大用例集把接口拖成全量拉取。
   */
  async getDataset(
    id: string,
    options: { page?: number; pageSize?: number } = {},
  ) {
    const { page, pageSize, skip, take } = this.resolvePage(options);
    const dataset = await this.prisma.aiEvalDataset.findUnique({
      where: { id },
      include: {
        runs: {
          orderBy: { startedAt: 'desc' },
          take: 20,
        },
        _count: { select: { runs: true, cases: true } },
      },
    });
    if (!dataset) throw new NotFoundException('Eval dataset not found');

    const cases = await this.prisma.aiEvalCase.findMany({
      where: { datasetId: id },
      orderBy: { createdAt: 'asc' },
      skip,
      take,
    });

    return {
      ...dataset,
      cases,
      casesTotal: dataset._count.cases,
      page,
      pageSize,
    };
  }

  async addCases(datasetId: string, dto: AddEvalCasesDto) {
    const dataset = await this.prisma.aiEvalDataset.findUnique({
      where: { id: datasetId },
      select: { id: true, name: true },
    });
    if (!dataset) throw new NotFoundException('Eval dataset not found');
    this.assertDatasetWritable(dataset.name, 'add cases');

    const existing = await this.prisma.aiEvalCase.findMany({
      where: { datasetId },
      select: { question: true },
    });
    const datasetKeys = new Set(
      existing.map((row) => normalizeEvalQuestion(row.question)),
    );
    const batchKeys = new Set<string>();
    const skipped: Array<{
      question: string;
      reason: 'DUPLICATE_IN_DATASET' | 'DUPLICATE_IN_BATCH';
    }> = [];
    const toCreate: typeof dto.cases = [];
    for (const item of dto.cases) {
      const key = normalizeEvalQuestion(item.question);
      if (datasetKeys.has(key)) {
        skipped.push({
          question: item.question,
          reason: 'DUPLICATE_IN_DATASET',
        });
        continue;
      }
      if (batchKeys.has(key)) {
        skipped.push({ question: item.question, reason: 'DUPLICATE_IN_BATCH' });
        continue;
      }
      batchKeys.add(key);
      toCreate.push(item);
    }

    if (toCreate.length > 0) {
      await this.prisma.aiEvalCase.createMany({
        data: toCreate.map((item) => ({
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
    }
    // createMany 不回传 id；分页后不能再靠「最后一页最后一条」定位新建项，
    // 所以按本次要创建的题干回查，供反馈「加入回归」直接关联。
    const createdCases =
      toCreate.length > 0
        ? await this.prisma.aiEvalCase.findMany({
            where: {
              datasetId,
              question: { in: toCreate.map((item) => item.question) },
            },
            select: { id: true, question: true },
          })
        : [];
    const result = await this.getDataset(datasetId);
    return { ...result, created: toCreate.length, skipped, createdCases };
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
      select: { id: true, datasetId: true, expect: true },
    });
    if (!existing || existing.datasetId !== datasetId) {
      throw new NotFoundException('Eval case not found');
    }
    const dataset = await this.prisma.aiEvalDataset.findUnique({
      where: { id: datasetId },
      select: { name: true },
    });
    this.assertDatasetWritable(dataset?.name, 'edit cases');
    // expect 是唯一判分来源；编辑只覆盖提交的文本字段，
    // confirmAction/forbidExecution/intent 等非文本条件必须保留。
    const mergedExpect =
      dto.expect !== undefined
        ? {
            ...((existing.expect as Record<string, any> | null) ?? {}),
            ...dto.expect,
          }
        : undefined;
    await this.prisma.aiEvalCase.update({
      where: { id: caseId },
      data: {
        ...(dto.question !== undefined ? { question: dto.question } : {}),
        ...(dto.answer !== undefined ? { answer: dto.answer } : {}),
        ...(mergedExpect !== undefined ? { expect: mergedExpect as any } : {}),
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
   * 清扫僵死 RUNNING。由 cron 任务（AiEvalRunSweepTask）与 startRun 调用，
   * 读接口不再清扫：GET 不应产生写副作用，也不该因为一次页面打开抢写锁。
   *
   * 存活判定只认 DB 的 heartbeatAt（无心跳的老行回退 startedAt）：
   * - 内部 run（STORED/LIVE）：心跳空闲超 AI_EVAL_RUN_STALE_MS（默认 30 分钟）；
   * - EXTERNAL run：harness 可能跑几小时，阈值 24 小时，且不受内部清扫影响。
   *
   * 为什么不能用 startedAt 判活：长跑会被误杀；为什么不能用进程内时间戳：
   * worker 被杀时内存一起消失，只有 DB 里停住的心跳能说明它死了。
   */
  async sweepStaleRuns(): Promise<void> {
    const now = Date.now();
    const internalCutoff = new Date(now - resolveInternalRunStaleMs());
    await this.prisma.aiEvalRun
      .updateMany({
        where: {
          status: 'RUNNING',
          mode: { not: 'EXTERNAL' },
          OR: [
            { heartbeatAt: { lt: internalCutoff } },
            { heartbeatAt: null, startedAt: { lt: internalCutoff } },
          ],
        },
        data: {
          status: 'FAILED',
          finishedAt: new Date(now),
          summary: {
            error: 'run interrupted: stale RUNNING',
            failureCategory: 'heartbeat',
          },
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
          finishedAt: new Date(now),
          summary: {
            mode: 'EXTERNAL',
            error: 'run interrupted: stale EXTERNAL run',
            failureCategory: 'heartbeat',
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

    await this.sweepStaleRuns();
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

    // 预检查之上还有数据库部分唯一索引兜底：两个请求同时读到「无 RUNNING」时，
    // 只有一个能 create 成功，另一个撞 P2002。这里把冲突翻译成 409，
    // 而不是让 500 冒到前端；冲突请求也不再投递 job。
    // 判官身份在启动时快照：之后改 prompt/换模型，也要能区分旧 run 的口径。
    const judgeSpec = this.judge.spec();
    let run: { id: string };
    try {
      run = await this.prisma.aiEvalRun.create({
        data: {
          datasetId,
          createdBy,
          mode,
          baselineRunId,
          judgeSpecVersion: judgeSpec.version,
          judgePromptHash: judgeSpec.promptHash,
          judgeModel: judgeSpec.model,
          judgeVendor: judgeSpec.vendor,
          judgeSampleCount: judgeSpec.sampleCount,
          metricFamily: INTERNAL_METRIC_FAMILY,
        },
      });
    } catch (err) {
      if (isPrismaUniqueConstraintError(err)) {
        const existing = await this.prisma.aiEvalRun.findFirst({
          where: { datasetId, status: 'RUNNING', mode: { not: 'EXTERNAL' } },
          select: { id: true, startedAt: true },
        });
        throw new ConflictException({
          message: 'This dataset already has a run in progress',
          runId: existing?.id ?? null,
        });
      }
      throw err;
    }
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
            summary: {
              mode,
              baselineRunId,
              error: `enqueue failed: ${error}`,
              failureCategory: 'enqueue',
            },
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
    // 显式 null = 「本次不对比」。不能悄悄回退到已登记基线：
    // 用户选了不对比却拿到 delta，会误以为是自己的选择产生的数字。
    if (explicit === null) return null;
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
        mode: true,
        datasetId: true,
        summary: true,
        codeVersion: true,
        judgeSpecVersion: true,
        metricSpecVersion: true,
        datasetSnapshot: true,
        knowledgeSnapshot: true,
        scope: true,
      },
    });
    if (!run) throw new NotFoundException('Eval run not found');
    if (run.status !== 'COMPLETED') {
      throw new BadRequestException(
        `Run is ${run.status}; only COMPLETED runs can be promoted`,
      );
    }
    // 内部 run 的 verdict3 任务成功率与外部 harness 的答案准确率是两族指标，
    // 拿内部 run 当外部基线会让后续 delta 用错口径。
    if (run.mode !== 'EXTERNAL') {
      throw new BadRequestException(
        `Run mode is ${run.mode ?? 'missing'}; only EXTERNAL full-scope runs ` +
          'can be promoted as a baseline',
      );
    }
    // 子集是变更后的诊断结果，语料与用例集都不是全量，不能当基线。
    if (run.scope === 'subset') {
      throw new BadRequestException(
        'Subset runs are diagnostic only and cannot be promoted; ' +
          'run a full-scope regression first',
      );
    }
    // scope 缺失不等于全量：老数据/脏数据没有范围声明时不能默认放行。
    if (run.scope !== 'full') {
      throw new BadRequestException(
        `Run scope is missing (${run.scope ?? 'null'}); only full-scope runs ` +
          'can be promoted',
      );
    }
    const knowledgeSnapshot = (run.knowledgeSnapshot ?? null) as {
      stable?: unknown;
      stableReason?: unknown;
    } | null;
    if (knowledgeSnapshot?.stable !== true) {
      const reason =
        typeof knowledgeSnapshot?.stableReason === 'string'
          ? knowledgeSnapshot.stableReason
          : 'unknown';
      throw new BadRequestException(
        `Knowledge snapshot is not stable (${reason}); results on a changing ` +
          'corpus cannot be used as a baseline',
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

    // 快照必须与数据集当前基线同源：hash 不同说明用例集变了，
    // 两条 run 的数字不能相减，登记后会把「换了题」读成「变好了/变差了」。
    const snapshotHash =
      typeof snapshot?.hash === 'string' ? snapshot.hash : '';
    const currentBaseline = await this.prisma.aiEvalRun.findFirst({
      where: { isBaseline: true, datasetId: run.datasetId },
      orderBy: { finishedAt: 'desc' },
      select: { id: true, datasetSnapshot: true },
    });
    const currentBaselineHash =
      (currentBaseline?.datasetSnapshot as { hash?: unknown } | null)?.hash ??
      null;
    if (
      currentBaseline &&
      typeof currentBaselineHash === 'string' &&
      currentBaselineHash !== snapshotHash
    ) {
      throw new BadRequestException(
        `datasetSnapshot.hash ${snapshotHash} differs from baseline ` +
          `${currentBaselineHash}; the case set changed and results are not ` +
          'comparable',
      );
    }

    // 最低样本量：小样本的高准确率不可信，全量与单意图都要达标。
    const snapshotCases = Array.isArray(
      (run.datasetSnapshot as { cases?: unknown } | null)?.cases,
    )
      ? ((run.datasetSnapshot as { cases: Array<{ kind?: unknown }> }).cases ??
        [])
      : [];
    if (snapshotCases.length < MIN_PROMOTE_TOTAL_SAMPLES) {
      throw new BadRequestException(
        `Run has ${snapshotCases.length} cases; baseline promotion requires ` +
          `at least ${MIN_PROMOTE_TOTAL_SAMPLES}`,
      );
    }
    const countByKind = new Map<string, number>();
    for (const item of snapshotCases) {
      const kind =
        typeof item?.kind === 'string' && item.kind.trim()
          ? item.kind
          : 'unknown';
      countByKind.set(kind, (countByKind.get(kind) ?? 0) + 1);
    }
    for (const [kind, count] of countByKind) {
      if (count < MIN_PROMOTE_SAMPLES_PER_INTENT) {
        throw new BadRequestException(
          `kind "${kind}" has ${count} cases; baseline promotion requires at ` +
            `least ${MIN_PROMOTE_SAMPLES_PER_INTENT} per intent`,
        );
      }
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
      // 只清同一数据集的旧基线：基线按数据集界定，A 登记不得影响 B。
      await tx.aiEvalRun.updateMany({
        where: { isBaseline: true, datasetId: run.datasetId, id: { not: id } },
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

  /**
   * 读取一次运行。`results` 仍是数组，但只承载当前页；
   * 总数走 `resultsTotal`，避免大运行一次拉全量拖垮接口。
   * RUNNING 倒序，让轮询的第一页始终是最新结果。
   */
  async getRun(id: string, options: { page?: number; pageSize?: number } = {}) {
    const { page, pageSize, skip, take } = this.resolvePage(options);

    const run = await this.prisma.aiEvalRun.findUnique({ where: { id } });
    if (!run) throw new NotFoundException('Eval run not found');

    const where = { runId: id };
    const [resultsTotal, results] = await Promise.all([
      this.prisma.aiEvalResult.count({ where }),
      this.prisma.aiEvalResult.findMany({
        where,
        include: { case: true },
        orderBy: { createdAt: run.status === 'RUNNING' ? 'desc' : 'asc' },
        skip,
        take,
      }),
    ]);

    return { ...run, results, resultsTotal, page, pageSize };
  }

  /**
   * 单用例跨运行的判定时间线（按运行时间升序）。
   * 只返回该用例所在数据集的运行，避免跨数据集读别人的用例。
   */
  async getCaseHistory(runId: string, caseId: string) {
    const run = await this.prisma.aiEvalRun.findUnique({
      where: { id: runId },
      select: { id: true, datasetId: true },
    });
    if (!run) throw new NotFoundException('Eval run not found');

    const evalCase = await this.prisma.aiEvalCase.findUnique({
      where: { id: caseId },
      select: {
        id: true,
        datasetId: true,
        question: true,
        tags: true,
        sourceFeedbackId: true,
      },
    });
    if (!evalCase || evalCase.datasetId !== run.datasetId) {
      throw new NotFoundException('Case not found in this run dataset');
    }

    const runs = await this.prisma.aiEvalRun.findMany({
      where: { datasetId: run.datasetId, results: { some: { caseId } } },
      select: {
        id: true,
        status: true,
        mode: true,
        startedAt: true,
        scope: true,
        isBaseline: true,
        summary: true,
        results: {
          where: { caseId },
          select: {
            verdict: true,
            answerVerdict: true,
            judgeErrorKind: true,
            score: true,
            answerScore: true,
          },
        },
      },
      orderBy: [{ startedAt: 'asc' }, { id: 'asc' }],
    });

    const timeline = runs.map((item) => {
      const result = item.results[0] ?? null;
      return {
        runId: item.id,
        status: item.status,
        mode: item.mode,
        scope: item.scope,
        isBaseline: item.isBaseline,
        startedAt: item.startedAt,
        verdict: result?.verdict ?? null,
        answerVerdict: result?.answerVerdict ?? null,
        judgeErrorKind: result?.judgeErrorKind ?? null,
        score: result?.score ?? null,
        answerScore: result?.answerScore ?? null,
        outcome: this.outcomeOfResult(result, this.metricFamilyOf(item)),
      };
    });

    return {
      caseId: evalCase.id,
      datasetId: run.datasetId,
      case: {
        id: evalCase.id,
        question: evalCase.question,
        tags: evalCase.tags,
        sourceFeedbackId: evalCase.sourceFeedbackId,
      },
      timeline,
    };
  }

  /**
   * 两次运行的描述性差异（新增失败 / 修复 / 回退 / 仍失败）。
   *
   * 只做集合运算，不声称显著：显著性由 `compare.py` 的配对检验负责。
   * 判官未判出结论或基线缺该用例时不计入任何一类，只体现在 comparability 里。
   */
  async getRunDiff(runId: string, options: { baselineRunId?: string } = {}) {
    const run = await this.prisma.aiEvalRun.findUnique({
      where: { id: runId },
      select: {
        id: true,
        datasetId: true,
        baselineRunId: true,
        mode: true,
        summary: true,
        results: {
          select: {
            caseId: true,
            verdict: true,
            answerVerdict: true,
            judgeErrorKind: true,
            case: { select: { question: true } },
          },
        },
      },
    });
    if (!run) throw new NotFoundException('Eval run not found');

    const baselineRunId = options.baselineRunId ?? run.baselineRunId;
    if (!baselineRunId) {
      throw new BadRequestException(
        'Run has no baseline; pass baselineRunId explicitly',
      );
    }
    if (baselineRunId === runId) {
      throw new BadRequestException(
        'baselineRunId must differ from the run being compared',
      );
    }

    const baseline = await this.prisma.aiEvalRun.findUnique({
      where: { id: baselineRunId },
      select: {
        id: true,
        datasetId: true,
        mode: true,
        summary: true,
        startedAt: true,
        results: {
          select: {
            caseId: true,
            verdict: true,
            answerVerdict: true,
            judgeErrorKind: true,
          },
        },
      },
    });
    if (!baseline) throw new NotFoundException('Baseline run not found');
    if (baseline.datasetId !== run.datasetId) {
      throw new BadRequestException(
        'Diff requires both runs to belong to the same dataset',
      );
    }

    const currentFamily = this.metricFamilyOf(run);
    const baselineFamily = this.metricFamilyOf(baseline);
    if (currentFamily !== baselineFamily) {
      throw new BadRequestException(
        `Cannot diff across metric families (${baselineFamily} vs ${currentFamily})`,
      );
    }

    const baselineByCase = new Map<
      string,
      { outcome: CaseOutcome; verdict: string | null }
    >();
    for (const item of baseline.results) {
      baselineByCase.set(item.caseId, {
        outcome: this.outcomeOfResult(item, baselineFamily),
        verdict: this.rawVerdictOf(item, baselineFamily),
      });
    }

    // 只有「基线通过 → 当前失败」需要回看更早历史，用来区分新增失败与回退。
    const suspectCaseIds = run.results
      .filter((item) => this.outcomeOfResult(item, currentFamily) === 'fail')
      .map((item) => item.caseId)
      .filter((caseId) => baselineByCase.get(caseId)?.outcome === 'pass');
    const earlierFailures = await this.loadEarlierFailures(
      run.datasetId,
      baseline.startedAt,
      suspectCaseIds,
      baselineFamily,
    );

    const classes: Record<CaseDiffClass, CaseDiffItem[]> = {
      newFailure: [],
      fixed: [],
      regressed: [],
      stillFailing: [],
    };

    let compared = 0;
    let undecided = 0;
    let missingBaseline = 0;

    for (const item of run.results) {
      const currentOutcome = this.outcomeOfResult(item, currentFamily);
      const previous = baselineByCase.get(item.caseId);
      if (!previous) {
        missingBaseline += 1;
        continue;
      }
      if (currentOutcome === 'undecided' || previous.outcome === 'undecided') {
        undecided += 1;
        continue;
      }
      const klass = classifyCaseDiff({
        baseline: previous.outcome,
        current: currentOutcome,
        hadEarlierFailure: earlierFailures.has(item.caseId),
      });
      if (!klass) continue;
      compared += 1;
      classes[klass].push({
        caseId: item.caseId,
        question: item.case.question,
        baselineVerdict: previous.verdict,
        currentVerdict: this.rawVerdictOf(item, currentFamily),
      });
    }

    return {
      runId: run.id,
      baselineRunId: baseline.id,
      metricFamily: currentFamily,
      comparability: { compared, undecided, missingBaseline },
      counts: {
        newFailure: classes.newFailure.length,
        fixed: classes.fixed.length,
        regressed: classes.regressed.length,
        stillFailing: classes.stillFailing.length,
      },
      classes,
      note: '描述性分类，不构成统计显著性结论；显著性由 compare.py 配对检验给出。',
    };
  }

  /**
   * 判官校准：把同一运行里的人工标注与判官结论逐条对齐。
   *
   * 只用于评估判官口径，不进入任何指标或发布证据。样本不足 20 条时
   * 结构上就不带 agreementRate 字段——消费方拿不到一个会被误读的百分比。
   * 预标注、判官失败、unsafe/abstain 这类不在同一维度上的标注只计入 excluded。
   */
  async getRunCalibration(runId: string): Promise<RunCalibration> {
    const run = await this.prisma.aiEvalRun.findUnique({
      where: { id: runId },
      select: {
        id: true,
        datasetId: true,
        mode: true,
        summary: true,
        results: {
          select: {
            caseId: true,
            verdict: true,
            answerVerdict: true,
            judgeErrorKind: true,
            reason: true,
            case: { select: { question: true } },
          },
        },
      },
    });
    if (!run) throw new NotFoundException('Eval run not found');

    const family = this.metricFamilyOf(run);
    const annotations = await this.prisma.aiEvalAnnotation.findMany({
      where: { runId, turn: 0, source: 'human' },
      orderBy: [{ caseId: 'asc' }, { labelerId: 'asc' }],
      select: {
        caseId: true,
        labelerId: true,
        source: true,
        correctness: true,
        comment: true,
      },
    });

    const base = {
      runId: run.id,
      datasetId: run.datasetId,
      metricFamily: family,
      threshold: CALIBRATION_MIN_SAMPLE,
      excluded: 0,
      disagreements: [] as RunCalibrationDisagreement[],
    };

    // 外部运行判的是答案正确性（correct/incorrect），与人工解决度不是同一维度，
    // 硬对齐只会产生假分歧，所以整体不计入校准样本。
    if (family !== INTERNAL_METRIC_FAMILY) {
      return {
        ...base,
        status: 'insufficientSample',
        n: 0,
        excluded: annotations.length,
        note: '外部运行按答案正确性判分，与人工解决度不同口径，不参与判官校准。',
      };
    }

    const resultByCase = new Map(run.results.map((item) => [item.caseId, item]));
    const disagreements: RunCalibrationDisagreement[] = [];
    let agreements = 0;
    let comparable = 0;
    let excluded = 0;

    for (const annotation of annotations) {
      if (
        annotation.source !== 'human' ||
        annotation.labelerId === PRELABEL_LABELER
      ) {
        excluded += 1;
        continue;
      }
      // 人工只标 solved/partial/unsolved 才与判官三分类可比。
      if (!JUDGE_VERDICT_VALUES.has(annotation.correctness ?? '')) {
        excluded += 1;
        continue;
      }
      const result = resultByCase.get(annotation.caseId);
      // 判官失败没有结论的，不能算分歧。
      const judgeVerdict =
        result && !result.judgeErrorKind ? result.verdict : null;
      if (!judgeVerdict || !JUDGE_VERDICT_VALUES.has(judgeVerdict)) {
        excluded += 1;
        continue;
      }

      comparable += 1;
      if (judgeVerdict === annotation.correctness) {
        agreements += 1;
        continue;
      }
      disagreements.push({
        caseId: annotation.caseId,
        question: result?.case.question ?? null,
        judgeVerdict,
        humanCorrectness: annotation.correctness as string,
        judgeReason: result?.reason ?? null,
        humanComment: annotation.comment ?? '',
        labelerId: annotation.labelerId,
      });
    }

    if (comparable < CALIBRATION_MIN_SAMPLE) {
      return {
        ...base,
        status: 'insufficientSample',
        n: comparable,
        excluded,
        disagreements,
        note: `样本不足（${comparable}/${CALIBRATION_MIN_SAMPLE}）：不下结论，仅列出分歧明细供人工判断。`,
      };
    }

    return {
      ...base,
      status: 'ok',
      n: comparable,
      excluded,
      disagreements,
      agreements,
      agreementRate: Math.round((agreements / comparable) * 1000) / 10,
      note: '一致率只用于评估判官口径，不进入任何指标或发布证据。',
    };
  }

  /** 运行属于哪个指标族：显式 summary 优先，老数据按 mode 兜底。 */
  private metricFamilyOf(run: {
    summary?: unknown;
    mode?: string | null;
  }): string {
    const summary = (run.summary ?? {}) as Record<string, unknown>;
    if (typeof summary.metricFamily === 'string') {
      return summary.metricFamily;
    }
    return run.mode === 'EXTERNAL'
      ? EXTERNAL_METRIC_FAMILY
      : INTERNAL_METRIC_FAMILY;
  }

  /** 判定归一；judgeErrorKind 有值说明判官没给出结论，不能算失败。 */
  private outcomeOfResult(
    result: {
      verdict?: string | null;
      answerVerdict?: string | null;
      judgeErrorKind?: string | null;
    } | null,
    family: string,
  ): CaseOutcome {
    if (!result || result.judgeErrorKind) return 'undecided';
    return family === EXTERNAL_METRIC_FAMILY
      ? outcomeFromAnswerVerdict(result.answerVerdict)
      : outcomeFromVerdict(result.verdict);
  }

  private rawVerdictOf(
    result: { verdict?: string | null; answerVerdict?: string | null },
    family: string,
  ): string | null {
    return family === EXTERNAL_METRIC_FAMILY
      ? (result.answerVerdict ?? null)
      : (result.verdict ?? null);
  }

  /** 基线之前，这些用例里哪些失败过（用于区分首次失败与回退）。 */
  private async loadEarlierFailures(
    datasetId: string,
    before: Date,
    caseIds: string[],
    family: string,
  ): Promise<Set<string>> {
    const failed = new Set<string>();
    if (caseIds.length === 0) return failed;
    const earlierRuns = await this.prisma.aiEvalRun.findMany({
      where: {
        datasetId,
        startedAt: { lt: before },
        results: { some: { caseId: { in: caseIds } } },
      },
      select: {
        results: {
          where: { caseId: { in: caseIds } },
          select: {
            caseId: true,
            verdict: true,
            answerVerdict: true,
            judgeErrorKind: true,
          },
        },
      },
    });
    for (const earlier of earlierRuns) {
      for (const item of earlier.results) {
        if (this.outcomeOfResult(item, family) === 'fail') {
          failed.add(item.caseId);
        }
      }
    }
    return failed;
  }

  /**
   * 待验用例（FIXED_PENDING_VERIFY）由运行结果自动推进：
   * - 判定通过 → CLOSED；
   * - 判定失败 → 打回 OPEN 并记 regressedAt；
   * - 判官没给出结论 → 不动，等下一轮。
   *
   * 只改 resolution 仍是 FIXED_PENDING_VERIFY 的行，人工在此期间改判不会被覆盖。
   */
  async advancePendingVerification(
    runId: string,
    /** 收尾路径已知道指标族时直接传入，省一次 run 查询。 */
    knownFamily?: string,
  ): Promise<{ closed: number; regressed: number }> {
    let family = knownFamily;
    if (!family) {
      const run = await this.prisma.aiEvalRun.findUnique({
        where: { id: runId },
        select: { id: true, mode: true, summary: true },
      });
      if (!run) return { closed: 0, regressed: 0 };
      family = this.metricFamilyOf(run);
    }

    const results = await this.prisma.aiEvalResult.findMany({
      where: { runId },
      select: {
        caseId: true,
        verdict: true,
        answerVerdict: true,
        judgeErrorKind: true,
      },
    });
    if (results.length === 0) return { closed: 0, regressed: 0 };

    const passCaseIds: string[] = [];
    const failCaseIds: string[] = [];
    for (const item of results) {
      const outcome = this.outcomeOfResult(item, family);
      if (outcome === 'pass') passCaseIds.push(item.caseId);
      else if (outcome === 'fail') failCaseIds.push(item.caseId);
    }
    if (passCaseIds.length === 0 && failCaseIds.length === 0) {
      return { closed: 0, regressed: 0 };
    }

    const caseIds = [...passCaseIds, ...failCaseIds];
    // 正向：用例记录来源反馈；反向：老数据只写了 feedback.linkedEvalCaseId。
    const feedbackIdByCase = new Map<string, string>();
    const cases = await this.prisma.aiEvalCase.findMany({
      where: { id: { in: caseIds } },
      select: { id: true, sourceFeedbackId: true },
    });
    for (const item of cases) {
      if (item.sourceFeedbackId) {
        feedbackIdByCase.set(item.id, item.sourceFeedbackId);
      }
    }
    const linked = await this.prisma.aiAnswerFeedback.findMany({
      where: { linkedEvalCaseId: { in: caseIds } },
      select: { id: true, linkedEvalCaseId: true },
    });
    for (const item of linked) {
      if (
        item.linkedEvalCaseId &&
        !feedbackIdByCase.has(item.linkedEvalCaseId)
      ) {
        feedbackIdByCase.set(item.linkedEvalCaseId, item.id);
      }
    }

    const feedbackIdsOf = (ids: string[]) => [
      ...new Set(
        ids
          .map((caseId) => feedbackIdByCase.get(caseId))
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const passFeedbackIds = feedbackIdsOf(passCaseIds);
    const failFeedbackIds = feedbackIdsOf(failCaseIds);

    let closed = 0;
    let regressed = 0;
    if (passFeedbackIds.length > 0) {
      const updated = await this.prisma.aiAnswerFeedback.updateMany({
        where: {
          id: { in: passFeedbackIds },
          resolution: 'FIXED_PENDING_VERIFY',
        },
        data: {
          resolution: 'CLOSED',
          reviewStatus: 'REVIEWED',
          reviewedAt: new Date(),
          regressedAt: null,
        },
      });
      closed = updated.count;
    }
    if (failFeedbackIds.length > 0) {
      const updated = await this.prisma.aiAnswerFeedback.updateMany({
        where: {
          id: { in: failFeedbackIds },
          resolution: 'FIXED_PENDING_VERIFY',
        },
        data: {
          resolution: 'OPEN',
          reviewStatus: 'PENDING',
          reviewedBy: null,
          reviewedAt: null,
          regressedAt: new Date(),
        },
      });
      regressed = updated.count;
    }
    if (closed > 0 || regressed > 0) {
      this.logger.log(
        `[eval] pending verification advanced for run ${runId}: closed=${closed} regressed=${regressed}`,
      );
    }
    return { closed, regressed };
  }

  /** 状态推进失败不能把已落盘的结果判成运行失败，只告警留痕。 */
  private async advancePendingVerificationSafe(
    runId: string,
    knownFamily?: string,
  ): Promise<void> {
    try {
      await this.advancePendingVerification(runId, knownFamily);
    } catch (err: any) {
      this.logger.warn(
        `[eval] pending verification advance failed for run ${runId}: ${err?.message ?? err}`,
      );
    }
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

    // 对比对象在创建时就定了：baselineRunId 为空表示「不对比」，
    // 收尾时不得回退到中途 promote 的基线（那会让 delta 的来源不可复现）。
    const baselineRunId = run.baselineRunId ?? null;
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

    // 结果已落盘、运行已 COMPLETED：待验用例在这里按本轮判定推进。
    await this.advancePendingVerificationSafe(
      runId,
      this.metricFamilyOf({ summary, mode: 'EXTERNAL' }),
    );

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
      // 族随数字走：消费方按它拒绝跨族相减，不用猜 accuracy 与 passRate 谁是谁。
      metricFamily: EXTERNAL_METRIC_FAMILY,
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
    // 跨族对比会拿两套指标相减（accuracy 减 passRate），宁可不算。
    // 老 run 没有 metricFamily 字段，但 accuracy 语义从未变过，仍可对比。
    if (
      typeof summary.metricFamily === 'string' &&
      summary.metricFamily !== EXTERNAL_METRIC_FAMILY
    ) {
      this.logger.warn(
        `[eval] baseline ${runId} belongs to metric family ${summary.metricFamily}; ` +
          'skip cross-family answer comparison',
      );
      return null;
    }
    return {
      accuracy: typeof summary.accuracy === 'number' ? summary.accuracy : null,
      verdictByCase,
    };
  }

  private buildAnswerComparison(
    results: ExternalEvalResultDto[],
    baseline: AnswerBaselineSnapshot,
  ): Record<string, any> {
    // 只有「判过」的两端才有可比性：judge_error / null 既不是通过也不是失败，
    // 拿来对比会把判官故障记成回归（或修复），污染 newFailures/fixed。
    const isDecided = (verdict: string | null | undefined): boolean =>
      verdict === 'correct' || verdict === 'incorrect';

    let newFailures = 0;
    let fixed = 0;
    for (const item of results) {
      const previous = baseline.verdictByCase.get(item.caseId);
      if (!isDecided(previous) || !isDecided(item.answerVerdict)) continue;
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
    // 对比对象在 startRun 时就写进了 run（含显式 null = 不对比）；
    // 执行期不得回退到后来 promote 的基线，否则同一 run 的 delta 不可复现。
    const baselineRunId = run.baselineRunId ?? null;
    const baseline = baselineRunId
      ? await this.loadBaseline(baselineRunId)
      : null;

    let solved = 0;
    let partial = 0;
    let unsolved = 0;
    let budgetExceeded = false;
    // 判官失败与「回答错误」分账：失败条数单独累计，不落进 unsolved 分母。
    let judgeErrors = 0;
    const judgeErrorKinds: Record<string, number> = {};
    // 执行失败（LIVE 链路自身挂了）同理单独累计，类别只有 live_call。
    let executionErrors = 0;
    const executionErrorKinds: Record<string, number> = {};
    let consecutiveJudgeFailures = 0;
    const judgeFailureCircuit = resolveJudgeFailureCircuit();
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
            // 单条用例的 AI 故障不拖垮整次评测：执行错误单独记账并继续下一条。
            liveError = String(err?.message ?? err).slice(0, 200);
            this.logger.warn(
              `[eval] live case ${item.id} failed in run ${runId}: ${liveError}`,
            );
          }
        }

        let verdict: {
          verdict: TaskJudgeResult['verdict'];
          score: number;
          reason: string;
          judgeModel: string | null;
          judgeVendor: string | null;
          vendorIndependent: boolean | null;
        } | null = null;
        let judgeError: { kind: JudgeErrorKind; message: string } | null = null;

        // 执行失败的有没拿到回答，判官没东西可判：跳过判官，直接留痕。
        if (!liveError) {
          try {
            verdict = await this.judge.judge({
              question: item.question,
              answer,
              expectTask: expectTask as any,
              pendingConfirm,
            });
            consecutiveJudgeFailures = 0;
          } catch (err) {
            judgeError = {
              kind: this.judgeErrorKindOf(err),
              message: String((err as any)?.message ?? err).slice(0, 200),
            };
            this.logger.warn(
              `[eval] judge failed for case ${item.id} in run ${runId} (${judgeError.kind}): ${judgeError.message}`,
            );
          }
        }

        // 已经发生的 AI/judge 调用要计入本 run；LIVE 用实际回答修正估算。
        this.addUsage(
          usage,
          estimateEvalCaseTokens(item.question, actualAnswer ?? answer),
        );

        // 判分期间可能已被取消：取消后丢弃这条结果，不再写库。
        if (!(await this.ensureRunning(runId, usage))) return;

        if (liveError) {
          executionErrors += 1;
          executionErrorKinds.live_call =
            (executionErrorKinds.live_call ?? 0) + 1;
          // 执行失败既不进 unsolved，也不写 AiScore：这是系统故障，不是回答错了。
          await this.prisma.aiEvalResult.create({
            data: {
              runId,
              caseId: item.id,
              verdict: null,
              score: null,
              reason: `execution_error: live_call: ${liveError}`.slice(0, 300),
              actualAnswer,
              judgeModel: null,
              judgeVendor: null,
              vendorIndependent: null,
              traceId,
              latencyMs: Date.now() - started,
            },
          });
          continue;
        }

        if (judgeError) {
          judgeErrors += 1;
          judgeErrorKinds[judgeError.kind] =
            (judgeErrorKinds[judgeError.kind] ?? 0) + 1;
          consecutiveJudgeFailures += 1;
          // 留痕但不判分：verdict/score 留空，不写 AiScore，
          // 否则判官故障会被当成一次「回答错了」进准确率分母。
          await this.prisma.aiEvalResult.create({
            data: {
              runId,
              caseId: item.id,
              verdict: null,
              score: null,
              reason: `judge_error: ${judgeError.message}`.slice(0, 300),
              judgeErrorKind: judgeError.kind,
              actualAnswer,
              judgeModel: null,
              judgeVendor: null,
              vendorIndependent: null,
              traceId,
              latencyMs: Date.now() - started,
            },
          });
          if (consecutiveJudgeFailures >= judgeFailureCircuit) {
            throw new JudgeCircuitOpenError(
              consecutiveJudgeFailures,
              judgeError.message,
            );
          }
          continue;
        }
        if (!verdict) {
          // 两种失败都已 continue；走到这里还没有判定，说明分支写漏了。
          throw new Error(
            `eval case ${item.id} produced neither verdict nor error`,
          );
        }

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
              failureCategory: 'budget',
              // 预算中断同样是「跑到一半停」，已判分与失败条数要一起留下。
              total: run.dataset.cases.length,
              solved,
              partial,
              unsolved,
              judgeErrors,
              judgeErrorKinds,
              executionError: executionErrors,
              executionErrorKinds,
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
          // 内部 run 也留快照：没有它，两次内部运行的分数无法归因到同一套题。
          datasetSnapshot: {
            hash: snapshotHashOfCaseIds(run.dataset.cases.map((c) => c.id)),
            cases: [...run.dataset.cases.map((c) => c.id)].sort(),
          },
          codeVersion: resolveEvalCodeVersion(),
          // 有执行失败才写类别；COMPLETED 但仍可据此筛出「带系统故障的运行」。
          executionErrorKind: executionErrors > 0 ? 'live_call' : null,
          summary: this.buildSummary({
            mode,
            baselineRunId,
            total,
            solved,
            partial,
            unsolved,
            judgeErrors,
            judgeErrorKinds,
            executionErrors,
            executionErrorKinds,
            passRate,
            caseVerdicts,
            baseline,
            usage,
          }),
        },
      });
      if (completed.count === 0) await this.ensureRunning(runId, usage);
      else await this.advancePendingVerificationSafe(
        runId,
        INTERNAL_METRIC_FAMILY,
      );
    } catch (err: any) {
      // 条件更新：取消优先于失败，避免把 CANCELLED 覆盖成 FAILED。
      await this.prisma.aiEvalRun
        .updateMany({
          where: { id: runId, status: 'RUNNING' },
          data: {
            status: 'FAILED',
            finishedAt: new Date(),
            // 失败也要说清「已经判了多少」：只剩一行 error 时，
            // 没人分得出是开跑就挂还是跑到一半崩的。
            summary: {
              ...this.buildSummary({
                mode,
                baselineRunId,
                total: run.dataset.cases.length,
                solved,
                partial,
                unsolved,
                judgeErrors,
                judgeErrorKinds,
                executionErrors,
                executionErrorKinds,
                passRate:
                  run.dataset.cases.length > 0
                    ? Number((solved / run.dataset.cases.length).toFixed(3))
                    : 0,
                caseVerdicts,
                baseline,
                usage,
                failureCategory:
                  err instanceof JudgeCircuitOpenError
                    ? 'judge_unavailable'
                    : 'unhandled',
              }),
              error: String(err?.message ?? err).slice(0, 300),
            },
          },
        })
        .catch((updateErr) =>
          this.logger.error(
            `Eval run ${runId} FAILED update failed: ${updateErr?.message ?? updateErr}`,
          ),
        );
      throw err;
    } finally {
      // 运行结束（完成/取消/失败）即释放节流状态，避免 Map 随 run 累积。
      this.lastHeartbeatAt.delete(runId);
    }
  }

  /**
   * 判官失败的归类，三层兜底：
   * 1. `JudgeFailureError`（判官自己归的类，如 output_format）；
   * 2. 503 结构化 body 的 `kind`（所有 key 都失败时的网关错误）；
   * 3. 文本归类 `classifyJudgeError`（第三方/历史裸错误）。
   * 与 rag 的判定端点共用第 3 层，避免两套分类规则漂移。
   */
  private judgeErrorKindOf(err: unknown): JudgeErrorKind {
    if (err instanceof JudgeFailureError) return err.kind;
    if (err instanceof HttpException) {
      const body = err.getResponse();
      if (body && typeof body === 'object' && 'kind' in body) {
        const kind = (body as { kind?: unknown }).kind;
        if (
          typeof kind === 'string' &&
          (JUDGE_ERROR_KINDS as readonly string[]).includes(kind)
        ) {
          return kind as JudgeErrorKind;
        }
      }
    }
    return classifyJudgeError(err);
  }

  /**
   * 读一次状态并返回是否还能继续，顺带推进心跳。
   * - RUNNING：继续；
   * - CANCELLED：补齐 finishedAt/summary 后停止；
   * - 其他终态或行已不存在：静默停止（不覆盖已有终态）。
   *
   * 心跳每 ≥30s 写一次（条件 updateMany：只有仍 RUNNING 才命中）。
   * 命中 count>0 就等于同时确认了存活，省掉一次读；未命中才回读状态，
   * 用来区分 CANCELLED 与其他终态。心跳只在进程内节流，判活只认 DB 的
   * heartbeatAt —— worker 被杀时进程内时间戳一起消失，DB 侧才看得出僵死。
   */
  private async ensureRunning(
    runId: string,
    usage?: EvalRunUsage,
  ): Promise<boolean> {
    const now = Date.now();
    const last = this.lastHeartbeatAt.get(runId) ?? 0;
    if (now - last >= EVAL_HEARTBEAT_INTERVAL_MS) {
      this.lastHeartbeatAt.set(runId, now);
      const beat = await this.prisma.aiEvalRun.updateMany({
        where: { id: runId, status: 'RUNNING' },
        data: { heartbeatAt: new Date(now) },
      });
      if (beat.count > 0) return true;
    }

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

  private async loadBaseline(runId: string): Promise<BaselineSnapshot | null> {
    const baseline = await this.prisma.aiEvalRun.findUnique({
      where: { id: runId },
      select: {
        summary: true,
        results: { select: { caseId: true, verdict: true } },
      },
    });
    // 基线在读的时候消失/被删，就当作没有对比对象，而不是算出一个假的 0。
    if (!baseline) return null;
    const summary = (baseline.summary ?? {}) as Record<string, any>;
    // EXTERNAL 的 summary 存 accuracy，没有 verdicts；跨族相减只会产出假 delta。
    // 老 run 没有 metricFamily 字段，但 passRate 语义从未变过，仍可对比。
    if (
      typeof summary.metricFamily === 'string' &&
      summary.metricFamily !== INTERNAL_METRIC_FAMILY
    ) {
      this.logger.warn(
        `[eval] baseline ${runId} belongs to metric family ${summary.metricFamily}; ` +
          'skip cross-family pass-rate comparison',
      );
      return null;
    }
    const verdictByCase = new Map<string, string | null>();
    for (const item of baseline.results) {
      verdictByCase.set(item.caseId, item.verdict);
    }
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
    judgeErrors: number;
    judgeErrorKinds: Record<string, number>;
    executionErrors: number;
    executionErrorKinds: Record<string, number>;
    passRate: number;
    caseVerdicts: CaseVerdict[];
    baseline: BaselineSnapshot | null;
    usage: EvalRunUsage;
    failureCategory?: EvalFailureCategory;
  }): Record<string, any> {
    // 三个分母各管各的（口径见 122 需求总纲 §5）：
    // - passRate        = solved / total        （语义不变，历史可比）
    // - validPassRate   = solved / judged       （judged = solved + partial + unsolved，真正判过的）
    // - judgeErrorRate / executionErrorRate = 失败数 / total
    const judged = input.solved + input.partial + input.unsolved;
    const processed = judged + input.judgeErrors + input.executionErrors;
    const total = input.total;
    const summary: Record<string, any> = {
      total,
      processed,
      judged,
      solved: input.solved,
      partial: input.partial,
      unsolved: input.unsolved,
      // 判官失败数：不进 unsolved，也不进 passRate 分子/分母（回答准确性只看判过的）。
      judgeErrors: input.judgeErrors,
      judgeErrorKinds: input.judgeErrorKinds,
      // 执行失败数（LIVE 链路挂了）同样不进 unsolved，只能靠这里看出来。
      executionError: input.executionErrors,
      executionErrorKinds: input.executionErrorKinds,
      passRate: input.passRate,
      validPassRate:
        judged > 0 ? Number((input.solved / judged).toFixed(3)) : 0,
      judgeErrorRate:
        total > 0 ? Number((input.judgeErrors / total).toFixed(3)) : 0,
      executionErrorRate:
        total > 0 ? Number((input.executionErrors / total).toFixed(3)) : 0,
      // run 级失败类别；COMPLETED 的运行没有失败类别，显式 null 而不是缺字段。
      failureCategory: input.failureCategory ?? null,
      // 族与版本随数字走，消费方不用猜这组 key 是 verdict3 还是 answer_accuracy。
      metricFamily: INTERNAL_METRIC_FAMILY,
      metricSpecVersion: INTERNAL_METRIC_SPEC_VERSION,
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
