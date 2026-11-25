'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useRequest } from 'ahooks';
import { Button } from '@repo/ui';
import { aiOpsApi, aiQualityApi, chatApi, knowledgeApi } from '@/api';
import { PageHeader } from '@/components/scaffold/PageHeader';
import { AiErrorBanner } from '@/components/ai-ops/AiErrorBanner';
import { useAuthStore } from '@/store/useAuthStore';
import { canTriageFeedback, useAiOpsRole } from '@/lib/ai-ops-permissions';
import { defaultTabForRole } from '@/lib/ai-ops-role-view';
import {
  formatKnownCount,
  resolveRenderState,
} from '@/lib/ai-ops-render-state';
import { diagnoseFeedbackRow } from '@/lib/ai-ops-feedback-diagnosis';
import {
  evalAccuracyText,
  evalDeltaText,
  evalHeadline,
  evalPassRateText,
  evalPercentText,
  evalRateText,
} from '@/lib/ai-ops-eval';
import {
  applyFeedbackFilters,
  buildQualityHref,
  hasFeedbackFilters,
  parseFeedbackFilters,
  toLocalDayRangeIso,
  type FeedbackFilters,
} from '@/lib/ai-ops-quality-filters';
import type {
  AiFeedbackItem,
  AiFeedbackSummary,
  DocumentChunkDiff,
  DocumentChunkDiffEntry,
  EvalCase,
  EvalCaseHistory,
  EvalDataset,
  EvalRun,
  KbRegressionStatus,
  RunEvidence,
} from '@/type/types';

type Tab = 'feedback' | 'eval' | 'rag';

type ReviewStatus = 'PENDING' | 'REVIEWED' | 'IGNORED';

type FeedbackRow = AiFeedbackItem & {
  reviewStatus?: ReviewStatus | null;
};

const SOURCE_LABELS: Record<string, string> = {
  explicit: '显式反馈',
  implicit: '隐式信号',
};

const REVIEW_STATUS_LABELS: Record<ReviewStatus, string> = {
  PENDING: '待处理',
  REVIEWED: '已确认',
  IGNORED: '已排除',
};

const VERDICT_LABELS: Record<string, string> = {
  correct: '回答正确',
  incorrect: '回答错误',
};

const SIGNAL_LABELS: Record<string, string> = {
  transferred: '转人工',
  repeated_question: '重复追问',
  abandoned: '中途放弃',
};

const FAILURE_KIND_LABELS: Record<string, string> = {
  MODEL_ERROR: '模型答错',
  SERVICE_ERROR: '服务故障',
  EXPECTED_TRANSFER: '正常转人工',
  UNEXPECTED_TRANSFER: '误转',
  USER_ABANDONED: '用户放弃',
  REPEATED_QUESTION: '重复追问',
  KNOWLEDGE_GAP: '知识缺失',
  ROUTING: '路由错误',
  PROMPT: '提示词问题',
  PRODUCT_GAP: '产品流程缺口',
  LANGUAGE: '语言不一致',
  UNKNOWN: '未知',
};

const RESOLUTION_LABELS: Record<string, string> = {
  OPEN: '待处理',
  CONFIRMED: '确认问题',
  EXCLUDED: '已排除',
  ADDED_TO_EVAL: '已进回归',
  FIXED_PENDING_VERIFY: '已修复待验证',
  CLOSED: '已关闭',
  NO_ISSUE: '无问题',
};

/** 单用例时间线的判定归一；未判定（判官无结论）既不算通过也不算失败。 */
const CASE_OUTCOME_LABELS: Record<string, string> = {
  pass: '通过',
  fail: '失败',
  undecided: '未判定',
};

/** 两次运行的描述性差异分类；顺序即展示顺序。 */
const DIFF_CLASS_LABELS: Record<string, string> = {
  newFailure: '新增失败',
  fixed: '修复',
  regressed: '回退',
  stillFailing: '仍失败',
};

/** 解析质量四项检查的中文名，与后端 checks 的 key 一一对应。 */
const PARSE_CHECK_LABELS: Record<string, string> = {
  truncation: '截断',
  retentionRate: '保留率',
  encoding: '编码',
  emptyContent: '内容',
};

/** 转人工原因翻译成运营语言；未知值原样展示，避免隐藏信息。 */
const TRANSFER_REASON_LABELS: Record<string, string> = {
  explicit_request: '用户明确要求',
  negative_sentiment: '负面情绪',
  repeated_attempts: '反复追问未解决',
  agent_request: '客服主动接管',
  ai_error: 'AI 异常',
  manual_switch: '人工手动切换',
  below_accept_threshold: '意图置信度不足',
  below_llm_fallback_threshold: 'LLM 兜底置信度不足',
  below_execution_threshold: '执行阈值不足',
  unknown: '未知',
};

function handlerLabel(raw?: string | null): string {
  if (!raw) return '未分配';
  if (raw === 'awaiting_human') return '等待人工接手';
  if (raw === 'me') return '我';
  return `人工客服（${raw.slice(0, 8)}）`;
}

function ownerLabel(
  raw: string | null | undefined,
  currentAdminId?: string,
): string {
  if (!raw) return '未分配';
  if (currentAdminId && raw === currentAdminId) return '我';
  return `管理员（${raw.slice(0, 8)}）`;
}

const DECISION_LABELS = {
  correct: '回答正确',
  incorrect: '确认问题',
  exclude: '排除',
} as const;

type ReviewDecision = keyof typeof DECISION_LABELS;

const FAILURE_KIND_OPTIONS = Object.entries(FAILURE_KIND_LABELS).map(
  ([value, label]) => ({ value, label }),
);

/** 每行诊断：让运营不点进上下文也能判断这行值不值得处理。 */
function DiagnosisBadges({ item }: { item: FeedbackRow }) {
  const flags = diagnoseFeedbackRow({
    signal: item.signal,
    input: item.input,
    answer: item.answer,
    traceId: item.traceId,
  });
  if (flags.length === 0) {
    return <span className="text-xs text-gray-400">—</span>;
  }
  return (
    <div className="flex flex-wrap gap-1">
      {flags.map((flag) => (
        <span
          key={flag.key}
          className={
            flag.severity === 'high'
              ? 'whitespace-nowrap rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-700 dark:bg-red-500/20 dark:text-red-300'
              : 'whitespace-nowrap rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-500/20 dark:text-amber-300'
          }
        >
          {flag.label} · 推断
        </span>
      ))}
    </div>
  );
}

const RESOLUTION_OPTIONS = Object.entries(RESOLUTION_LABELS).map(
  ([value, label]) => ({ value, label }),
);

const RUN_STATUS_LABELS: Record<string, string> = {
  RUNNING: '运行中',
  COMPLETED: '已完成',
  FAILED: '失败',
  CANCELLED: '已取消',
};

/**
 * 运行级执行失败类别（与 unsolved / judge_error 分账）。
 * 只登记有产出路径的值：executeRun 收尾时写 live_call。
 */
const EXECUTION_ERROR_LABELS: Record<string, string> = {
  live_call: '实时调用失败',
};

/** 终态：轮询停止，且数据集卡片与基线下拉需要刷新。 */
function isTerminalRunStatus(status: string | null | undefined): boolean {
  return (
    status === 'COMPLETED' || status === 'FAILED' || status === 'CANCELLED'
  );
}

const RESULT_VERDICT_LABELS: Record<string, string> = {
  solved: '解决',
  partial: '部分解决',
  unsolved: '未解决',
};

/** 答案准确性三态（与任务成功率 solved/partial/unsolved 分栏展示）。 */
const ANSWER_VERDICT_LABELS: Record<string, string> = {
  correct: '正确',
  incorrect: '错误',
  judge_error: '判官未判定',
};

const SCORE_LABELS: Record<string, string> = {
  excellent: '优秀',
  good: '良好',
  fair: '一般',
  suspicious: '可疑',
};

function labelOf(map: Record<string, string>, raw?: string | null): string {
  if (!raw) return '-';
  return map[raw] ?? raw;
}

/** 中文说明 + 原始码：既让人看懂，又能对着日志查；未登记的码原样显示。 */
function labeledCode(map: Record<string, string>, raw: string): string {
  const label = map[raw];
  return label ? `${label}（${raw}）` : raw;
}

/** 与后端 DTO 同口径的输入上限；前端先挡一次，避免白跑请求。 */
const EVAL_INPUT_LIMITS = {
  mustMention: 20,
  mustMentionLength: 500,
} as const;

/** 与服务端默认值一致；页面只做上一页/下一页，不提供任意页大小。 */
const EVAL_PAGE_SIZE = 50;

function ResultPager({
  page,
  total,
  onChange,
}: {
  page: number;
  total?: number;
  onChange: (page: number) => void;
}) {
  // 总数未知时不显示分页：宁可不翻页，也不凭空算出页数。
  if (typeof total !== 'number' || total <= EVAL_PAGE_SIZE) return null;
  const totalPages = Math.max(1, Math.ceil(total / EVAL_PAGE_SIZE));
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-gray-500">
      <Button
        size="sm"
        variant="outline"
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
      >
        上一页
      </Button>
      <span>
        第 {page} / {totalPages} 页
      </span>
      <Button
        size="sm"
        variant="outline"
        disabled={page >= totalPages}
        onClick={() => onChange(page + 1)}
      >
        下一页
      </Button>
    </div>
  );
}

/** 判分以 expect 为准；expected 只在 expect 为空时作为只读兼容回填。 */
function caseExpectation(item: {
  expected?: unknown;
  expect?: Record<string, any> | null;
}): Record<string, any> {
  if (item.expect && Object.keys(item.expect).length > 0) return item.expect;
  if (typeof item.expected === 'string' && item.expected.trim()) {
    return { mustMention: [item.expected.trim()] };
  }
  if (item.expected && typeof item.expected === 'object') {
    return item.expected as Record<string, any>;
  }
  return {};
}

function expectationText(item: {
  expected?: unknown;
  expect?: Record<string, any> | null;
}): string {
  const mustMention = caseExpectation(item).mustMention;
  return Array.isArray(mustMention) ? mustMention.join('；') : '';
}

/** 非文本判分条件：编辑时只读展示，保存时原样保留。 */
function expectationConditions(item: {
  expected?: unknown;
  expect?: Record<string, any> | null;
}): string[] {
  const expect = caseExpectation(item);
  const parts: string[] = [];
  if (expect.confirmAction) parts.push(`确认动作：${expect.confirmAction}`);
  if (expect.forbidExecution !== undefined) {
    parts.push(`禁止执行：${expect.forbidExecution ? '是' : '否'}`);
  }
  if (expect.intent) parts.push(`意图：${expect.intent}`);
  return parts;
}

function expectedText(item: {
  expected?: unknown;
  expect?: Record<string, any> | null;
}): string {
  if (typeof item.expected === 'string') return item.expected;
  if (item.expected && typeof item.expected === 'object') {
    try {
      return JSON.stringify(item.expected);
    } catch {
      return '';
    }
  }
  return expectationText(item);
}

const formatPassRate = evalPassRateText;
const formatRate = evalPercentText;
const formatDelta = evalDeltaText;

/**
 * 判官失败分布有两种存法：EXTERNAL 写数组 `[{kind,count}]`，
 * 内部 run 写 `Record<kind, count>`。展示层统一成有序列表，避免
 * 内部 run 的分布被 Array.isArray 静默吞掉。
 */
function judgeKindEntries(raw: unknown): Array<{ kind: string; count: number }> {
  if (Array.isArray(raw)) {
    return raw
      .filter(
        (item): item is { kind: string; count: number } =>
          !!item &&
          typeof item === 'object' &&
          typeof (item as { kind?: unknown }).kind === 'string' &&
          typeof (item as { count?: unknown }).count === 'number',
      )
      .map((item) => ({ kind: item.kind, count: item.count }));
  }
  if (raw && typeof raw === 'object') {
    return Object.entries(raw as Record<string, unknown>)
      .filter(([, count]) => typeof count === 'number')
      .map(([kind, count]) => ({ kind, count: count as number }));
  }
  return [];
}

/** harness 物化的数据集前缀；这类数据集在控制台只读。 */
const HARNESS_DATASET_PREFIX = 'e2e:';
const isHarnessDataset = (ds?: { name?: string | null } | null): boolean =>
  typeof ds?.name === 'string' &&
  ds.name.trim().toLowerCase().startsWith(HARNESS_DATASET_PREFIX);

/**
 * REVIEWED 只是“已处理”的大类，会吞掉无问题/进回归/待验证/已关闭。
 * 列表统一展示具体处理结果，避免运营把不同结局都读成“已确认”。
 */
function feedbackOutcomeLabel(item: {
  reviewStatus?: string | null;
  resolution?: string | null;
}): string {
  if (item.reviewStatus === 'IGNORED') return '已排除';
  if (item.reviewStatus !== 'REVIEWED') return '待处理';
  switch (item.resolution) {
    case 'NO_ISSUE':
      return '已确认·无问题';
    case 'CONFIRMED':
      return '已确认·待修复';
    case 'ADDED_TO_EVAL':
      return '已进回归';
    case 'FIXED_PENDING_VERIFY':
      return '已修复待验证';
    case 'CLOSED':
      return '已关闭';
    default:
      return '已确认';
  }
}

/** 下拉项带计数；汇总未加载时不显示数字，避免把未知当成 0。 */
function withCount(label: string, count?: number): string {
  return typeof count === 'number' ? `${label}（${count}）` : label;
}

function countByValue(
  rows: Array<Record<string, any>> | undefined,
  key: string,
  value: string,
): number | undefined {
  // 聚合已加载时缺行即 0（groupBy 不返回空组）；聚合本身缺失才算未知。
  if (!Array.isArray(rows)) return undefined;
  const row = rows.find((item) => item[key] === value);
  return row ? row.count : 0;
}

/** 用例总数：后端没给就是未知，不用 0 冒充。 */
function knownCasesTotal(ds: any): number | undefined {
  const value = ds?.casesTotal ?? ds?._count?.cases ?? ds?.cases?.length;
  return typeof value === 'number' ? value : undefined;
}

/**
 * 只有可归因到 AI 行为的问题才允许沉淀为回归用例：
 * 模型答错 / 误转 / 知识缺失 / 路由错误 / 提示词 / 语言 / 判定错误；
 * 服务故障、正常转人工、产品流程缺口不算 AI 回归问题。
 */
function isModelProblem(item: FeedbackRow | null | undefined): boolean {
  if (!item) return false;
  if (
    item.failureKind === 'SERVICE_ERROR' ||
    item.failureKind === 'EXPECTED_TRANSFER' ||
    item.failureKind === 'PRODUCT_GAP'
  ) {
    return false;
  }
  return (
    item.failureKind === 'MODEL_ERROR' ||
    item.failureKind === 'UNEXPECTED_TRANSFER' ||
    item.failureKind === 'KNOWLEDGE_GAP' ||
    item.failureKind === 'ROUTING' ||
    item.failureKind === 'PROMPT' ||
    item.failureKind === 'LANGUAGE' ||
    item.verdict === 'incorrect'
  );
}

export default function AiQualityPage() {
  const role = useAiOpsRole();
  // 默认落点跟随角色；用户一旦手动切换，本次会话不再被角色覆盖。
  // 角色异步加载时 tab 仍为 null，会自动跟上真实角色。
  const [tab, setTab] = useState<Tab | null>(null);
  const activeTab = tab ?? defaultTabForRole(role);

  return (
    <div className="space-y-5 p-4">
      <PageHeader
        title="AI 质量"
        description="反馈分诊、评测集与批量跑分、知识检索质量"
      />
      <div className="flex gap-2 border-b pb-2 dark:border-white/10">
        {(
          [
            ['feedback', '质量待办'],
            ['eval', '回归测试'],
            ['rag', '知识质量'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`rounded-lg px-3 py-1.5 text-sm ${
              activeTab === key
                ? 'bg-blue-600 text-white'
                : 'border dark:border-white/10'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      {activeTab === 'feedback' ? (
        <Suspense
          fallback={
            <div className="py-8 text-center text-sm text-gray-400">
              Loading...
            </div>
          }
        >
          <FeedbackPanel onGoToEval={() => setTab('eval')} />
        </Suspense>
      ) : null}
      {activeTab === 'eval' ? <EvalPanel /> : null}
      {activeTab === 'rag' ? <RagPanel /> : null}
    </div>
  );
}

function FeedbackPanel({ onGoToEval }: { onGoToEval: () => void }) {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const filters = parseFeedbackFilters(searchParams.toString());
  const {
    reviewStatus,
    failureKind: failureKindFilter,
    resolution: resolutionFilter,
    signal: signalFilter,
    queue: queueFilter,
    from: fromDate,
    to: toDate,
  } = filters;
  const withRange = (patch: Partial<FeedbackFilters>) =>
    buildQualityHref({ ...patch, from: fromDate, to: toDate });
  const [failureKind, setFailureKind] = useState('UNKNOWN');
  const [page, setPage] = useState(1);
  const [actionError, setActionError] = useState('');
  const [actionInfo, setActionInfo] = useState('');
  const [addTarget, setAddTarget] = useState<FeedbackRow | null>(null);
  const [addDatasetId, setAddDatasetId] = useState('');
  const [adding, setAdding] = useState(false);
  const [reviewMode, setReviewMode] = useState(false);
  const [reviewIndex, setReviewIndex] = useState(0);
  const [decision, setDecision] = useState<ReviewDecision | null>(null);
  const adminId = useAuthStore((state) => state.userInfo?.id);
  const role = useAiOpsRole();
  // 开关未加载或加载失败时按关闭处理，避免渲染写按钮后 403。
  const { data: featuresData } = useRequest(aiOpsApi.getFeatures);
  const feedbackUiEnabled = featuresData?.feedbackUiEnabled === true;
  const featuresReady = featuresData != null;
  const canTriage = canTriageFeedback(role) && feedbackUiEnabled;
  const rawTextPlaceholder = role === 'VIEWER' ? '只读账号不显示原文' : null;

  const updateFilter = (patch: Partial<FeedbackFilters>) => {
    const next = applyFeedbackFilters(
      new URLSearchParams(searchParams.toString()),
      patch,
    );
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, {
      scroll: false,
    });
    setPage(1);
  };

  // URL 只保存 date-only；请求前转成显式时区的 ISO 区间，避免按服务器时区解释日期。
  const dayRange = toLocalDayRangeIso(fromDate, toDate);

  // URL 是筛选的唯一来源；直达链接或后退时也要回到第一页。
  useEffect(() => {
    setPage(1);
  }, [
    reviewStatus,
    failureKindFilter,
    resolutionFilter,
    signalFilter,
    queueFilter,
    fromDate,
    toDate,
  ]);

  const {
    data: summaryData,
    loading: summaryLoading,
    error: summaryError,
    refresh: refreshSummary,
    refreshAsync: refreshSummaryAsync,
  } = useRequest(
    () => chatApi.getFeedbackSummary(dayRange),
    { refreshDeps: [fromDate, toDate] },
  );

  const {
    data,
    loading,
    error,
    refresh,
    refreshAsync: refreshListAsync,
  } = useRequest(
    () =>
      chatApi.getFeedbackList({
        page,
        pageSize: 20,
        ...(reviewStatus ? { reviewStatus } : {}),
        ...(failureKindFilter ? { failureKind: failureKindFilter } : {}),
        ...(resolutionFilter ? { resolution: resolutionFilter } : {}),
        ...(signalFilter ? { signal: signalFilter } : {}),
        ...(queueFilter ? { queue: queueFilter } : {}),
        ...dayRange,
      } as any),
    {
      refreshDeps: [
        page,
        reviewStatus,
        failureKindFilter,
        resolutionFilter,
        signalFilter,
        queueFilter,
        fromDate,
        toDate,
      ],
    },
  );

  const { data: datasetListData, refresh: refreshDatasets } = useRequest(
    aiQualityApi.listDatasets,
  );

  const summary = summaryData as AiFeedbackSummary | undefined;
  // 汇总与列表用同一套渲染状态推导，失败/加载/未知不靠各区块自行猜测。
  const summaryState = resolveRenderState({
    loading: summaryLoading,
    error: summaryError,
  });
  const reviewStatusCount = (value: ReviewStatus) =>
    summary ? countByValue(summary.byReviewStatus, 'status', value) : undefined;
  const resolutionCount = (value: string) =>
    summary ? countByValue(summary.byResolution, 'resolution', value) : undefined;
  const list = ((data as any)?.list ?? []) as FeedbackRow[];
  const datasetList: EvalDataset[] = Array.isArray(datasetListData)
    ? (datasetListData as EvalDataset[])
    : [];
  const rawTotal = (data as any)?.total;
  const total: number | undefined =
    typeof rawTotal === 'number' ? rawTotal : undefined;
  const listState = resolveRenderState({
    loading,
    error,
    isEmpty: list.length === 0,
  });
  const kpis: Array<{ label: string; value?: number; href: string }> = [
    {
      label: '待处理',
      value: summary?.pending,
      href: withRange({ queue: 'TODO' }),
    },
    {
      label: '系统信号',
      value: summary?.signals,
      href: withRange({ queue: 'SIGNAL' }),
    },
    {
      label: '模型答错',
      value: countByValue(summary?.byFailureKind, 'failureKind', 'MODEL_ERROR'),
      href: withRange({ failureKind: 'MODEL_ERROR' }),
    },
    {
      label: '服务故障',
      value: countByValue(
        summary?.byFailureKind,
        'failureKind',
        'SERVICE_ERROR',
      ),
      href: withRange({ failureKind: 'SERVICE_ERROR' }),
    },
    {
      label: '误转',
      value: countByValue(
        summary?.byFailureKind,
        'failureKind',
        'UNEXPECTED_TRANSFER',
      ),
      href: withRange({ failureKind: 'UNEXPECTED_TRANSFER' }),
    },
    {
      label: '已进回归',
      value: countByValue(summary?.byResolution, 'resolution', 'ADDED_TO_EVAL'),
      href: withRange({ resolution: 'ADDED_TO_EVAL' }),
    },
  ];

  /** 409 = 别人先改了同一行；刷新拿新版本，避免用户对着旧数据反复失败。 */
  const isVersionConflict = (err: any) =>
    err?.response?.status === 409 || err?.status === 409;

  const triage = async (
    id: string,
    patch: {
      reviewStatus: ReviewStatus;
      resolution: 'CONFIRMED' | 'EXCLUDED' | 'NO_ISSUE';
      failureKind?: string;
      verdict?: 'correct' | 'incorrect';
      errorType?: string;
    },
    expectedVersion?: number,
  ) => {
    const note = window.prompt('备注（可选，用于记录分诊原因）') ?? undefined;
    setActionError('');
    setActionInfo('');
    try {
      await aiQualityApi.updateFeedback(id, {
        ...patch,
        note,
        ...(expectedVersion != null ? { expectedVersion } : {}),
      } as any);
      // 必须等刷新完成再前进，否则候选列表还是旧数据，会跳过下一条。
      await Promise.all([refreshListAsync(), refreshSummaryAsync()]);
      return true;
    } catch (err: any) {
      if (isVersionConflict(err)) {
        await Promise.all([refreshListAsync(), refreshSummaryAsync()]);
        setActionError('这条反馈刚被他人更新，列表已刷新，请重试');
      } else {
        setActionError(err?.message ?? '分诊失败，请重试');
      }
      return false;
    }
  };

  const refreshAfterAction = async () => {
    await Promise.all([refreshListAsync(), refreshSummaryAsync()]);
  };

  /** 已确认问题的后续处理：修复待验证 / 关闭，不重复写人工评分。 */
  const applyResolution = async (
    id: string,
    resolution: 'FIXED_PENDING_VERIFY' | 'CLOSED',
    expectedVersion?: number,
  ) => {
    setActionError('');
    setActionInfo('');
    try {
      await aiQualityApi.updateFeedback(id, {
        resolution,
        ...(expectedVersion != null ? { expectedVersion } : {}),
      } as any);
      await refreshAfterAction();
      setActionInfo(`已标记为${labelOf(RESOLUTION_LABELS, resolution)}`);
    } catch (err: any) {
      if (isVersionConflict(err)) {
        await refreshAfterAction();
        setActionError('这条反馈刚被他人更新，列表已刷新，请重试');
      } else {
        setActionError(err?.message ?? '更新处理状态失败，请重试');
      }
    }
  };

  /**
   * 认领：仅空位可认领；已有他人认领时必须显式 takeOver 才覆盖。
   * 认领与处理完成分开——认领只写负责人，不改 reviewStatus/resolution。
   */
  const claimOwner = async (item: FeedbackRow) => {
    if (!adminId) {
      setActionError('未获取到当前管理员身份，无法认领');
      return;
    }
    const currentOwner = item.claimedBy ?? item.ownerAdminId ?? null;
    if (currentOwner === adminId) {
      setActionInfo('这条反馈已经由你认领');
      return;
    }
    const takeOver = Boolean(currentOwner);
    setActionError('');
    setActionInfo('');
    try {
      await aiQualityApi.updateFeedback(item.id, {
        ownerAdminId: adminId,
        ...(item.version != null ? { expectedVersion: item.version } : {}),
        ...(takeOver ? { takeOver: true } : {}),
      } as any);
      await refreshAfterAction();
      setActionInfo(takeOver ? '已接手，负责人是你' : '已认领，负责人是你');
    } catch (err: any) {
      if (isVersionConflict(err)) {
        await refreshAfterAction();
        setActionError('这条反馈刚被他人认领或更新，列表已刷新，请重试');
      } else {
        setActionError(err?.message ?? '认领失败，请重试');
      }
    }
  };

  /**
   * 批量排除只针对当前页的服务故障；模型答错永不进入批量，避免误伤。
   * 已排除/已忽略的条目不重复处理。
   */
  const batchExcludeTargets = list.filter(
    (item) =>
      item.failureKind === 'SERVICE_ERROR' &&
      item.resolution !== 'EXCLUDED' &&
      item.reviewStatus !== 'IGNORED',
  );

  const batchExcludeServiceErrors = async () => {
    if (batchExcludeTargets.length === 0) {
      setActionInfo('当前页没有可批量排除的服务故障');
      return;
    }
    const ok = window.confirm(
      `确认批量排除当前页 ${batchExcludeTargets.length} 条服务故障反馈？\n只会排除服务故障，模型答错不会受影响。`,
    );
    if (!ok) return;
    setActionError('');
    setActionInfo('');
    const results = await Promise.allSettled(
      batchExcludeTargets.map((item) =>
        aiQualityApi.updateFeedback(item.id, {
          reviewStatus: 'IGNORED',
          resolution: 'EXCLUDED',
          failureKind: 'SERVICE_ERROR',
          ...(item.version != null ? { expectedVersion: item.version } : {}),
        } as any),
      ),
    );
    const failed = results.filter(
      (result) => result.status === 'rejected',
    ).length;
    await refreshAfterAction();
    const succeeded = batchExcludeTargets.length - failed;
    setActionInfo(
      `已批量排除 ${succeeded} 条服务故障${
        failed ? `，${failed} 条失败请重试` : ''
      }`,
    );
    if (failed) {
      setActionError(`批量排除有 ${failed} 条失败，请重试剩余条目`);
    }
  };

  const openAddToRegression = (item: FeedbackRow) => {
    setAddTarget(item);
    setAddDatasetId((current) => current || datasetList[0]?.id || '');
    setActionError('');
    setActionInfo('');
  };

  const addToRegression = async () => {
    if (!addTarget) return;
    if (!addDatasetId) {
      setActionError('请先选择评测集');
      return;
    }
    const target = addTarget;
    if (!target.input?.trim()) {
      setActionError('这条反馈没有用户问题，无法生成回归用例');
      return;
    }
    const expected = window
      .prompt('期望答案 / 必须提到的要点（必填，作为回归判分标准）')
      ?.trim();
    if (!expected) {
      setActionError('回归用例必须填写期望答案，否则无法证明修复有效');
      return;
    }
    setAdding(true);
    setActionError('');
    setActionInfo('');
    try {
      const result = (await aiQualityApi.addCases(addDatasetId, {
        cases: [
          {
            question: target.input,
            answer: target.answer ?? '',
            expect: { mustMention: [expected] },
            expected,
            sourceFeedbackId: target.id,
            source: 'feedback',
            tags: ['from-feedback', target.failureKind ?? 'UNKNOWN'],
          },
        ],
      })) as
        | (EvalDataset & {
            cases?: EvalCase[];
            createdCases?: Array<{ id: string; question: string }>;
          })
        | undefined;
      // cases 只是当前页；新建项必须用 createdCases 定位，否则超过一页就找不到。
      const created =
        result?.createdCases?.find(
          (item) => item.question === (target.input ?? ''),
        ) ??
        [...(result?.cases ?? [])]
          .reverse()
          .find((item) => item.question === (target.input ?? ''));
      if (!created) {
        throw new Error('用例已提交，但未能定位新建用例，请刷新后手动关联');
      }
      await aiQualityApi.updateFeedback(target.id, {
        linkedEvalCaseId: created.id,
        resolution: 'ADDED_TO_EVAL',
        ...(target.version != null ? { expectedVersion: target.version } : {}),
      });
      setAddTarget(null);
      setActionInfo('已加入回归评测集');
      await Promise.all([refresh(), refreshSummary(), refreshDatasets()]);
    } catch (err: any) {
      setActionError(err?.message ?? '加入回归失败，请重试');
    } finally {
      setAdding(false);
    }
  };

  const candidates = list.filter(
    (item) => !item.reviewStatus || item.reviewStatus === 'PENDING',
  );
  const reviewList = candidates;
  const current = reviewMode ? reviewList[reviewIndex] : null;

  useEffect(() => {
    if (!reviewMode) return;
    if (reviewList.length === 0) {
      setReviewMode(false);
      setReviewIndex(0);
      return;
    }
    if (reviewIndex >= reviewList.length) {
      setReviewIndex(reviewList.length - 1);
    }
  }, [reviewMode, reviewIndex, reviewList.length]);

  // 当前条目已被分诊移除，下一条会顶到同一位置，所以索引保持不动。
  const advanceReview = () => setReviewIndex(0);

  const handleReview = async (kind: 'correct' | 'incorrect' | 'exclude') => {
    if (!current) return;
    const patch =
      kind === 'correct'
        ? {
            reviewStatus: 'REVIEWED' as const,
            resolution: 'NO_ISSUE' as const,
            verdict: 'correct' as const,
          }
        : kind === 'incorrect'
          ? {
              reviewStatus: 'REVIEWED' as const,
              resolution: 'CONFIRMED' as const,
              verdict: 'incorrect' as const,
              failureKind,
            }
          : {
              reviewStatus: 'IGNORED' as const,
              resolution: 'EXCLUDED' as const,
              failureKind,
            };
    const ok = await triage(current.id, patch, current.version);
    if (ok) {
      setDecision(null);
      advanceReview();
    }
  };

  // 键盘监听只注册一次，通过 ref 调用最新的分诊逻辑，避免 effect 反复重建。
  const reviewActionRef = useRef(handleReview);
  reviewActionRef.current = handleReview;

  // 质检模式快捷键：J/K 或 ↑/↓ 切换，1/2/3 选判断，Enter 保存并下一条，Esc 退出。
  useEffect(() => {
    if (!reviewMode) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (
        tag === 'input' ||
        tag === 'textarea' ||
        tag === 'select' ||
        target?.isContentEditable
      ) {
        return;
      }
      switch (event.key) {
        case 'j':
        case 'J':
        case 'ArrowDown':
          event.preventDefault();
          setReviewIndex((index) =>
            Math.min(index + 1, Math.max(reviewList.length - 1, 0)),
          );
          setDecision(null);
          break;
        case 'k':
        case 'K':
        case 'ArrowUp':
          event.preventDefault();
          setReviewIndex((index) => Math.max(index - 1, 0));
          setDecision(null);
          break;
        case '1':
          event.preventDefault();
          setDecision('correct');
          break;
        case '2':
          event.preventDefault();
          setDecision('incorrect');
          break;
        case '3':
          event.preventDefault();
          setDecision('exclude');
          break;
        case 'Enter':
          if (decision) {
            event.preventDefault();
            void reviewActionRef.current(decision);
          }
          break;
        case 'Escape':
          event.preventDefault();
          setReviewMode(false);
          setDecision(null);
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [reviewMode, reviewList.length, decision]);

  return (
    <section className="space-y-3">
      {featuresReady && !feedbackUiEnabled ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
          反馈分诊未启用（AI_FEEDBACK_UI_ENABLED=false）。当前只能查看，不能提交判断。
        </div>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {kpis.map(({ label, value, href }) => (
          <Link
            key={label}
            href={href}
            aria-label={`${label}，查看对应反馈`}
            className="rounded-xl border p-3 transition-colors hover:border-blue-300 hover:bg-blue-50/50 dark:border-white/10 dark:hover:border-blue-500/40 dark:hover:bg-blue-500/5"
          >
            <div className="text-xs text-gray-500">{label}</div>
            <div className="text-lg font-semibold">
              {formatKnownCount(value, summaryState)}
            </div>
          </Link>
        ))}
      </div>

      {summaryError ? (
        <AiErrorBanner
          message="反馈汇总加载失败，请重试"
          onRetry={refreshSummary}
        />
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-xs text-gray-500">
          分诊状态
          <select
            aria-label="反馈分诊状态"
            className="rounded-lg border px-3 py-1.5 text-sm dark:border-white/10 dark:bg-gray-800"
            value={reviewStatus}
            onChange={(e) => {
              updateFilter({
                reviewStatus: e.target.value as FeedbackFilters['reviewStatus'],
              });
            }}
          >
            <option value="">全部状态</option>
            {(
              Object.entries(REVIEW_STATUS_LABELS) as Array<
                [ReviewStatus, string]
              >
            ).map(([value, label]) => (
              <option key={value} value={value}>
                {withCount(label, reviewStatusCount(value))}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-xs text-gray-500">
          归因
          <select
            aria-label="归因筛选"
            className="rounded-lg border px-3 py-1.5 text-sm dark:border-white/10 dark:bg-gray-800"
            value={failureKindFilter}
            onChange={(e) => {
              updateFilter({
                failureKind: e.target.value as FeedbackFilters['failureKind'],
              });
            }}
          >
            <option value="">全部归因</option>
            {FAILURE_KIND_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-xs text-gray-500">
          处理状态
          <select
            aria-label="处理状态筛选"
            className="rounded-lg border px-3 py-1.5 text-sm dark:border-white/10 dark:bg-gray-800"
            value={resolutionFilter}
            onChange={(e) => {
              updateFilter({
                resolution: e.target.value as FeedbackFilters['resolution'],
              });
            }}
          >
            <option value="">全部处理状态</option>
            {RESOLUTION_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {withCount(option.label, resolutionCount(option.value))}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-xs text-gray-500">
          开始日期
          <input
            type="date"
            aria-label="反馈开始日期"
            className="rounded-lg border px-3 py-1.5 text-sm dark:border-white/10 dark:bg-gray-800"
            value={fromDate}
            onChange={(e) => updateFilter({ from: e.target.value })}
          />
        </label>
        <label className="flex items-center gap-2 text-xs text-gray-500">
          结束日期
          <input
            type="date"
            aria-label="反馈结束日期"
            className="rounded-lg border px-3 py-1.5 text-sm dark:border-white/10 dark:bg-gray-800"
            value={toDate}
            onChange={(e) => updateFilter({ to: e.target.value })}
          />
        </label>
        <label className="flex items-center gap-2 text-xs text-gray-500">
          队列
          <select
            aria-label="反馈队列筛选"
            className="rounded-lg border px-3 py-1.5 text-sm dark:border-white/10 dark:bg-gray-800"
            value={queueFilter}
            onChange={(e) => {
              updateFilter({
                queue: e.target.value as FeedbackFilters['queue'],
              });
            }}
          >
            <option value="">全部队列</option>
            <option value="TODO">待办</option>
            <option value="SIGNAL">系统信号</option>
          </select>
        </label>
        <label className="flex items-center gap-2 text-xs text-gray-500">
          来源信号
          <select
            aria-label="来源信号筛选"
            className="rounded-lg border px-3 py-1.5 text-sm dark:border-white/10 dark:bg-gray-800"
            value={signalFilter}
            onChange={(e) => {
              updateFilter({
                signal: e.target.value as FeedbackFilters['signal'],
              });
            }}
          >
            <option value="">全部信号</option>
            {Object.entries(SIGNAL_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {hasFeedbackFilters(filters) ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              updateFilter({
                reviewStatus: '',
                failureKind: '',
                resolution: '',
                signal: '',
                queue: '',
                from: '',
                to: '',
              });
            }}
          >
            清除筛选
          </Button>
        ) : null}
        <Button size="sm" variant="outline" onClick={refresh}>
          刷新
        </Button>
        {canTriage ? (
          <Button
            size="sm"
            variant="outline"
            disabled={batchExcludeTargets.length === 0}
            title={
              batchExcludeTargets.length === 0
                ? '当前页没有可批量排除的服务故障（模型答错不允许批量排除）'
                : '只批量排除当前页的服务故障，模型答错不会受影响'
            }
            onClick={() => void batchExcludeServiceErrors()}
          >
            批量排除服务故障（{batchExcludeTargets.length}）
          </Button>
        ) : null}
        {canTriage ? (
          <Button
            size="sm"
            onClick={() => {
              setReviewIndex(0);
              setDecision(null);
              setReviewMode(true);
            }}
          >
            开始质检
          </Button>
        ) : null}
        <span className="text-xs text-gray-500">
          共 {formatKnownCount(total, listState)} 条
        </span>
        {!canTriage ? (
          <span className="rounded-lg border px-2 py-0.5 text-xs text-gray-500 dark:border-white/10">
            只读
          </span>
        ) : null}
      </div>

      {error ? (
        <AiErrorBanner message="反馈列表加载失败，请重试" onRetry={refresh} />
      ) : null}
      {actionError ? (
        <AiErrorBanner
          message={actionError}
          onRetry={() => setActionError('')}
        />
      ) : null}
      {actionInfo ? (
        <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700 dark:border-green-500/30 dark:bg-green-500/10 dark:text-green-300">
          {actionInfo}
        </div>
      ) : null}

      {addTarget ? (
        <section className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-4 dark:border-emerald-500/30 dark:bg-emerald-500/5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">加入回归</h2>
            <button
              type="button"
              className="text-xs text-gray-500 hover:underline"
              onClick={() => setAddTarget(null)}
            >
              取消
            </button>
          </div>
          <p className="mt-1 text-xs text-gray-500">
            将这条反馈沉淀为一条评测用例，期望结果可稍后在回归测试中补充。
          </p>
          <div className="mt-2 text-xs text-gray-500">
            问题：{addTarget.input ?? '-'} · 归因：
            {labelOf(FAILURE_KIND_LABELS, addTarget.failureKind)}
          </div>
          {datasetList.length === 0 ? (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="text-sm text-amber-700 dark:text-amber-300">
                先创建评测集
              </span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setAddTarget(null);
                  onGoToEval();
                }}
              >
                去创建评测集
              </Button>
            </div>
          ) : (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <select
                aria-label="选择回归评测集"
                className="rounded-lg border px-3 py-1.5 text-sm dark:border-white/10 dark:bg-gray-800"
                value={addDatasetId}
                onChange={(e) => setAddDatasetId(e.target.value)}
              >
                <option value="">选择评测集</option>
                {datasetList.map((dataset) => (
                  <option key={dataset.id} value={dataset.id}>
                    {dataset.name}（{dataset._count?.cases ?? '未知'} 条用例）
                  </option>
                ))}
              </select>
              <Button
                size="sm"
                disabled={adding || !addDatasetId}
                onClick={() => void addToRegression()}
              >
                {adding ? '加入中…' : '确认加入回归'}
              </Button>
            </div>
          )}
        </section>
      ) : null}

      {current ? (
        <section className="rounded-xl border border-blue-200 bg-blue-50/50 p-4 dark:border-blue-500/30 dark:bg-blue-500/5">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">
              质检 {reviewIndex + 1} / {reviewList.length}
            </h2>
            <button
              type="button"
              className="text-xs text-gray-500 hover:underline"
              onClick={() => {
                setReviewMode(false);
                setDecision(null);
              }}
            >
              退出质检
            </button>
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            <div className="rounded-lg border bg-white p-3 text-sm dark:border-white/10 dark:bg-gray-900">
              <div className="mb-1 text-xs text-gray-500">用户问题</div>
              <div>{rawTextPlaceholder ?? current.input ?? '-'}</div>
              <div className="mb-1 mt-3 text-xs text-gray-500">AI 回答</div>
              <div className="max-h-40 overflow-y-auto text-gray-700 dark:text-gray-300">
                {rawTextPlaceholder ?? current.answer ?? '-'}
              </div>
              <div className="mt-3 text-xs text-gray-500">
                来源：{labelOf(SOURCE_LABELS, current.source)} · 信号：
                {current.signal
                  ? labelOf(SIGNAL_LABELS, current.signal)
                  : labelOf(VERDICT_LABELS, current.verdict)}
              </div>
              <div className="mt-3 grid gap-1 border-t pt-2 text-xs text-gray-500 dark:border-white/10">
                <div>
                  转人工原因：
                  {labelOf(TRANSFER_REASON_LABELS, current.transferReason)}
                </div>
                <div>处理客服：{handlerLabel(current.handlerId)}</div>
                <div>
                  负责人：
                  {ownerLabel(current.claimedBy ?? current.ownerAdminId, adminId)}
                </div>
                <div>处理结果：{feedbackOutcomeLabel(current)}</div>
              </div>
            </div>
            <div className="rounded-lg border bg-white p-3 dark:border-white/10 dark:bg-gray-900">
              <div className="mb-2 text-xs text-gray-500">这条怎么处理？</div>
              <label className="mb-2 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                主要原因
                <select
                  aria-label="主要原因"
                  className="rounded-lg border px-3 py-1.5 text-sm text-gray-900 dark:border-white/10 dark:bg-gray-800 dark:text-gray-100"
                  value={failureKind}
                  onChange={(e) => setFailureKind(e.target.value)}
                >
                  {FAILURE_KIND_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={() => void handleReview('correct')}>
                  回答正确
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void handleReview('incorrect')}
                >
                  确认问题
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void handleReview('exclude')}
                >
                  排除
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={
                    !adminId ||
                    (current.claimedBy ?? current.ownerAdminId) === adminId
                  }
                  title={
                    !adminId
                      ? '未获取到当前管理员身份'
                      : (current.claimedBy ?? current.ownerAdminId) === adminId
                        ? '你已经是这条反馈的负责人'
                        : current.claimedBy ?? current.ownerAdminId
                          ? '从其他管理员手中接手'
                          : '把负责人设为当前管理员'
                  }
                  onClick={() => void claimOwner(current)}
                >
                  {(current.claimedBy ?? current.ownerAdminId) === adminId
                    ? '已认领'
                    : current.claimedBy ?? current.ownerAdminId
                      ? '接手'
                      : '认领'}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!isModelProblem(current)}
                  title={
                    isModelProblem(current)
                      ? '将这条反馈加入回归评测集'
                      : '仅模型答错、知识缺失、路由、提示词、语言或判定错误的反馈可加入回归'
                  }
                  onClick={() => openAddToRegression(current)}
                >
                  加入回归
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setDecision(null);
                    advanceReview();
                  }}
                >
                  跳过
                </Button>
              </div>
              <div className="mt-3 rounded-lg bg-gray-50 px-2 py-1.5 text-xs text-gray-500 dark:bg-white/5">
                当前选择：
                {decision ? DECISION_LABELS[decision] : '按 1 / 2 / 3 选择'}
                {' · '}按 Enter 保存并下一条
              </div>
              <div className="mt-1 text-xs text-gray-400">
                快捷键：J / K 或 ↑ / ↓ 切换 · 1 正确 · 2 确认 · 3 排除 · Enter
                保存并下一条 · Esc 退出
              </div>
              <a
                className="mt-3 inline-block text-xs text-blue-600 hover:underline"
                href={`/ai-ops/context?conversationId=${current.conversationId}`}
              >
                查看完整上下文
              </a>
            </div>
          </div>
        </section>
      ) : null}

      <div className="overflow-x-auto rounded-xl border border-gray-100 dark:border-white/10">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-left dark:bg-white/5">
            <tr>
              {[
                '时间',
                '来源',
                '判定/信号',
                '归因',
                '处理结果',
                '负责人',
                '诊断',
                '用户问题',
                'AI 回答',
                '备注',
                '操作',
              ].map((h) => (
                <th key={h} className="whitespace-nowrap px-3 py-2">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {listState.kind === 'loading' ? (
              <tr>
                <td
                  colSpan={11}
                  className="px-3 py-6 text-center text-gray-400"
                >
                  加载中…
                </td>
              </tr>
            ) : listState.kind === 'error' ? null : listState.kind ===
              'empty' ? (
              <tr>
                <td
                  colSpan={11}
                  className="px-3 py-6 text-center text-gray-400"
                >
                  暂无反馈
                </td>
              </tr>
            ) : (
              list.map((item) => (
                <tr
                  key={item.id}
                  className="border-t border-gray-100 dark:border-white/5"
                >
                  <td className="px-3 py-2">
                    {new Date(item.createdAt).toLocaleString()}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    {labelOf(SOURCE_LABELS, item.source)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    {item.verdict
                      ? labelOf(VERDICT_LABELS, item.verdict)
                      : item.signal
                        ? labelOf(SIGNAL_LABELS, item.signal)
                        : '-'}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    {labelOf(FAILURE_KIND_LABELS, item.failureKind)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    {feedbackOutcomeLabel(item)}
                    {item.reviewStatus === 'REVIEWED' &&
                    item.resolution === 'FIXED_PENDING_VERIFY' ? (
                      <span
                        className="ml-1 rounded border border-amber-300 px-1 py-0.5 text-[10px] text-amber-700 dark:border-amber-500/40 dark:text-amber-300"
                        title="下一轮评测通过后自动关闭；判定失败会打回并记录回退时间"
                      >
                        待验
                      </span>
                    ) : null}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    {ownerLabel(item.claimedBy ?? item.ownerAdminId, adminId)}
                  </td>
                  <td className="px-3 py-2">
                    <DiagnosisBadges item={item} />
                  </td>
                  <td
                    className="max-w-[260px] truncate px-3 py-2"
                    title={rawTextPlaceholder ?? item.input ?? ''}
                  >
                    {rawTextPlaceholder ?? item.input ?? '-'}
                  </td>
                  <td
                    className="max-w-[320px] truncate px-3 py-2 text-gray-600 dark:text-gray-300"
                    title={rawTextPlaceholder ?? item.answer ?? ''}
                  >
                    {rawTextPlaceholder ?? item.answer ?? '-'}
                  </td>
                  <td
                    className="max-w-[220px] truncate px-3 py-2"
                    title={item.note ?? ''}
                  >
                    {item.note ?? '-'}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-2">
                      {canTriage ? (
                        <>
                          <Button
                            size="sm"
                            onClick={() =>
                              void triage(item.id, {
                                reviewStatus: 'REVIEWED',
                                resolution: 'CONFIRMED',
                                failureKind: item.failureKind ?? 'UNKNOWN',
                              })
                            }
                          >
                            确认问题
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              void triage(
                                item.id,
                                {
                                  reviewStatus: 'IGNORED',
                                  resolution: 'EXCLUDED',
                                  failureKind: item.failureKind ?? 'UNKNOWN',
                                },
                                item.version,
                              )
                            }
                          >
                            排除
                          </Button>
                          {adminId &&
                          (item.claimedBy ?? item.ownerAdminId) !== adminId ? (
                            <Button
                              size="sm"
                              variant="outline"
                              title={
                                item.claimedBy ?? item.ownerAdminId
                                  ? '从其他管理员手中接手'
                                  : '把负责人设为当前管理员'
                              }
                              onClick={() => void claimOwner(item)}
                            >
                              {item.claimedBy ?? item.ownerAdminId
                                ? '接手'
                                : '认领'}
                            </Button>
                          ) : null}
                          {item.resolution === 'CONFIRMED' ? (
                            <>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() =>
                                  void applyResolution(
                                    item.id,
                                    'FIXED_PENDING_VERIFY',
                                    item.version,
                                  )
                                }
                              >
                                标记已修复待验证
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() =>
                                  void applyResolution(item.id, 'CLOSED', item.version)
                                }
                              >
                                关闭
                              </Button>
                            </>
                          ) : null}
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={!isModelProblem(item)}
                            title={
                              isModelProblem(item)
                                ? '将这条反馈加入回归评测集'
                                : '仅模型答错、知识缺失、路由、提示词、语言或判定错误的反馈可加入回归'
                            }
                            onClick={() => openAddToRegression(item)}
                          >
                            加入回归
                          </Button>
                        </>
                      ) : null}
                      <a
                        className="inline-flex items-center rounded-lg border px-2 py-1 text-xs hover:bg-gray-50 dark:border-white/10 dark:hover:bg-white/5"
                        href={`/ai-ops/context?conversationId=${item.conversationId}`}
                      >
                        查看上下文
                      </a>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <div className="flex justify-end gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={page <= 1}
          onClick={() => setPage((p) => p - 1)}
        >
          上一页
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={typeof total === 'number' && page * 20 >= total}
          onClick={() => setPage((p) => p + 1)}
        >
          下一页
        </Button>
      </div>
    </section>
  );
}

const KB_CHANGE_LABELS: Record<string, string> = {
  added: '新增',
  removed: '删除',
  content_changed: '内容变化',
};

/**
 * 回归状态卡：当前语料 vs 上次全量快照。
 *
 * 三种状态必须一眼分开：没有基线（先跑全量）、已覆盖（无需子集）、
 * 有变更（列出文档与受影响用例，并给出可复制的子集命令）。
 */
function KbRegressionCard() {
  const { data, loading, error, refresh } = useRequest(
    aiQualityApi.kbRegressionStatus,
  );
  const status = data as KbRegressionStatus | undefined;
  const [copyState, setCopyState] = useState('');

  // 状态来自后端实时计算；旧版本/缺字段时按空处理，避免整页白屏。
  const changedDocs = status?.changedDocs ?? [];
  const affectedCaseIds = status?.affectedCaseIds ?? [];
  const uncoveredDocIds = status?.uncoveredDocIds ?? [];
  const pendingActivation = status?.pendingActivation ?? [];

  const changedDocIds = Array.from(
    new Set(changedDocs.map((item) => item.docId)),
  );
  const subsetCommand =
    status?.baseline && changedDocIds.length > 0
      ? [
          'E2E_SCOPE=subset',
          `E2E_DOC_IDS=${changedDocIds.join(',')}`,
          `E2E_BASE_RUN_ID=${status.baseline.runId}`,
          'E2E_KINDS=knowledge,multi',
          'node tools/eval/e2e/run.mjs',
        ].join(' ')
      : '';

  const copyCommand = async () => {
    if (!subsetCommand) return;
    try {
      await navigator.clipboard.writeText(subsetCommand);
      setCopyState('已复制子集命令');
    } catch {
      setCopyState('浏览器阻止了复制，请手动选择命令复制');
    }
  };

  return (
    <div className="rounded-xl border border-gray-100 bg-white p-4 dark:border-white/10 dark:bg-gray-900">
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="text-sm font-semibold">知识库回归</h3>
        <Button size="sm" variant="outline" onClick={refresh}>
          刷新状态
        </Button>
        {loading ? (
          <span className="text-xs text-gray-500">加载中…</span>
        ) : null}
      </div>

      {error ? (
        <div className="mt-3">
          <AiErrorBanner message="回归状态加载失败，请重试" onRetry={refresh} />
        </div>
      ) : null}

      {status ? (
        <div className="mt-3 space-y-3 text-sm">
          <div className="space-y-1">
            <div className="text-xs text-gray-500">
              当前语料指纹（正在服务的正文与激活版本）
            </div>
            <code className="block break-all rounded-lg bg-gray-50 p-2 font-mono text-xs dark:bg-gray-800">
              {status.currentFingerprint}
            </code>
            <div className="text-xs text-gray-500">
              采集时间 {new Date(status.generatedAt).toLocaleString()}
              {status.baseline ? (
                <>
                  {' · '}上次全量{' '}
                  <span className="font-mono">
                    {status.baseline.runId.slice(0, 8)}
                  </span>{' '}
                  {status.baseline.finishedAt
                    ? new Date(status.baseline.finishedAt).toLocaleString()
                    : ''}
                </>
              ) : null}
            </div>
          </div>

          {status.needsFullRun ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
              还没有可用于对比的全量基线。请先跑一次全量回归，系统才能算出受影响用例；全量完成后来这里刷新。
            </div>
          ) : status.covered ? (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300">
              当前语料与上次全量一致，没有变更文档，无需跑子集。
            </div>
          ) : (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
              知识库有 {changedDocs.length} 篇文档变更，影响{' '}
              {status.affectedCaseCount} 条回归用例。建议先跑子集（约 2–5
              分钟）确认变更，发版前再跑一次全量。
            </div>
          )}

          {changedDocs.length > 0 ? (
            <div>
              <div className="mb-1 text-xs font-medium text-gray-500">
                变更文档
              </div>
              <div className="max-h-56 space-y-1 overflow-y-auto text-xs">
                {changedDocs.map((item) => (
                  <div
                    key={`${item.docId}|${item.locale}`}
                    className="rounded-lg border p-2 dark:border-white/10"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono">{item.docId}</span>
                      <span className="text-gray-500">{item.locale}</span>
                      <span className="rounded border px-1 py-0.5 dark:border-white/10">
                        {KB_CHANGE_LABELS[item.change] ?? item.change}
                      </span>
                    </div>
                    <div className="mt-1 text-gray-500">
                      {item.change === 'added'
                        ? `新增 · 当前 v${item.current?.activeVersion ?? '-'} / ${
                            item.current?.activeChunkCount ?? '-'
                          } 块`
                        : item.change === 'removed'
                          ? `已删除 · 原 v${
                              item.previous?.activeVersion ?? '-'
                            } / ${item.previous?.activeChunkCount ?? '-'} 块`
                          : `旧版本 v${item.previous?.activeVersion ?? '-'} / ${
                              item.previous?.activeChunkCount ?? '-'
                            } 块 → 新版本 v${
                              item.current?.activeVersion ?? '-'
                            } / ${item.current?.activeChunkCount ?? '-'} 块`}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {status.affectedCaseCount > 0 ? (
            <details className="text-xs">
              <summary className="cursor-pointer text-gray-500">
                受影响用例（{status.affectedCaseCount}）
              </summary>
              <div className="mt-1 flex flex-wrap gap-1">
                {affectedCaseIds.map((caseId) => (
                  <span
                    key={caseId}
                    className="rounded border px-1 py-0.5 font-mono dark:border-white/10"
                  >
                    {caseId}
                  </span>
                ))}
              </div>
            </details>
          ) : null}

          {uncoveredDocIds.length > 0 ? (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
              以下变更文档没有任何用例覆盖，子集无法证明它们的改动：
              <span className="ml-1 font-mono">
                {uncoveredDocIds.join(', ')}
              </span>
              。请先补充用例。
            </div>
          ) : null}

          {pendingActivation.length > 0 ? (
            <div className="rounded-lg border border-amber-200 p-3 text-xs text-amber-700 dark:border-amber-500/30 dark:text-amber-300">
              有 {pendingActivation.length}{' '}
              篇文档待激活或索引未完成，激活后指纹才会变化，子集应在激活后执行：
              <span className="ml-1 font-mono">
                {pendingActivation.map((item) => item.docId).join(', ')}
              </span>
            </div>
          ) : null}

          {subsetCommand ? (
            <div>
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium text-gray-500">
                  复制子集命令（在仓库根目录执行）
                </span>
                <Button size="sm" variant="outline" onClick={copyCommand}>
                  复制子集命令
                </Button>
                {copyState ? (
                  <span className="text-xs text-gray-500">{copyState}</span>
                ) : null}
              </div>
              <pre className="overflow-x-auto rounded-lg bg-gray-50 p-2 text-xs dark:bg-gray-800">
                {subsetCommand}
              </pre>
            </div>
          ) : null}

          {status.lastSubsetRun ? (
            <div className="text-xs text-gray-500">
              最近子集运行{' '}
              <span className="font-mono">
                {status.lastSubsetRun.id.slice(0, 8)}
              </span>
              {status.lastSubsetRun.finishedAt
                ? ` · ${new Date(
                    status.lastSubsetRun.finishedAt,
                  ).toLocaleString()}`
                : ''}{' '}
              · 语料稳定{' '}
              {status.lastSubsetRun.stable === true
                ? '是'
                : status.lastSubsetRun.stable === false
                  ? '否（不可作为证据）'
                  : '未知'}
              {status.lastSubsetRun.summary
                ? ` · 准确率 ${evalAccuracyText(
                    status.lastSubsetRun.summary,
                  )}`
                : ''}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

const EVIDENCE_CHECK_LABELS: Record<string, string> = {
  status: '运行状态',
  mode: '运行来源',
  scope: '运行范围',
  knowledgeFingerprint: '语料指纹字段',
  stable: '运行期间语料稳定',
  fingerprint: '指纹与当前语料一致',
  pendingActivation: '无待激活文档',
  codeVersion: '代码版本',
  datasetSnapshot: '数据集快照',
  judgeSpecVersion: '判官输入规范',
  metricSpecVersion: '指标定义版本',
  judgeErrorRate: '判官失败率',
  judgeAgreement: '判官一致性',
  executedCases: '执行用例完整',
  harnessFailureRate: 'harness 失败率',
};

function EvalPanel() {
  const [name, setName] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [casesJson, setCasesJson] = useState('[]');
  const [expectEdit, setExpectEdit] = useState<{
    caseId: string;
    text: string;
  } | null>(null);
  const [runId, setRunId] = useState('');
  const [mode, setMode] = useState<'STORED' | 'LIVE'>('STORED');
  const [baselineRunId, setBaselineRunId] = useState('');
  const [message, setMessage] = useState('');
  const [advanced, setAdvanced] = useState(false);
  const [pollRun, setPollRun] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [starting, setStarting] = useState(false);
  const [showEvidence, setShowEvidence] = useState(false);
  const [casesPage, setCasesPage] = useState(1);
  const [resultsPage, setResultsPage] = useState(1);
  // 单条结果的时间线是按需加载的，不做全量预取。
  const [historyCaseId, setHistoryCaseId] = useState<string | null>(null);
  const [history, setHistory] = useState<{
    caseId: string;
    data: EvalCaseHistory;
  } | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const role = useAiOpsRole();
  // 写入口统一由「有权限 + 开关开启」双重控制；缺一都不渲染按钮。
  // 开关未加载或加载失败时按关闭处理，宁可少给入口，也不要点了再吃 403。
  const { data: featuresData } = useRequest(aiOpsApi.getFeatures);
  const evalEnabled = featuresData?.evalEnabled === true;
  const featuresReady = featuresData != null;
  const canWriteEval =
    (role === 'SUPER_ADMIN' || role === 'ADMIN') && evalEnabled;
  const writeDisabledReason = !featuresReady
    ? '功能开关加载中…'
    : !evalEnabled
      ? 'AI 评测未启用，仅可查看历史结果'
      : '只读角色仅可查看结果';

  const { data: datasets, refresh: refreshDatasets } = useRequest(
    aiQualityApi.listDatasets,
  );
  const { data: dataset, refresh: refreshDataset } = useRequest(
    () =>
      selectedId
        ? aiQualityApi.getDataset(selectedId, { page: casesPage })
        : Promise.resolve(null),
    { refreshDeps: [selectedId, casesPage] },
  );
  // 运行中只轮询第一页：倒序后第一页就是最新结果，翻页留给终态运行。
  // 以服务端返回的状态为准，避免「刚启动、状态未回」时把用户翻页带进轮询。
  const runStatusRef = useRef<string | null>(null);
  const { data: run, refresh: refreshRun } = useRequest(
    () =>
      runId
        ? aiQualityApi.getRun(runId, {
            page: runStatusRef.current === 'RUNNING' ? 1 : resultsPage,
          })
        : Promise.resolve(null),
    {
      refreshDeps: [runId, pollRun, resultsPage],
      pollingInterval: pollRun ? 3000 : undefined,
    },
  );
  useEffect(() => {
    setCasesPage(1);
  }, [selectedId]);
  useEffect(() => {
    setResultsPage(1);
  }, [runId]);
  const {
    data: evidence,
    loading: evidenceLoading,
    error: evidenceError,
    refresh: refreshEvidence,
  } = useRequest(
    () =>
      showEvidence && runId
        ? aiQualityApi.getRunEvidence(runId)
        : Promise.resolve(null),
    { refreshDeps: [showEvidence, runId] },
  );
  // 差异只在运行登记了基线时请求；未登记基线不拿别的运行顶替。
  const { data: runDiff } = useRequest(
    () => {
      const current = run as EvalRun | null | undefined;
      return runId && current?.baselineRunId
        ? aiQualityApi.getRunDiff(runId, current.baselineRunId)
        : Promise.resolve(null);
    },
    { refreshDeps: [runId, (run as EvalRun | null | undefined)?.baselineRunId] },
  );
  // 判官校准：运行结束后才读；后端在样本 <20 时结构上不给百分比。
  const { data: calibration } = useRequest(
    () => {
      const current = run as EvalRun | null | undefined;
      return runId && current?.status === 'COMPLETED'
        ? aiQualityApi.getRunCalibration(runId)
        : Promise.resolve(null);
    },
    { refreshDeps: [runId, (run as EvalRun | null | undefined)?.status] },
  );
  // 只渲染真正的校准结果：老后端/异常返回没有 status 时不猜测、不崩。
  const calibrationCard =
    calibration &&
    (calibration.status === 'ok' ||
      calibration.status === 'insufficientSample')
      ? calibration
      : null;
  const loadCaseHistory = async (caseId: string) => {
    setHistoryError('');
    setHistory(null);
    if (!runId) {
      setHistoryError('缺少运行 ID，无法加载时间线');
      return;
    }
    setHistoryLoading(true);
    try {
      const data = await aiQualityApi.getCaseHistory(runId, caseId);
      setHistory({ caseId, data });
    } catch (err: any) {
      setHistoryError(err?.message ?? '时间线加载失败');
    } finally {
      setHistoryLoading(false);
    }
  };
  const toggleCaseHistory = (caseId: string) => {
    if (historyCaseId === caseId) {
      setHistoryCaseId(null);
      return;
    }
    setHistoryCaseId(caseId);
    void loadCaseHistory(caseId);
  };
  const runStatus = (run as EvalRun | null | undefined)?.status;
  // 运行结束（含取消）后，数据集卡片与“基线”下拉各刷新一次。
  // 用 runId+状态去重：取消路径会先显式刷新，随后的状态变更不能重复刷。
  const lastRunRefreshRef = useRef('');
  const refreshRunDependents = (status: string | null | undefined) => {
    if (!status) return;
    const key = `${runId}:${status}`;
    if (lastRunRefreshRef.current === key) return;
    lastRunRefreshRef.current = key;
    void refreshDataset();
    void refreshDatasets();
  };
  const prevRunStatusRef = useRef<{
    runId: string;
    status: string | null;
  } | null>(null);
  useEffect(() => {
    const status = runStatus ?? null;
    const prev = prevRunStatusRef.current;
    // 只有同一次运行的 RUNNING → 终态才算“刚刚结束”；打开历史终态不算。
    const sameRun = prev?.runId === runId;
    prevRunStatusRef.current = { runId, status };
    runStatusRef.current = status;
    if (sameRun && prev.status === 'RUNNING' && isTerminalRunStatus(status)) {
      refreshRunDependents(status);
    }
    if (isTerminalRunStatus(status)) setPollRun(false);
  }, [runId, runStatus]);
  useEffect(() => {
    setShowEvidence(false);
  }, [runId]);

  const create = async () => {
    if (!name.trim()) return;
    try {
      const created = await aiQualityApi.createDataset({ name: name.trim() });
      setName('');
      await refreshDatasets();
      setSelectedId(created.id);
    } catch (err: any) {
      setMessage(err?.message ?? '创建失败');
    }
  };

  const addCases = async () => {
    if (!selectedId) return;
    try {
      const parsed = JSON.parse(casesJson);
      if (!Array.isArray(parsed)) throw new Error('JSON 必须是数组');
      const result = await aiQualityApi.addCases(selectedId, { cases: parsed });
      const created = result?.created ?? parsed.length;
      const skipped = result?.skipped?.length;
      setMessage(
        skipped
          ? `已添加 ${created} 条用例，跳过 ${skipped} 条重复`
          : `已添加 ${created} 条用例`,
      );
      await refreshDataset();
      await refreshDatasets();
    } catch (err: any) {
      setMessage(err?.message ?? '导入失败');
    }
  };

  const openExpectEditor = (item: any) => {
    const mustMention = caseExpectation(item).mustMention;
    setExpectEdit({
      caseId: item.id,
      text: Array.isArray(mustMention) ? mustMention.join('\n') : '',
    });
  };

  const saveExpect = async (item: any) => {
    if (!selectedId || !expectEdit) return;
    const lines = expectEdit.text
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    if (lines.length === 0) {
      setMessage('判分条件不能为空：至少填写一条必含关键词');
      return;
    }
    if (lines.length > EVAL_INPUT_LIMITS.mustMention) {
      setMessage(`最多 ${EVAL_INPUT_LIMITS.mustMention} 条必含关键词`);
      return;
    }
    if (lines.some((line) => line.length > EVAL_INPUT_LIMITS.mustMentionLength)) {
      setMessage(
        `每条必含关键词最多 ${EVAL_INPUT_LIMITS.mustMentionLength} 字符`,
      );
      return;
    }
    try {
      // 只提交 expect；非文本条件由后端字段级合并保留，expected 只读不改写。
      await aiQualityApi.updateCase(selectedId, item.id, {
        expect: { ...caseExpectation(item), mustMention: lines },
      });
      await refreshDataset();
      setExpectEdit(null);
      setMessage('用例已更新');
    } catch (err: any) {
      setMessage(err?.message ?? '更新失败');
    }
  };

  const removeCase = async (item: any) => {
    if (!selectedId) return;
    if (!window.confirm('删除这条用例？此操作不可撤销。')) return;
    try {
      await aiQualityApi.deleteCase(selectedId, item.id);
      await refreshDataset();
      await refreshDatasets();
      setMessage('用例已删除');
    } catch (err: any) {
      setMessage(err?.message ?? '删除失败');
    }
  };

  const start = async () => {
    // 双击/连点会在第一个请求落地前再发一次；后端有唯一索引兜底，
    // 前端也不该把两次点击都变成请求（第二个必然是 409）。
    if (!selectedId || starting) return;
    const isLive = mode === 'LIVE';
    const confirmText = isLive
      ? '确认启动实时评测？会真实调用 AI 客服与 judge 模型。'
      : '确认启动批量评测？会调用 judge 模型。';
    if (!window.confirm(confirmText)) return;
    setStarting(true);
    try {
      const created = await aiQualityApi.startRun(selectedId, {
        mode,
        ...(baselineRunId ? { baselineRunId } : {}),
      });
      setRunId(created.id);
      setPollRun(true);
      setMessage('已启动，正在轮询结果…');
    } catch (err: any) {
      // 409 = 该数据集已有 RUNNING（另一处/另一个管理员先启动）。
      // axios 原始 message 是英文 "Request failed with status code 409"，不能直接展示。
      if (err?.response?.status === 409) {
        const existingId = err.response.data?.runId;
        if (existingId) setRunId(existingId);
        setMessage('该评测集已有运行中的评测，请等待完成或先取消');
      } else {
        setMessage(err?.message ?? '启动失败');
      }
    } finally {
      setStarting(false);
    }
  };

  const cancel = async () => {
    const current = run as EvalRun | null;
    if (!current || current.status !== 'RUNNING') return;
    if (!window.confirm('确认取消这次评测运行？已判分的用例结果会保留。')) {
      return;
    }
    setCancelling(true);
    try {
      await aiQualityApi.cancelRun(current.id);
      setPollRun(false);
      setMessage('已取消本次运行');
      await refreshRun();
      // 若服务端状态还没翻到 CANCELLED，这里先补一次；状态变更效果按 runId+状态去重。
      refreshRunDependents('CANCELLED');
    } catch (err: any) {
      setMessage(err?.message ?? '取消失败');
    } finally {
      setCancelling(false);
    }
  };

  const ds = dataset as
    | (EvalDataset & { cases: any[]; runs: EvalRun[] })
    | null;
  const runData = run as EvalRun | null;
  const runEvidence = evidence as RunEvidence | null | undefined;
  const list = Array.isArray(datasets) ? (datasets as EvalDataset[]) : [];
  const selectedMeta = list.find((item) => item.id === selectedId);
  const harnessDataset =
    isHarnessDataset(ds) || isHarnessDataset(selectedMeta);
  const lastRun = ds?.runs?.[0];
  const completedRuns = (ds?.runs ?? []).filter(
    (item) => item.status === 'COMPLETED',
  );

  return (
    <section className="space-y-4">
      <KbRegressionCard />
      {featuresReady && !evalEnabled ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
          AI 评测未启用（AI_EVAL_ENABLED=false）。当前只能查看历史结果，不能创建评测集、导入用例或启动运行。
        </div>
      ) : null}
      {featuresReady && evalEnabled && !canWriteEval ? (
        <div className="text-xs text-gray-500">{writeDisabledReason}</div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        {canWriteEval ? (
          <>
            <input
              className="rounded-lg border px-3 py-2 text-sm dark:border-white/10 dark:bg-gray-800"
              placeholder="评测集名称"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <Button onClick={create}>创建评测集</Button>
          </>
        ) : null}
        <select
          aria-label="选择评测集"
          className="rounded-lg border px-3 py-2 text-sm dark:border-white/10 dark:bg-gray-800"
          value={selectedId}
          onChange={(e) => {
            setSelectedId(e.target.value);
            setBaselineRunId('');
            setRunId('');
          }}
        >
          <option value="">选择评测集</option>
          {list.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}（{d._count?.cases ?? '未知'} 条用例）
            </option>
          ))}
        </select>
        {harnessDataset || !canWriteEval ? null : (
          <Button
            size="sm"
            variant="outline"
            aria-expanded={advanced}
            onClick={() => setAdvanced((v) => !v)}
          >
            {advanced ? '收起高级模式' : '高级模式'}
          </Button>
        )}
      </div>
      {message ? (
        <div className="text-sm text-gray-600 dark:text-gray-300">
          {message}
        </div>
      ) : null}

      {selectedId ? (
        <div className="rounded-xl border border-gray-100 bg-white p-4 dark:border-white/10 dark:bg-gray-900">
          <h3 className="text-sm font-semibold">
            {selectedMeta?.name ?? ds?.name ?? '评测集'}
            {harnessDataset ? (
              <span className="ml-2 rounded border border-gray-200 px-1.5 py-0.5 text-xs font-normal text-gray-500 dark:border-white/10">
                harness 数据集 · 只读
              </span>
            ) : null}
          </h3>
          <div className="mt-2 flex flex-wrap gap-6 text-sm">
            <div>
              <div className="text-xs text-gray-500">用例数</div>
              <div className="font-medium">
                {ds?.casesTotal ??
                  ds?._count?.cases ??
                  selectedMeta?._count?.cases ??
                  ds?.cases?.length ??
                  0}
              </div>
            </div>
            <div>
              <div className="text-xs text-gray-500">运行次数</div>
              <div className="font-medium">
                {ds?._count?.runs ??
                  ds?.runs?.length ??
                  selectedMeta?._count?.runs ??
                  0}
              </div>
            </div>
            <div>
              <div className="text-xs text-gray-500">
                {lastRun
                  ? `最近一次${evalHeadline(lastRun).label}`
                  : '最近一次通过率'}
              </div>
              <div className="font-medium">
                {lastRun
                  ? `${evalRateText(lastRun)}（${
                      labelOf(RUN_STATUS_LABELS, lastRun.status) || '-'
                    }）`
                  : '-'}
              </div>
            </div>
          </div>
          {(ds?.runs ?? []).length > 0 ? (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-gray-500">
              <span>最近运行</span>
              {(ds?.runs ?? []).slice(0, 5).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={
                    runId === item.id
                      ? 'rounded border border-primary-500 px-1.5 py-0.5 text-primary-600 dark:border-primary-400 dark:text-primary-300'
                      : 'rounded border px-1.5 py-0.5 hover:border-primary-400 dark:border-white/10'
                  }
                  onClick={() => {
                    setRunId(item.id);
                    setPollRun(false);
                  }}
                >
                  <span className="font-mono">{item.id.slice(0, 8)}</span> ·{' '}
                  {labelOf(RUN_STATUS_LABELS, item.status) || item.status} ·{' '}
                  {evalRateText(item)}
                </button>
              ))}
            </div>
          ) : null}
          {harnessDataset ? (
            <div className="mt-3 rounded-lg border border-gray-100 bg-gray-50 p-3 text-xs text-gray-600 dark:border-white/10 dark:bg-gray-800 dark:text-gray-300">
              该数据集由 harness 生成，只读。回归验证请在仓库根目录执行子集命令，或走 CI。
            </div>
          ) : (
            <div className="mt-3 flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 text-xs text-gray-500">
              评测模式
              <select
                aria-label="评测模式"
                className="rounded-lg border px-3 py-2 text-sm text-gray-900 dark:border-white/10 dark:bg-gray-800 dark:text-gray-100"
                value={mode}
                onChange={(e) =>
                  setMode(e.target.value === 'LIVE' ? 'LIVE' : 'STORED')
                }
              >
                <option value="STORED">历史回答</option>
                <option value="LIVE">实时跑 AI</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-gray-500">
              对比基线（可选）
              <select
                aria-label="对比基线"
                className="rounded-lg border px-3 py-2 text-sm text-gray-900 dark:border-white/10 dark:bg-gray-800 dark:text-gray-100"
                value={baselineRunId}
                onChange={(e) => setBaselineRunId(e.target.value)}
              >
                <option value="">不对比基线</option>
                {completedRuns.map((item) => (
                  <option key={item.id} value={item.id}>
                    {/* 按族读数字：EXTERNAL 是准确率，内部是通过率，不能互相顶替。 */}
                    {item.id.slice(0, 8)} · {evalRateText(item)}（
                    {item.mode === 'EXTERNAL' ? '准确率' : '通过率'}）
                  </option>
                ))}
              </select>
            </label>
            {canWriteEval ? (
              <Button size="sm" onClick={start} disabled={starting}>
                {starting ? '启动中…' : '启动批量评测'}
              </Button>
            ) : null}
            </div>
          )}
        </div>
      ) : null}

      {selectedId && advanced && !harnessDataset && canWriteEval ? (
        <div className="rounded-xl border border-gray-100 bg-white p-4 dark:border-white/10 dark:bg-gray-900">
          <h3 className="mb-2 text-sm font-semibold">
            高级模式：导入用例（JSON 数组）
          </h3>
          <textarea
            aria-label="评测用例 JSON"
            className="h-40 w-full rounded-lg border p-2 font-mono text-xs dark:border-white/10 dark:bg-gray-800"
            value={casesJson}
            onChange={(e) => setCasesJson(e.target.value)}
          />
          <div className="mt-2 flex gap-2">
            <Button size="sm" onClick={addCases}>
              导入用例
            </Button>
          </div>
          <p className="mt-2 text-xs text-gray-500">
            每条格式：
            {`{"question":"...","answer":"...","expect":{"mustMention":["..."]}}`}
          </p>
        </div>
      ) : null}

      {selectedId && ds ? (
        <div className="rounded-xl border border-gray-100 bg-white p-4 dark:border-white/10 dark:bg-gray-900">
          <h3 className="mb-2 text-sm font-semibold">
            用例（{knownCasesTotal(ds) ?? '未知'}）
          </h3>
          <div className="max-h-52 space-y-2 overflow-y-auto text-xs">
            {knownCasesTotal(ds) === 0 ? (
              <div className="text-gray-400">
                暂无用例，可在高级模式中导入。
              </div>
            ) : (
              (ds.cases ?? []).map((c: any) => (
                <div
                  key={c.id}
                  className="rounded-lg border p-2 dark:border-white/10"
                >
                  <div className="font-medium">{c.question}</div>
                  <div className="text-gray-500">{c.answer}</div>
                  <div className="mt-1 text-gray-500">
                    判分条件（expect）：
                    {expectationText(c) || '未填写'}
                    {c.source === 'feedback' ? ' · 来源：反馈' : ''}
                  </div>
                  {expectationConditions(c).length > 0 ? (
                    <div className="mt-1 text-gray-500">
                      {expectationConditions(c).join(' · ')}
                    </div>
                  ) : null}
                  {c.expected != null ? (
                    <div className="mt-1 text-gray-400">
                      兼容字段 expected（只读）：{expectedText(c)}
                    </div>
                  ) : null}
                  {expectEdit && expectEdit.caseId === c.id ? (
                    <div className="mt-2 space-y-1">
                      <textarea
                        aria-label="必含关键词"
                        className="h-24 w-full rounded-lg border p-2 text-xs dark:border-white/10 dark:bg-gray-800"
                        maxLength={
                          EVAL_INPUT_LIMITS.mustMention *
                          (EVAL_INPUT_LIMITS.mustMentionLength + 1)
                        }
                        value={expectEdit.text}
                        onChange={(e) =>
                          setExpectEdit({
                            caseId: c.id,
                            text: e.target.value,
                          })
                        }
                      />
                      <div className="text-gray-500">
                        每行一条，最多 {EVAL_INPUT_LIMITS.mustMention} 条、每条{' '}
                        {EVAL_INPUT_LIMITS.mustMentionLength} 字符
                      </div>
                      <div className="flex gap-2">
                        <Button size="sm" onClick={() => void saveExpect(c)}>
                          保存判分条件
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setExpectEdit(null)}
                        >
                          取消
                        </Button>
                      </div>
                    </div>
                  ) : null}
                  {canWriteEval && !harnessDataset ? (
                    <div className="mt-1 flex gap-2">
                      <button
                        type="button"
                        className="text-primary-600 hover:underline"
                        onClick={() => openExpectEditor(c)}
                      >
                        编辑期望
                      </button>
                      <button
                        type="button"
                        className="text-red-600 hover:underline"
                        onClick={() => void removeCase(c)}
                      >
                        删除
                      </button>
                    </div>
                  ) : null}
                </div>
              ))
            )}
          </div>
          <ResultPager
            page={casesPage}
            total={knownCasesTotal(ds)}
            onChange={setCasesPage}
          />
        </div>
      ) : null}

      {runData ? (
        <div className="rounded-xl border border-gray-100 bg-white p-4 dark:border-white/10 dark:bg-gray-900">
          <div className="flex flex-wrap items-center gap-3">
            <h3 className="text-sm font-semibold">评测运行</h3>
            <span className="rounded-lg border px-2 py-0.5 text-xs dark:border-white/10">
              {labelOf(RUN_STATUS_LABELS, runData.status)}
            </span>
            <span className="rounded-lg border px-2 py-0.5 text-xs dark:border-white/10">
              模式：
              {runData.mode === 'LIVE'
                ? '实时跑 AI'
                : runData.mode === 'EXTERNAL'
                  ? '外部 harness'
                  : '历史回答'}
            </span>
            <span className="text-xs text-gray-500">
              {(() => {
                const headline = evalHeadline(runData);
                return `${headline.label} ${headline.value}`;
              })()}
            </span>
            {runData.mode !== 'EXTERNAL' &&
            typeof runData.summary?.validPassRate === 'number' ? (
              <span className="text-xs text-gray-500">
                有效通过率 {formatRate(runData.summary.validPassRate)}
                （只按已判定条目算）
              </span>
            ) : null}
            {runData.mode !== 'EXTERNAL' &&
            runData.summary?.total != null ? (
              <span className="text-xs text-gray-500">
                已判定 {runData.summary.judged ?? '未记录'}
              </span>
            ) : null}
            {typeof runData.summary?.judgeErrorRate === 'number' ? (
              <span className="text-xs text-gray-500">
                判官失败率 {formatRate(runData.summary.judgeErrorRate)}
              </span>
            ) : null}
            {judgeKindEntries(runData.summary?.judgeErrorKinds).length > 0 ? (
              <span className="text-xs text-gray-500">
                判官失败类型{' '}
                {judgeKindEntries(runData.summary?.judgeErrorKinds)
                  .map((item) => `${item.kind} ${item.count}`)
                  .join(' · ')}
              </span>
            ) : null}
            <span className="text-xs text-gray-500">
              运行 ID：{runData.id}
            </span>
            <span className="text-xs text-gray-500">
              运行范围：
              {runData.scope === 'full'
                ? '全量'
                : runData.scope === 'subset'
                  ? '受影响子集'
                  : '未记录'}
            </span>
            <span className="text-xs text-gray-500">
              指标族：{runData.metricFamily ?? '未记录'}
            </span>
            <span className="text-xs text-gray-500">
              已处理 {runData.summary?.processed ?? '未记录'} / 共{' '}
              {runData.summary?.total ?? '未记录'}
            </span>
            <span className="text-xs text-gray-500">
              失败类别：{runData.summary?.failureCategory ?? '未记录'}
            </span>
            {runData.executionErrorKind ? (
              <span className="text-xs text-gray-500">
                执行错误：{labeledCode(EXECUTION_ERROR_LABELS, runData.executionErrorKind)}
              </span>
            ) : null}
            {runData.mode !== 'EXTERNAL' &&
            typeof runData.judgeSampleCount === 'number' ? (
              <span className="text-xs text-gray-500">
                判官采样 {runData.judgeSampleCount} 次/条
              </span>
            ) : null}
            {runData.status === 'RUNNING' && canWriteEval ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => void cancel()}
                disabled={cancelling}
              >
                {cancelling ? '取消中…' : '取消运行'}
              </Button>
            ) : null}
            {runData.status !== 'RUNNING' ? (
              <Button
                size="sm"
                variant="outline"
                aria-expanded={showEvidence}
                onClick={() => {
                  if (showEvidence) {
                    setShowEvidence(false);
                  } else {
                    setShowEvidence(true);
                  }
                }}
              >
                {showEvidence ? '收起发布证据' : '查看发布证据'}
              </Button>
            ) : null}
            {runData.summary?.total != null ? (
              runData.mode === 'EXTERNAL' ? (
                <span className="text-xs text-gray-500">
                  共 {runData.summary.total} 条 · 正确{' '}
                  {runData.summary.correct ?? '未记录'} · 错误{' '}
                  {runData.summary.incorrect ?? '未记录'} · 判官失败{' '}
                  {runData.summary.judgeError ?? '未记录'}
                </span>
              ) : (
                <span className="text-xs text-gray-500">
                  共 {runData.summary.total} 条 · 解决{' '}
                  {runData.summary.solved ?? '未记录'} · 部分{' '}
                  {runData.summary.partial ?? '未记录'} · 未解决{' '}
                  {runData.summary.unsolved ?? '未记录'}
                </span>
              )
            ) : null}
            {typeof runData.summary?.baselinePassRate === 'number' ? (
              <span className="text-xs text-gray-500">
                基线{' '}
                {formatPassRate({
                  passRate: runData.summary.baselinePassRate,
                })}{' '}
                · 变化 {formatDelta(runData.summary.delta)} · 新增失败{' '}
                {runData.summary.newFailures ?? '未记录'} · 修复{' '}
                {runData.summary.fixed ?? '未记录'}
              </span>
            ) : null}
            {typeof runData.summary?.baselineAccuracy === 'number' ? (
              <span className="text-xs text-gray-500">
                基线准确率 {formatRate(runData.summary.baselineAccuracy)} · 变化{' '}
                {formatDelta(runData.summary.delta)} · 新增错误{' '}
                {runData.summary.newFailures ?? '未记录'} · 修复{' '}
                {runData.summary.fixed ?? '未记录'}
              </span>
            ) : null}
          </div>
          {runData.baselineRunId && runDiff ? (
            <div className="mt-3 rounded-lg border p-3 dark:border-white/10">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-semibold">与基线差异</span>
                <span className="text-xs text-gray-500">
                  基线运行{' '}
                  <span className="font-mono">
                    {runDiff.baselineRunId.slice(0, 8)}
                  </span>{' '}
                  · 指标族 {runDiff.metricFamily}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap gap-3 text-xs">
                {(
                  ['newFailure', 'fixed', 'regressed', 'stillFailing'] as const
                ).map((klass) => (
                  <span key={klass} data-testid={`diff-${klass}`}>
                    {DIFF_CLASS_LABELS[klass]} {runDiff.counts[klass]}
                  </span>
                ))}
              </div>
              <div className="mt-1 text-xs text-gray-500">
                可比对 {runDiff.comparability.compared} 条 · 判官未判定{' '}
                {runDiff.comparability.undecided} 条 · 基线缺少{' '}
                {runDiff.comparability.missingBaseline} 条
              </div>
              <div className="mt-1 text-xs text-gray-400">{runDiff.note}</div>
            </div>
          ) : null}
          {calibrationCard ? (
            <div
              data-testid="run-calibration"
              className="mt-3 rounded-lg border p-3 dark:border-white/10"
            >
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-semibold">判官校准</span>
                <span className="text-xs text-gray-500">
                  可比对人工标注 {calibrationCard.n} 条
                  {calibrationCard.status === 'ok'
                    ? ` · 一致率 ${calibrationCard.agreementRate}%`
                    : ''}
                </span>
                {calibrationCard.status === 'insufficientSample' ? (
                  <span className="rounded border border-amber-300 px-2 py-0.5 text-xs text-amber-700 dark:border-amber-500/30 dark:text-amber-300">
                    样本不足（需 ≥{calibrationCard.threshold} 条），不下结论
                  </span>
                ) : null}
                {calibrationCard.excluded > 0 ? (
                  <span className="text-xs text-gray-500">
                    未纳入比对 {calibrationCard.excluded} 条
                  </span>
                ) : null}
              </div>
              {calibrationCard.disagreements.length > 0 ? (
                <ul className="mt-2 space-y-1 text-xs text-gray-600 dark:text-gray-300">
                  {calibrationCard.disagreements.map((item) => (
                    <li key={`${item.caseId}-${item.labelerId}`}>
                      用例 <span className="font-mono">{item.caseId}</span>
                      ：判官{' '}
                      {RESULT_VERDICT_LABELS[item.judgeVerdict] ??
                        item.judgeVerdict}{' '}
                      / 人工{' '}
                      {RESULT_VERDICT_LABELS[item.humanCorrectness] ??
                        item.humanCorrectness}
                      {item.judgeReason ? ` · 判官理由：${item.judgeReason}` : ''}
                      {item.humanComment ? ` · 人工备注：${item.humanComment}` : ''}
                    </li>
                  ))}
                </ul>
              ) : null}
              <div className="mt-1 text-xs text-gray-400">
                {calibrationCard.note}
              </div>
            </div>
          ) : null}
          {runData.summary?.error ? (
            <div className="mt-2 text-xs text-red-600 dark:text-red-300">
              失败原因：{runData.summary.error}
            </div>
          ) : null}
          {runData.summary?.cancelled ? (
            <div className="mt-2 text-xs text-amber-600 dark:text-amber-300">
              本次运行已取消，未处理剩余用例。
            </div>
          ) : null}
          {showEvidence ? (
            <div className="mt-3 rounded-lg border p-3 dark:border-white/10">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-semibold">发布证据</span>
                {evidenceLoading ? (
                  <span className="text-xs text-gray-500">校验中…</span>
                ) : null}
                {evidenceError ? (
                  <Button size="sm" variant="outline" onClick={refreshEvidence}>
                    重试
                  </Button>
                ) : null}
                {runEvidence ? (
                  <span
                    className={
                      runEvidence.ok
                        ? 'rounded border border-emerald-200 px-2 py-0.5 text-xs text-emerald-700 dark:border-emerald-500/30 dark:text-emerald-300'
                        : 'rounded border border-red-200 px-2 py-0.5 text-xs text-red-700 dark:border-red-500/30 dark:text-red-300'
                    }
                  >
                    {runEvidence.ok
                      ? '证据通过，可用于发布'
                      : '证据不通过，不能用于发布'}
                  </span>
                ) : null}
              </div>
              {evidenceError ? (
                <div className="mt-2 text-xs text-red-600 dark:text-red-300">
                  证据校验失败，请重试。
                </div>
              ) : null}
              {runEvidence ? (
                <div className="mt-2 space-y-1 text-xs">
                  <div className="text-gray-500">
                    运行{' '}
                    <span className="font-mono">
                      {runEvidence.runId.slice(0, 8)}
                    </span>{' '}
                    · 代码版本 {runEvidence.codeVersion ?? '缺失'} · 语料指纹{' '}
                    {runEvidence.knowledgeFingerprint
                      ? runEvidence.knowledgeFingerprint.slice(0, 12)
                      : '缺失'}
                  </div>
                  {runEvidence.checks.map((check) => (
                    <div
                      key={check.id}
                      className="flex items-start gap-2 rounded border p-2 dark:border-white/10"
                    >
                      <span
                        className={
                          check.ok
                            ? 'text-emerald-600 dark:text-emerald-300'
                            : 'text-red-600 dark:text-red-300'
                        }
                      >
                        {check.ok ? '✓' : '✗'}
                      </span>
                      <div>
                        <div className="font-medium">
                          {EVIDENCE_CHECK_LABELS[check.id] ?? check.id}
                        </div>
                        <div className="text-gray-500">
                          {check.ok ? '通过' : check.message}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
          <div className="mt-3 space-y-2 text-xs">
            {(runData.results ?? []).length === 0 ? (
              <div className="text-gray-400">
                {runData.status === 'RUNNING'
                  ? '运行中，暂无结果…'
                  : '暂无结果。'}
              </div>
            ) : (
              (runData.results ?? []).map((r) => {
                // EXTERNAL run 只有答案判定；内部 run 只有任务判定。两者不混算。
                const verdictLabels = r.answerVerdict
                  ? ANSWER_VERDICT_LABELS
                  : RESULT_VERDICT_LABELS;
                const verdict = r.answerVerdict ?? r.verdict;
                const score = r.answerScore ?? r.score;
                const judgeErrorKind = (r as any).judgeErrorKind as
                  | string
                  | undefined;
                const grounding = (r as any).grounding as string | undefined;
                return (
                  <div
                    key={r.id}
                    className="rounded-lg border p-2 dark:border-white/10"
                  >
                    <div className="font-medium">
                      {labelOf(verdictLabels, verdict)} · 分数 {score ?? '-'} ·{' '}
                      {r.latencyMs ?? '-'}ms
                      {judgeErrorKind ? ` · 判官错误：${judgeErrorKind}` : ''}
                    </div>
                    <div>{r.case?.question}</div>
                    {r.actualAnswer ? (
                      <div className="text-gray-500">
                        实际回答：{r.actualAnswer}
                      </div>
                    ) : null}
                    {grounding ? (
                      <div className="text-gray-500">依据分型：{grounding}</div>
                    ) : runData.mode === 'EXTERNAL' ? (
                      <div className="text-gray-500">依据分型：未检查</div>
                    ) : null}
                    <div className="text-gray-500">{r.reason}</div>
                    {r.case?.id && runData.status !== 'RUNNING' ? (
                      <div className="mt-1">
                        <Button
                          size="sm"
                          variant="outline"
                          aria-expanded={historyCaseId === r.case.id}
                          onClick={() => toggleCaseHistory(r.case.id)}
                        >
                          {historyCaseId === r.case.id ? '收起历史' : '查看历史'}
                        </Button>
                        {historyCaseId === r.case.id ? (
                          <div className="mt-2 rounded border-l-2 border-gray-200 pl-2 dark:border-white/10">
                            {historyLoading ? (
                              <div className="text-gray-500">加载时间线…</div>
                            ) : null}
                            {historyError ? (
                              <div className="text-red-600 dark:text-red-300">
                                {historyError}{' '}
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => void loadCaseHistory(r.case.id)}
                                >
                                  重试
                                </Button>
                              </div>
                            ) : null}
                            {history?.caseId === r.case.id ? (
                              history.data.timeline.length === 0 ? (
                                <div className="text-gray-400">
                                  该用例还没有运行记录。
                                </div>
                              ) : (
                                <ol className="space-y-1">
                                  {history.data.timeline.map((point) => (
                                    <li key={point.runId}>
                                      <span className="font-mono">
                                        {point.runId.slice(0, 8)}
                                      </span>{' '}
                                      ·{' '}
                                      {new Date(
                                        point.startedAt,
                                      ).toLocaleString()}{' '}
                                      ·{' '}
                                      {labelOf(
                                        RUN_STATUS_LABELS,
                                        point.status,
                                      ) || point.status}
                                      {point.isBaseline ? ' · 基线' : ''} ·{' '}
                                      <span
                                        data-testid={`history-outcome-${point.runId}`}
                                        className={
                                          point.outcome === 'pass'
                                            ? 'text-emerald-600 dark:text-emerald-300'
                                            : point.outcome === 'fail'
                                              ? 'text-red-600 dark:text-red-300'
                                              : 'text-gray-500'
                                        }
                                      >
                                        {CASE_OUTCOME_LABELS[point.outcome] ??
                                          point.outcome}
                                      </span>
                                      {point.judgeErrorKind
                                        ? ` · 判官错误：${point.judgeErrorKind}`
                                        : ''}
                                    </li>
                                  ))}
                                </ol>
                              )
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                );
              })
            )}
          </div>
          {runData.status !== 'RUNNING' ? (
            <ResultPager
              page={resultsPage}
              total={
                typeof runData.resultsTotal === 'number'
                  ? runData.resultsTotal
                  : runData.results?.length
              }
              onChange={setResultsPage}
            />
          ) : null}
          <details className="mt-3">
            <summary className="cursor-pointer text-xs text-gray-500">
              原始输出（工程师）
            </summary>
            <pre className="mt-2 max-h-60 overflow-auto rounded-lg bg-gray-50 p-2 text-xs dark:bg-gray-800">
              {JSON.stringify(runData, null, 2)}
            </pre>
          </details>
        </div>
      ) : null}
    </section>
  );
}

/**
 * 新旧分块并排对比：旧版本在保留期内仍可读，按 chunkIndex 对齐。
 * 只做诊断，不判断内容对错；业务事实仍由人工抽检确认。
 */
function ChunkVersionDiff({
  documentId,
  title,
  onClose,
}: {
  documentId: string;
  title: string;
  onClose: () => void;
}) {
  const { data, loading, error, refresh } = useRequest(
    () => knowledgeApi.getChunksDiff(documentId),
    { refreshDeps: [documentId] },
  );

  // 差异由服务端按两版本 chunkIndex 并集计算；页面只负责展示。
  const diff = data as DocumentChunkDiff | undefined;
  const changes = diff?.changes ?? [];
  const hasTwoVersions =
    diff?.currentVersion != null && diff?.previousVersion != null;
  const changeLabels: Record<DocumentChunkDiffEntry['change'], string> = {
    added: '新增',
    removed: '删除',
    modified: '变化',
    unchanged: '相同',
  };

  return (
    <div className="rounded-xl border border-gray-100 bg-white p-4 dark:border-white/10 dark:bg-gray-900">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold">新旧分块 · {title}</h3>
        <Button size="sm" variant="outline" onClick={onClose}>
          关闭
        </Button>
      </div>

      {error ? (
        <div className="mt-2">
          <AiErrorBanner message="分块加载失败，请重试" onRetry={refresh} />
        </div>
      ) : loading ? (
        <div className="mt-2 text-xs text-gray-500">加载中…</div>
      ) : !hasTwoVersions ? (
        <div className="mt-2 text-xs text-gray-500">
          当前只保留一个版本，暂无可对比的旧版本。旧分块只在更新后的 7
          天保留期内可读。
        </div>
      ) : (
        <>
          <div className="mt-2 text-xs text-gray-500">
            旧版本 v{diff!.previousVersion} → 当前版本 v{diff!.currentVersion} ·
            新增 {diff!.summary.added} · 删除 {diff!.summary.removed} · 修改{' '}
            {diff!.summary.modified}
          </div>
          <div className="mt-2 space-y-2">
            {changes.map((row) => (
              <div
                key={row.chunkIndex}
                className="rounded-lg border p-2 text-xs dark:border-white/10"
              >
                <div className="mb-1 flex items-center gap-2 text-gray-500">
                  <span>分块 {row.chunkIndex}</span>
                  <span className="rounded border px-1 py-0.5 dark:border-white/10">
                    {changeLabels[row.change]}
                  </span>
                </div>
                <div className="grid gap-2 md:grid-cols-2">
                  <div>
                    <div className="mb-1 text-gray-400">旧版本</div>
                    <div className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words rounded bg-red-50/60 p-2 dark:bg-red-500/5">
                      {row.previous?.content ?? '（该版本没有这个分块）'}
                    </div>
                  </div>
                  <div>
                    <div className="mb-1 text-gray-400">当前版本</div>
                    <div className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words rounded bg-emerald-50/60 p-2 dark:bg-emerald-500/5">
                      {row.current?.content ?? '（该版本没有这个分块）'}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function RagPanel() {
  const [query, setQuery] = useState('');
  const [domain, setDomain] = useState('');
  const [result, setResult] = useState<any>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [diffDoc, setDiffDoc] = useState<{
    id: string;
    title: string;
  } | null>(null);
  const {
    data: stats,
    loading: statsLoading,
    error: statsError,
    refresh: refreshStats,
  } = useRequest(() => knowledgeApi.qualityStats());

  const search = async () => {
    if (!query.trim()) return;
    setSearchLoading(true);
    setSearchError('');
    setResult(null);
    try {
      setResult(
        await aiQualityApi.ragSearch({
          query: query.trim(),
          ...(domain ? { domain } : {}),
          topK: 5,
          debug: true,
        }),
      );
    } catch (err: any) {
      setSearchError(err?.message ?? '检索失败，请重试');
    } finally {
      setSearchLoading(false);
    }
  };

  const byScore = stats?.byScore;
  const parseQuality = stats?.parseQuality;
  const cards = [
    ['文档总数', stats?.total],
    ['有标记', stats?.flagged],
    ['待复核', stats?.needReview],
    ['优秀', byScore?.excellent],
    ['良好', byScore?.good],
    ['一般', byScore?.fair],
    ['可疑', byScore?.suspicious],
  ] as const;
  // 解析质量与有效性单独一组：解析只统计有明细快照的文档，
  // 有效性还没有采集链路——两者都不能混进上面的评分分档。
  const parseCards = [
    ['解析通过', parseQuality?.passed],
    ['解析未通过', parseQuality?.failed],
    ['解析未采集', parseQuality?.notCollected],
  ] as const;
  const recentFlags = stats?.recentFlags ?? [];
  const recentUpdated = stats?.recentUpdated ?? [];
  const results: any[] = result?.results ?? [];
  const debug = result?.debug as
    | {
        rerank?: boolean;
        relevanceGate?: {
          applied: boolean;
          blocked: number | boolean;
          reason?: string;
        } | null;
      }
    | undefined;
  // blocked 是被拦掉的候选数（与 stage 日志同口径），>0 才算拦截。
  const gateLabel = !debug?.relevanceGate
    ? '未启用'
    : !debug.relevanceGate.applied
      ? '未启用'
      : debug.relevanceGate.blocked
        ? '拦截'
        : '通过';

  return (
    <section className="space-y-4">
      {statsError ? (
        <AiErrorBanner
          message="知识质量统计加载失败，请重试"
          onRetry={refreshStats}
        />
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {parseCards.map(([label, value]) => (
          <div
            key={label}
            className="rounded-xl border p-3 dark:border-white/10"
          >
            <div className="text-xs text-gray-500">{label}</div>
            <div className="text-lg font-semibold">
              {value != null ? value : statsLoading ? '加载中…' : '—'}
            </div>
          </div>
        ))}
        <div className="rounded-xl border p-3 dark:border-white/10">
          <div className="text-xs text-gray-500">有效性</div>
          <div className="text-lg font-semibold">
            {stats ? '未采集' : statsLoading ? '加载中…' : '—'}
          </div>
        </div>
      </div>

      {stats?.effectiveness ? (
        <p className="text-xs text-gray-500">有效性口径：{stats.effectiveness.note}</p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-7">
        {cards.map(([label, value]) => (
          <div
            key={label}
            className="rounded-xl border p-3 dark:border-white/10"
          >
            <div className="text-xs text-gray-500">{label}</div>
            <div className="text-lg font-semibold">
              {value != null ? value : statsLoading ? '加载中…' : '—'}
            </div>
          </div>
        ))}
      </div>

      {!statsLoading && !statsError && stats?.total === 0 ? (
        <div className="rounded-xl border border-dashed p-6 text-center text-sm text-gray-400 dark:border-white/10">
          暂无知识库文档质量数据。
        </div>
      ) : null}

      <div className="rounded-xl border border-gray-100 dark:border-white/10">
        <div className="border-b px-4 py-2 text-sm font-semibold dark:border-white/10">
          最近更新文档
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-left dark:bg-white/5">
              <tr>
                {[
                  '文档',
                  '评分',
                  '标记',
                  '解析检查',
                  '版本',
                  '更新时间',
                  '操作',
                ].map((h) => (
                  <th key={h} className="px-3 py-2">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {statsLoading ? (
                <tr>
                  <td
                    colSpan={7}
                    className="px-3 py-6 text-center text-gray-400"
                  >
                    加载中…
                  </td>
                </tr>
              ) : recentUpdated.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="px-3 py-6 text-center text-gray-400"
                  >
                    暂无更新记录
                  </td>
                </tr>
              ) : (
                recentUpdated.map((doc) => (
                  <tr
                    key={`${doc.documentId}-${doc.version}`}
                    className="border-t border-gray-100 dark:border-white/5"
                  >
                    <td className="px-3 py-2" title={doc.documentId}>
                      {doc.title}
                    </td>
                    <td className="px-3 py-2">{doc.score ?? '-'}</td>
                    <td className="px-3 py-2 text-gray-600 dark:text-gray-300">
                      {doc.flags ?? '无标记'}
                    </td>
                    <td className="px-3 py-2">
                      {doc.parseChecks ? (
                        <div className="flex flex-wrap gap-1">
                          {Object.entries(PARSE_CHECK_LABELS).map(
                            ([key, label]) => {
                              const entry = (
                                doc.parseChecks as Record<
                                  string,
                                  { passed: boolean; detail?: string }
                                >
                              )[key];
                              return (
                                <span
                                  key={key}
                                  data-testid={`parse-check-${key}`}
                                  title={entry?.detail}
                                  className={
                                    entry?.passed
                                      ? 'rounded border border-emerald-200 px-1 text-xs text-emerald-700 dark:border-emerald-500/30 dark:text-emerald-300'
                                      : 'rounded border border-red-200 px-1 text-xs text-red-700 dark:border-red-500/30 dark:text-red-300'
                                  }
                                >
                                  {label}
                                  {entry?.passed ? '通过' : '未通过'}
                                </span>
                              );
                            },
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-gray-400">未采集</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-600 dark:text-gray-300">
                      生效 v{doc.activeVersion} · 最新 v{doc.version}
                    </td>
                    <td className="px-3 py-2">
                      {doc.updatedAt
                        ? new Date(doc.updatedAt).toLocaleString()
                        : '-'}
                    </td>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        className="text-primary-600 hover:underline"
                        onClick={() =>
                          setDiffDoc({ id: doc.documentId, title: doc.title })
                        }
                      >
                        新旧分块
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-xl border border-gray-100 dark:border-white/10">
        <div className="border-b px-4 py-2 text-sm font-semibold dark:border-white/10">
          最近标记文档
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-left dark:bg-white/5">
              <tr>
                {['文档', '评分', '标记', '上传时间', '操作'].map((h) => (
                  <th key={h} className="px-3 py-2">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {statsLoading ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-3 py-6 text-center text-gray-400"
                  >
                    加载中…
                  </td>
                </tr>
              ) : recentFlags.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-3 py-6 text-center text-gray-400"
                  >
                    暂无标记文档
                  </td>
                </tr>
              ) : (
                recentFlags.map((flag) => (
                  <tr
                    key={`${flag.documentId}-${flag.parsedAt}`}
                    className="border-t border-gray-100 dark:border-white/5"
                  >
                    <td className="px-3 py-2" title={flag.documentId}>
                      {flag.title}
                    </td>
                    <td className="px-3 py-2">{flag.score ?? '-'}</td>
                    <td className="px-3 py-2 text-gray-600 dark:text-gray-300">
                      {flag.flags ?? '-'}
                    </td>
                    <td className="px-3 py-2">
                      {flag.parsedAt
                        ? new Date(flag.parsedAt).toLocaleString()
                        : '-'}
                    </td>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        className="text-primary-600 hover:underline"
                        onClick={() =>
                          setDiffDoc({ id: flag.documentId, title: flag.title })
                        }
                      >
                        新旧分块
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {diffDoc ? (
        <ChunkVersionDiff
          documentId={diffDoc.id}
          title={diffDoc.title}
          onClose={() => setDiffDoc(null)}
        />
      ) : null}

      <div className="flex flex-wrap gap-2">
        <input
          className="min-w-[280px] rounded-lg border px-3 py-2 text-sm dark:border-white/10 dark:bg-gray-800"
          placeholder="检索问题"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <input
          className="rounded-lg border px-3 py-2 text-sm dark:border-white/10 dark:bg-gray-800"
          placeholder="domain（可选）"
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
        />
        <Button onClick={search} disabled={searchLoading}>
          {searchLoading ? '检索中…' : '检索'}
        </Button>
      </div>

      {searchError ? (
        <AiErrorBanner message={searchError} onRetry={search} />
      ) : null}

      {searchLoading ? (
        <div className="rounded-xl border border-dashed p-6 text-center text-sm text-gray-400 dark:border-white/10">
          检索中…
        </div>
      ) : result ? (
        <div className="space-y-3">
          {debug ? (
            <div className="text-xs text-gray-500">
              {`检索调试——rerank：${debug.rerank ? '开' : '关'} · 相关性门卫：${gateLabel}`}
            </div>
          ) : null}
          {results.length === 0 ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-4 text-sm dark:border-amber-500/30 dark:bg-amber-500/5">
              <div className="font-medium text-amber-800 dark:text-amber-200">
                没有检索到相关文档
              </div>
              <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
                按顺序检查下面几项，通常能定位到原因：
              </p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-gray-600 dark:text-gray-300">
                <li>文档缺失：知识库里还没有这个主题的文档，先上传或补充。</li>
                <li>
                  文档未启用：确认文档已发布；草稿、停用或解析失败的文档不会参与检索。
                </li>
                <li>
                  领域不匹配：确认文档所属领域与检索时填写的 domain 一致。
                </li>
                <li>
                  问题过窄或口语化：换一种更标准的问法，或给文档补同义词和常见问法。
                </li>
              </ul>
              <Link
                href="/knowledge"
                className="mt-3 inline-block text-xs text-blue-600 hover:underline dark:text-blue-400"
              >
                去知识库检查/补充文档
              </Link>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-gray-100 dark:border-white/10">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 text-left dark:bg-white/5">
                  <tr>
                    {['标题', '分数', '摘要', '领域'].map((h) => (
                      <th key={h} className="px-3 py-2">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {results.map((row, index) => (
                    <tr
                      key={row.chunkId ?? row.documentId ?? index}
                      className="border-t border-gray-100 dark:border-white/5"
                    >
                      <td className="px-3 py-2">{row.title ?? '-'}</td>
                      <td className="px-3 py-2">
                        {typeof row.score === 'number'
                          ? row.score.toFixed(4)
                          : '-'}
                      </td>
                      <td
                        className="max-w-[420px] truncate px-3 py-2 text-gray-600 dark:text-gray-300"
                        title={row.contentPreview ?? ''}
                      >
                        {row.contentPreview ?? '-'}
                      </td>
                      <td className="px-3 py-2">{row.domain ?? '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}
