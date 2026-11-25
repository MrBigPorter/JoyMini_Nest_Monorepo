import type { EvalFailureCategory } from './ai-eval-dataset.service';
import { ANSWER_VERDICTS, JUDGE_ERROR_KINDS } from './dto/external-eval.dto';
import {
  FEEDBACK_FAILURE_KINDS,
  type FeedbackResolution,
} from '@api/common/ai/feedback-triage';

/**
 * AI 质量闭环契约注册表（唯一落点）。
 *
 * 只被测试与开发期读取，生产请求路径不 import（design D5）。
 * 新增 summary 字段、枚举值、指标族或状态转移时先改这里，否则
 * `quality-contract.spec.ts` 会红——这是「未登记即违约」的执行点。
 *
 * 行为契约见 openspec/changes/ai-quality-loop-contract 的 delta spec；
 * 术语与权威层级对照 docs/AI-joymini/122-AI质量闭环-需求总纲.md §6。
 */

/** summary 字段登记：按真正写入 summary.metricFamily 的族值分组。 */
export const SUMMARY_KEYS = {
  verdict3: [
    'total',
    'processed',
    'judged',
    'solved',
    'partial',
    'unsolved',
    'judgeErrors',
    'judgeErrorKinds',
    'executionError',
    'executionErrorKinds',
    'passRate',
    'validPassRate',
    'judgeErrorRate',
    'executionErrorRate',
    'failureCategory',
    'metricFamily',
    'metricSpecVersion',
    'mode',
    'baselineRunId',
    'usage',
    // 仅在 baselineRunId 且基线可读时出现；按族计算，跨族禁止相减。
    'baselinePassRate',
    'delta',
    'newFailures',
    'fixed',
  ],
  'answer_accuracy-v3': [
    'mode',
    'metricFamily',
    'total',
    'correct',
    'incorrect',
    'judgeError',
    'accuracy',
    'judgeErrorRate',
    'judgeErrorKinds',
    'judgeAgreement',
    'judgeAgreementMeasured',
    'judgeDisagreement',
    'scope',
    'selectedCaseCount',
    'answerVerdicts',
    'grounding',
    'datasetFingerprint',
    'codeVersion',
    'gateMode',
    'judgeSpecVersion',
    'metricSpecVersion',
    'baselineRunId',
    // 仅在与同族基线对比时出现。
    'baselineAccuracy',
    'delta',
    'newFailures',
    'fixed',
  ],
} as const;

/** 判官失败类别（需求总纲 §4.2）；单条失败不落 run，走 judgeErrors。 */
export const FAILURE_CATEGORIES = [
  'enqueue',
  'budget',
  'unhandled',
  'heartbeat',
  'judge_unavailable',
] as const satisfies readonly EvalFailureCategory[];

/** 反馈处理结论；与 ai-feedback.service 的 FEEDBACK_RESOLUTIONS 同源同名。 */
export const FEEDBACK_RESOLUTIONS = [
  'OPEN',
  'CONFIRMED',
  'EXCLUDED',
  'ADDED_TO_EVAL',
  'FIXED_PENDING_VERIFY',
  'CLOSED',
  'NO_ISSUE',
] as const satisfies readonly FeedbackResolution[];

/**
 * 枚举登记：新增枚举值必须先在这里登记。
 * 字段名带实体前缀，避免与 summary key 混淆。
 * 可空字段（run.scope/summary.failureCategory）允许 null，null 不算枚举值。
 */
export const ENUM_VALUES = {
  'summary.mode': ['STORED', 'LIVE', 'EXTERNAL'],
  'summary.failureCategory': FAILURE_CATEGORIES,
  'summary.scope': ['full', 'subset'],
  'run.status': ['RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED'],
  'run.mode': ['STORED', 'LIVE', 'EXTERNAL'],
  'run.scope': ['full', 'subset'],
  'run.metricFamily': ['verdict3', 'answer_accuracy-v3'],
  'feedback.reviewStatus': ['PENDING', 'REVIEWED', 'IGNORED'],
  'feedback.resolution': FEEDBACK_RESOLUTIONS,
  'feedback.failureKind': FEEDBACK_FAILURE_KINDS,
  'result.verdict': ['solved', 'partial', 'unsolved'],
  'result.answerVerdict': ANSWER_VERDICTS,
  'result.judgeErrorKind': JUDGE_ERROR_KINDS,
} as const;

/**
 * 指标族 → 版本。第一列是文档里的族版本标签，`summarySpecVersion`
 * 是实际写进 summary.metricSpecVersion 的值（外部由 harness 提供，固定 '3'）。
 * 两族 MUST NOT 共用同一版本号；改分母口径必须升版本。
 */
export const METRIC_FAMILIES = {
  verdict3: {
    version: 'verdict3-1',
    summaryFamily: 'verdict3',
    summarySpecVersion: 'verdict3-1',
  },
  'answer_accuracy-v3': {
    version: 'answer_accuracy-v3',
    summaryFamily: 'answer_accuracy-v3',
    summarySpecVersion: '3',
  },
  calibration: {
    version: 'calibration-1',
    summaryFamily: null,
    summarySpecVersion: null,
  },
  'knowledge-parse': {
    version: 'knowledge-parse-1',
    summaryFamily: null,
    summarySpecVersion: null,
  },
} as const satisfies Record<
  string,
  {
    version: string;
    summaryFamily: string | null;
    summarySpecVersion: string | null;
  }
>;

type TransitionTrigger = 'auto' | 'manual';
interface StateTransition {
  readonly to: string;
  readonly trigger: TransitionTrigger;
  /** 触发条件，写给人看；自动化由后续 change 实现。 */
  readonly on: string;
}

/**
 * 状态机允许的转移（需求总纲 §4）。
 * - reviewStatus：认领是正交属性，不改变 reviewStatus
 * - runStatus：单条失败不改变 run 状态，达熔断阈值才整单 FAILED
 * - regressionStatus：推进由运行结果自动完成，不靠人工口头确认
 *
 * 「无死状态」的口径：非终态至少一条出边，终态在 TERMINAL_STATES 显式声明；
 * 每个状态要么是入口，要么有入边（见 spec 2.3）。
 */
export const STATE_TRANSITIONS = {
  reviewStatus: {
    PENDING: [
      { to: 'REVIEWED', trigger: 'manual', on: '运营提交判定类结论' },
      { to: 'IGNORED', trigger: 'manual', on: '运营排除并写明理由' },
    ],
    REVIEWED: [
      { to: 'PENDING', trigger: 'manual', on: '结论被撤销，重新进入待处理' },
    ],
    IGNORED: [
      { to: 'PENDING', trigger: 'manual', on: '撤销排除，记录操作者与原因' },
    ],
  },
  runStatus: {
    RUNNING: [
      { to: 'COMPLETED', trigger: 'auto', on: '全部用例处理完毕' },
      {
        to: 'FAILED',
        trigger: 'auto',
        on: '入队/预算/未捕获异常/心跳超时/判官整体不可用',
      },
      { to: 'CANCELLED', trigger: 'manual', on: '运行发起人取消' },
    ],
    COMPLETED: [],
    FAILED: [],
    CANCELLED: [],
  },
  regressionStatus: {
    OPEN: [
      {
        to: 'FIXED_PENDING_VERIFY',
        trigger: 'auto',
        on: '某次运行判定该用例通过',
      },
    ],
    FIXED_PENDING_VERIFY: [
      { to: 'CLOSED', trigger: 'auto', on: '下一轮运行仍通过' },
      { to: 'OPEN', trigger: 'auto', on: '下一轮运行失败，打回待处理' },
      {
        to: 'REGRESSED',
        trigger: 'auto',
        on: '下一轮运行失败并记 regressedAt',
      },
    ],
    REGRESSED: [
      {
        to: 'FIXED_PENDING_VERIFY',
        trigger: 'auto',
        on: '后续运行重新判定通过',
      },
    ],
    CLOSED: [],
  },
} as const satisfies Record<string, Record<string, readonly StateTransition[]>>;

/** 终态：允许没有出边；必须在 STATE_TRANSITIONS 里登记。 */
export const TERMINAL_STATES = {
  reviewStatus: [],
  runStatus: ['COMPLETED', 'FAILED', 'CANCELLED'],
  regressionStatus: ['CLOSED'],
} as const;

/** 入口态：允许没有入边；必须在 STATE_TRANSITIONS 里登记。 */
export const ENTRY_STATES = {
  reviewStatus: ['PENDING'],
  runStatus: ['RUNNING'],
  regressionStatus: ['OPEN'],
} as const;

/**
 * 术语唯一（需求总纲 §6.6）：一个概念只有一个名字与一个义项。
 * `notThis` 是常见误用，页面文案出现即违约。
 */
export const TERMS = {
  baseline: {
    term: '基线',
    meaning: '按数据集登记的 EXTERNAL 基线 run',
    notThis: ['任意用于对比的运行', '知识库回归的上次全量运行'],
  },
  comparisonRun: {
    term: '对比运行',
    meaning: '与基线或另一次运行做对比的 run，本身不是基线',
    notThis: ['基线'],
  },
  pending: {
    term: '待处理',
    meaning: 'reviewStatus = PENDING',
    notThis: ['已认领但未处理', '所有未关闭的反馈'],
  },
  currentVersion: {
    term: '当前版本',
    meaning: '文档 activeVersion（正在服务的版本）',
    notThis: ['最新写入的 documentVersion'],
  },
  latestWrittenVersion: {
    term: '最新写入版本',
    meaning: 'documentVersion 中最新写入的一条，不代表正在服务',
    notThis: ['当前版本'],
  },
} as const;

/**
 * 权威层级（需求总纲 §6）：同一事实只有一个权威来源。
 * `entersQualityScore` 必须为 false 的项目不得进入任何通过率/准确率的分子分母。
 */
export const AUTHORITY_RULES = [
  {
    id: 'quality-verdict',
    rule: '质量结论以 judge verdict（多数聚合）为准；人工标注只用于校准一致率',
    entersQualityScore: false,
  },
  {
    id: 'triage-routing',
    rule: 'failureKind 只决定进哪个队列、给谁看，不参与质量分',
    entersQualityScore: false,
  },
  {
    id: 'aux-score',
    rule: 'AiScore（分诊打分）不参与质量分，展示时必须标量纲',
    entersQualityScore: false,
  },
  {
    id: 'knowledge-score',
    rule: 'parseQuality 只描述文档解析质量，不代表回答正确；未采集显示「未采集」',
    entersQualityScore: false,
  },
  {
    id: 'data-source',
    rule: '数据来源优先级：run 记录 > 页面缓存 > 前端推断；前端推断必须标注「推断」',
    entersQualityScore: false,
  },
  {
    id: 'unique-terms',
    rule: '术语唯一：基线/对比运行、待处理、当前版本/最新写入版本的义项见 TERMS',
    entersQualityScore: false,
  },
] as const;

/** 按运行时族值找登记项；老 summary 没有 metricFamily 时返回 null。 */
function registeredFamily(metricFamily: unknown) {
  if (typeof metricFamily !== 'string' || metricFamily.trim() === '') {
    return null;
  }
  return (
    Object.values(METRIC_FAMILIES).find(
      (value) => value.summaryFamily === metricFamily,
    ) ?? null
  );
}

/**
 * 校验一份 summary：族已登记、key ⊆ SUMMARY_KEYS、版本与族配对。
 * 返回违约描述数组，空数组表示通过。
 */
export function summaryContractViolations(
  summary: Record<string, unknown>,
): string[] {
  const violations: string[] = [];
  const family = registeredFamily(summary.metricFamily);
  if (!family) {
    if (summary.metricFamily == null) {
      return ['metricFamily is missing'];
    }
    return [`metricFamily ${String(summary.metricFamily)} is not registered`];
  }
  if (family.summarySpecVersion !== summary.metricSpecVersion) {
    violations.push(
      `metricSpecVersion ${String(summary.metricSpecVersion)} != registered ` +
        `${String(family.summarySpecVersion)}`,
    );
  }
  const allowed = SUMMARY_KEYS[family.summaryFamily as keyof typeof SUMMARY_KEYS];
  const allowedKeys = new Set<string>(allowed ?? []);
  for (const key of Object.keys(summary)) {
    if (!allowedKeys.has(key)) {
      violations.push(`unregistered summary key: ${key}`);
    }
  }
  return violations;
}

/** run 级溯源：展示的分数必须能链回这些字段（spec 对外数字必须可溯源）。 */
export interface RunTrace {
  id?: string | null;
  metricFamily?: string | null;
  metricSpecVersion?: string | null;
  judgeSpecVersion?: string | null;
  datasetSnapshot?: { hash?: string | null } | null;
  scope?: string | null;
}

export function runTraceabilityIssues(run: RunTrace): string[] {
  const issues: string[] = [];
  if (!run.id?.trim()) issues.push('run id');
  if (!run.metricFamily?.trim()) {
    issues.push('metricFamily');
  } else if (!registeredFamily(run.metricFamily)) {
    issues.push(`metricFamily ${run.metricFamily} is not registered`);
  }
  if (!run.metricSpecVersion?.trim()) issues.push('metricSpecVersion');
  if (!run.judgeSpecVersion?.trim()) issues.push('judgeSpecVersion');
  const hash = run.datasetSnapshot?.hash;
  if (typeof hash !== 'string' || hash.trim() === '') {
    issues.push('datasetSnapshot.hash');
  }
  if (!run.scope?.trim()) issues.push('scope');
  return issues;
}

/**
 * 两条 run 能否并排比较。返回非空即「比较入口应禁用」，并说明缺哪项。
 * 跨族一票否决：accuracy 减 passRate 只会产出假 delta。
 */
export function comparabilityIssues(a: RunTrace, b: RunTrace): string[] {
  const issues = [
    ...runTraceabilityIssues(a).map((item) => `a: ${item}`),
    ...runTraceabilityIssues(b).map((item) => `b: ${item}`),
  ];
  if (issues.length > 0) return issues;
  if (a.metricFamily !== b.metricFamily) {
    return [
      `cross-family comparison: ${String(a.metricFamily)} vs ` +
        `${String(b.metricFamily)}`,
    ];
  }
  if (a.metricSpecVersion !== b.metricSpecVersion) {
    issues.push('metricSpecVersion mismatch');
  }
  if (a.judgeSpecVersion !== b.judgeSpecVersion) {
    issues.push('judgeSpecVersion mismatch');
  }
  if (a.datasetSnapshot?.hash !== b.datasetSnapshot?.hash) {
    issues.push('datasetSnapshot.hash mismatch');
  }
  if (a.scope !== b.scope) issues.push('scope mismatch');
  return issues;
}
