'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useRequest } from 'ahooks';
import { Button } from '@repo/ui';
import { aiOpsApi, aiQualityApi, chatApi, knowledgeApi } from '@/api';
import { PageHeader } from '@/components/scaffold/PageHeader';
import { AiErrorBanner } from '@/components/ai-ops/AiErrorBanner';
import { canTriageFeedback, useAiOpsRole } from '@/lib/ai-ops-permissions';
import {
  applyFeedbackFilters,
  buildQualityHref,
  hasFeedbackFilters,
  parseFeedbackFilters,
  type FeedbackFilters,
} from '@/lib/ai-ops-quality-filters';
import type {
  AiFeedbackItem,
  AiFeedbackSummary,
  EvalCase,
  EvalDataset,
  EvalRun,
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

const FAILURE_KIND_OPTIONS = Object.entries(FAILURE_KIND_LABELS).map(
  ([value, label]) => ({ value, label }),
);

const RESOLUTION_OPTIONS = Object.entries(RESOLUTION_LABELS).map(
  ([value, label]) => ({ value, label }),
);

const RUN_STATUS_LABELS: Record<string, string> = {
  QUEUED: '排队中',
  RUNNING: '运行中',
  COMPLETED: '已完成',
  FAILED: '失败',
};

const RESULT_VERDICT_LABELS: Record<string, string> = {
  solved: '解决',
  partial: '部分解决',
  unsolved: '未解决',
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
  const mustMention = item.expect?.mustMention;
  return Array.isArray(mustMention) ? mustMention.join('；') : '';
}

function formatPassRate(summary?: Record<string, any> | null): string {
  const rate = summary?.passRate;
  return typeof rate === 'number' ? `${(rate * 100).toFixed(1)}%` : '-';
}

/** 基线差值：正数表示通过率提升，带符号展示。 */
function formatDelta(value?: number | null): string {
  if (typeof value !== 'number') return '-';
  const sign = value > 0 ? '+' : '';
  return `${sign}${(value * 100).toFixed(1)}%`;
}

function reviewStatusLabel(raw?: string | null): string {
  return raw ? (REVIEW_STATUS_LABELS[raw as ReviewStatus] ?? raw) : '-';
}

function countByValue(
  rows: Array<Record<string, any>> | undefined,
  key: string,
  value: string,
): number {
  return (rows ?? []).find((row) => row[key] === value)?.count ?? 0;
}

/**
 * 只有确认的模型问题才允许沉淀为回归用例：
 * 模型答错 / 误转 / 判定错误；服务故障、正常转人工不算模型问题。
 */
function isModelProblem(item: FeedbackRow | null | undefined): boolean {
  if (!item) return false;
  if (
    item.failureKind === 'SERVICE_ERROR' ||
    item.failureKind === 'EXPECTED_TRANSFER'
  ) {
    return false;
  }
  return (
    item.failureKind === 'MODEL_ERROR' ||
    item.failureKind === 'UNEXPECTED_TRANSFER' ||
    item.verdict === 'incorrect'
  );
}

export default function AiQualityPage() {
  const [tab, setTab] = useState<Tab>('feedback');

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
              tab === key
                ? 'bg-blue-600 text-white'
                : 'border dark:border-white/10'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'feedback' ? (
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
      {tab === 'eval' ? <EvalPanel /> : null}
      {tab === 'rag' ? <RagPanel /> : null}
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
  const role = useAiOpsRole();
  const { data: featuresData } = useRequest(aiOpsApi.getFeatures);
  // features 未加载或加载失败时按关闭处理，避免渲染写按钮后 403。
  const feedbackUiEnabled = featuresData?.feedbackUiEnabled === true;
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
    () =>
      chatApi.getFeedbackSummary({
        ...(fromDate ? { from: fromDate } : {}),
        ...(toDate ? { to: toDate } : {}),
      }),
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
        ...(fromDate ? { from: fromDate } : {}),
        ...(toDate ? { to: toDate } : {}),
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
  const list = ((data as any)?.list ?? []) as FeedbackRow[];
  const datasetList: EvalDataset[] = Array.isArray(datasetListData)
    ? (datasetListData as EvalDataset[])
    : [];
  const total = (data as any)?.total ?? 0;
  const kpis: Array<{ label: string; value?: number; href: string }> = [
    {
      label: '待处理',
      value: summary?.pending,
      href: withRange({ queue: 'TODO' }),
    },
    {
      label: '系统信号',
      value: summary?.signals ?? 0,
      href: withRange({ queue: 'SIGNAL' }),
    },
    {
      label: '模型答错',
      value: countByValue(
        summary?.byFailureKind,
        'failureKind',
        'MODEL_ERROR',
      ),
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
      value: countByValue(
        summary?.byResolution,
        'resolution',
        'ADDED_TO_EVAL',
      ),
      href: withRange({ resolution: 'ADDED_TO_EVAL' }),
    },
  ];

  const triage = async (
    id: string,
    patch: {
      reviewStatus: ReviewStatus;
      resolution: 'CONFIRMED' | 'EXCLUDED' | 'NO_ISSUE';
      failureKind?: string;
      verdict?: 'correct' | 'incorrect';
      errorType?: string;
    },
  ) => {
    const note = window.prompt('备注（可选，用于记录分诊原因）') ?? undefined;
    setActionError('');
    try {
      await aiQualityApi.updateFeedback(id, { ...patch, note } as any);
      // 必须等刷新完成再前进，否则候选列表还是旧数据，会跳过下一条。
      await Promise.all([refreshListAsync(), refreshSummaryAsync()]);
      return true;
    } catch (err: any) {
      setActionError(err?.message ?? '分诊失败，请重试');
      return false;
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
    const expected = window.prompt(
      '期望答案 / 必须提到的要点（必填，作为回归判分标准）',
    )?.trim();
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
      })) as (EvalDataset & { cases?: EvalCase[] }) | undefined;
      const cases = result?.cases ?? [];
      // 用例按创建时间升序返回，取最后一条与问题匹配的用例即本次新建项。
      const created = [...cases]
        .reverse()
        .find((item) => item.question === (target.input ?? ''));
      if (!created) {
        throw new Error('用例已提交，但未能定位新建用例，请刷新后手动关联');
      }
      await aiQualityApi.updateFeedback(target.id, {
        linkedEvalCaseId: created.id,
        resolution: 'ADDED_TO_EVAL',
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

  const handleReview = async (
    kind: 'correct' | 'incorrect' | 'exclude',
  ) => {
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
    const ok = await triage(current.id, patch);
    if (ok) advanceReview();
  };

  return (
    <section className="space-y-3">
      {featuresData && !feedbackUiEnabled ? (
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
              {value != null ? value : summaryLoading ? '加载中…' : '—'}
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
                {label}
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
                {option.label}
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
            onClick={() => {
              setReviewIndex(0);
              setReviewMode(true);
            }}
          >
            开始质检
          </Button>
        ) : null}
        <span className="text-xs text-gray-500">共 {total} 条</span>
        {!canTriage ? (
          <span className="rounded-lg border px-2 py-0.5 text-xs text-gray-500 dark:border-white/10">
            只读
          </span>
        ) : null}
      </div>

      {canTriage ? (
        <div className="rounded-xl border border-gray-100 bg-white p-4 dark:border-white/10 dark:bg-gray-900">
          <div className="text-sm font-semibold">分诊归因</div>
          <p className="mt-1 text-xs text-gray-500">
            先选择主要原因，再用行内「确认问题 / 排除」完成分诊；「回答正确」会标记为已确认且非故障。
          </p>
          <label className="mt-2 flex items-center gap-2 text-xs text-gray-500">
            主要原因
            <select
              aria-label="主要原因"
              className="rounded-lg border px-3 py-1.5 text-sm dark:border-white/10 dark:bg-gray-800"
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
        </div>
      ) : null}

      {error ? (
        <AiErrorBanner message="反馈列表加载失败，请重试" onRetry={refresh} />
      ) : null}
      {actionError ? (
        <AiErrorBanner message={actionError} onRetry={() => setActionError('')} />
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
                    {dataset.name}（{dataset._count?.cases ?? 0} 条用例）
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
              onClick={() => setReviewMode(false)}
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
            </div>
            <div className="rounded-lg border bg-white p-3 dark:border-white/10 dark:bg-gray-900">
              <div className="mb-2 text-xs text-gray-500">这条怎么处理？</div>
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
                  disabled={!isModelProblem(current)}
                  title={
                    isModelProblem(current)
                      ? '将这条反馈加入回归评测集'
                      : '仅模型答错、误转或判定错误的反馈可加入回归'
                  }
                  onClick={() => openAddToRegression(current)}
                >
                  加入回归
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={advanceReview}
                >
                  跳过
                </Button>
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
                '分诊状态',
                '处理状态',
                '用户问题',
                'AI 回答',
                '备注',
                '操作',
              ].map((h) => (
                <th key={h} className="px-3 py-2">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={10} className="px-3 py-6 text-center text-gray-400">
                  加载中…
                </td>
              </tr>
            ) : error ? null : list.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-3 py-6 text-center text-gray-400">
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
                  <td className="px-3 py-2">
                    {labelOf(SOURCE_LABELS, item.source)}
                  </td>
                  <td className="px-3 py-2">
                    {item.verdict
                      ? labelOf(VERDICT_LABELS, item.verdict)
                      : item.signal
                        ? labelOf(SIGNAL_LABELS, item.signal)
                        : '-'}
                  </td>
                  <td className="px-3 py-2">
                    {labelOf(FAILURE_KIND_LABELS, item.failureKind)}
                  </td>
                  <td className="px-3 py-2">
                    {reviewStatusLabel(item.reviewStatus)}
                  </td>
                  <td className="px-3 py-2">
                    {labelOf(RESOLUTION_LABELS, item.resolution)}
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
                                failureKind,
                              })
                            }
                          >
                            确认问题
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              void triage(item.id, {
                                reviewStatus: 'IGNORED',
                                resolution: 'EXCLUDED',
                                failureKind,
                              })
                            }
                          >
                            排除
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={!isModelProblem(item)}
                            title={
                              isModelProblem(item)
                                ? '将这条反馈加入回归评测集'
                                : '仅模型答错、误转或判定错误的反馈可加入回归'
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
          disabled={page * 20 >= total}
          onClick={() => setPage((p) => p + 1)}
        >
          下一页
        </Button>
      </div>
    </section>
  );
}

function EvalPanel() {
  const [name, setName] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [casesJson, setCasesJson] = useState('[]');
  const [runId, setRunId] = useState('');
  const [mode, setMode] = useState<'STORED' | 'LIVE'>('STORED');
  const [baselineRunId, setBaselineRunId] = useState('');
  const [message, setMessage] = useState('');
  const [advanced, setAdvanced] = useState(false);
  const [pollRun, setPollRun] = useState(false);
  const role = useAiOpsRole();
  const canStartRun = role === 'SUPER_ADMIN' || role === 'ADMIN';

  const { data: datasets, refresh: refreshDatasets } = useRequest(
    aiQualityApi.listDatasets,
  );
  const { data: dataset, refresh: refreshDataset } = useRequest(
    () =>
      selectedId ? aiQualityApi.getDataset(selectedId) : Promise.resolve(null),
    { refreshDeps: [selectedId] },
  );
  const { data: run } = useRequest(
    () => (runId ? aiQualityApi.getRun(runId) : Promise.resolve(null)),
    {
      refreshDeps: [runId],
      pollingInterval: pollRun ? 3000 : undefined,
    },
  );
  const runStatus = (run as EvalRun | null | undefined)?.status;
  useEffect(() => {
    if (runStatus === 'COMPLETED' || runStatus === 'FAILED') {
      setPollRun(false);
    }
  }, [runStatus]);

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
      await aiQualityApi.addCases(selectedId, { cases: parsed });
      setMessage(`已添加 ${parsed.length} 条用例`);
      await refreshDataset();
      await refreshDatasets();
    } catch (err: any) {
      setMessage(err?.message ?? '导入失败');
    }
  };

  const editCase = async (item: any) => {
    if (!selectedId) return;
    const next = window.prompt(
      '期望答案 / 必须提到的要点',
      expectedText(item),
    );
    if (next == null) return;
    const expected = next.trim();
    if (!expected) {
      setMessage('期望答案不能为空');
      return;
    }
    try {
      await aiQualityApi.updateCase(selectedId, item.id, {
        expected,
        expect: { mustMention: [expected] },
      });
      await refreshDataset();
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
    if (!selectedId) return;
    const isLive = mode === 'LIVE';
    const confirmText = isLive
      ? '确认启动实时评测？会真实调用 AI 客服与 judge 模型。'
      : '确认启动批量评测？会调用 judge 模型。';
    if (!window.confirm(confirmText)) return;
    try {
      const created = await aiQualityApi.startRun(selectedId, {
        mode,
        ...(baselineRunId ? { baselineRunId } : {}),
      });
      setRunId(created.id);
      setPollRun(true);
      setMessage('已启动，正在轮询结果…');
    } catch (err: any) {
      setMessage(err?.message ?? '启动失败');
    }
  };

  const ds = dataset as
    | (EvalDataset & { cases: any[]; runs: EvalRun[] })
    | null;
  const runData = run as EvalRun | null;
  const list = Array.isArray(datasets)
    ? (datasets as EvalDataset[])
    : [];
  const selectedMeta = list.find((item) => item.id === selectedId);
  const lastRun = ds?.runs?.[0];
  const completedRuns = (ds?.runs ?? []).filter(
    (item) => item.status === 'COMPLETED',
  );

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <input
          className="rounded-lg border px-3 py-2 text-sm dark:border-white/10 dark:bg-gray-800"
          placeholder="评测集名称"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Button onClick={create}>创建评测集</Button>
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
              {d.name}（{d._count?.cases ?? 0} 条用例）
            </option>
          ))}
        </select>
        <Button
          size="sm"
          variant="outline"
          aria-expanded={advanced}
          onClick={() => setAdvanced((v) => !v)}
        >
          {advanced ? '收起高级模式' : '高级模式'}
        </Button>
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
          </h3>
          <div className="mt-2 flex flex-wrap gap-6 text-sm">
            <div>
              <div className="text-xs text-gray-500">用例数</div>
              <div className="font-medium">
                {ds?.cases?.length ?? selectedMeta?._count?.cases ?? 0}
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
              <div className="text-xs text-gray-500">最近一次通过率</div>
              <div className="font-medium">
                {lastRun
                  ? `${formatPassRate(lastRun.summary)}（${
                      labelOf(RUN_STATUS_LABELS, lastRun.status) || '-'
                    }）`
                  : '-'}
              </div>
            </div>
          </div>
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
                    {item.id.slice(0, 8)} · {formatPassRate(item.summary)}
                  </option>
                ))}
              </select>
            </label>
            <Button size="sm" onClick={start} disabled={!canStartRun}>
              启动批量评测
            </Button>
            {!canStartRun ? (
              <span className="text-xs text-gray-500">只读角色仅可查看结果</span>
            ) : null}
          </div>
        </div>
      ) : null}

      {selectedId && advanced ? (
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
            用例（{ds.cases?.length ?? 0}）
          </h3>
          <div className="max-h-52 space-y-2 overflow-y-auto text-xs">
            {(ds.cases ?? []).length === 0 ? (
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
                    期望：{expectedText(c) || '未填写'}
                    {c.source === 'feedback' ? ' · 来源：反馈' : ''}
                  </div>
                  {canStartRun ? (
                    <div className="mt-1 flex gap-2">
                      <button
                        type="button"
                        className="text-primary-600 hover:underline"
                        onClick={() => void editCase(c)}
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
              模式：{runData.mode === 'LIVE' ? '实时跑 AI' : '历史回答'}
            </span>
            <span className="text-xs text-gray-500">
              通过率 {formatPassRate(runData.summary)}
            </span>
            {runData.summary?.total != null ? (
              <span className="text-xs text-gray-500">
                共 {runData.summary.total} 条 · 解决{' '}
                {runData.summary.solved ?? 0} · 部分{' '}
                {runData.summary.partial ?? 0} · 未解决{' '}
                {runData.summary.unsolved ?? 0}
              </span>
            ) : null}
            {typeof runData.summary?.baselinePassRate === 'number' ? (
              <span className="text-xs text-gray-500">
                基线{' '}
                {formatPassRate({
                  passRate: runData.summary.baselinePassRate,
                })}{' '}
                · 变化 {formatDelta(runData.summary.delta)} · 新增失败{' '}
                {runData.summary.newFailures ?? 0} · 修复{' '}
                {runData.summary.fixed ?? 0}
              </span>
            ) : null}
          </div>
          {runData.summary?.error ? (
            <div className="mt-2 text-xs text-red-600 dark:text-red-300">
              失败原因：{runData.summary.error}
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
              (runData.results ?? []).map((r) => (
                <div
                  key={r.id}
                  className="rounded-lg border p-2 dark:border-white/10"
                >
                  <div className="font-medium">
                    {labelOf(RESULT_VERDICT_LABELS, r.verdict)} · 分数{' '}
                    {r.score} · {r.latencyMs ?? '-'}ms
                  </div>
                  <div>{r.case?.question}</div>
                  {r.actualAnswer ? (
                    <div className="text-gray-500">
                      实际回答：{r.actualAnswer}
                    </div>
                  ) : null}
                  <div className="text-gray-500">{r.reason}</div>
                </div>
              ))
            )}
          </div>
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

function RagPanel() {
  const [query, setQuery] = useState('');
  const [domain, setDomain] = useState('');
  const [result, setResult] = useState<any>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState('');
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
  const cards = [
    ['文档总数', stats?.total],
    ['有标记', stats?.flagged],
    ['待复核', stats?.needReview],
    ['优秀', byScore?.excellent],
    ['良好', byScore?.good],
    ['一般', byScore?.fair],
    ['可疑', byScore?.suspicious],
  ] as const;
  const recentFlags = stats?.recentFlags ?? [];
  const results: any[] = result?.results ?? [];

  return (
    <section className="space-y-4">
      {statsError ? (
        <AiErrorBanner
          message="知识质量统计加载失败，请重试"
          onRetry={refreshStats}
        />
      ) : null}

      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-7">
        {cards.map(([label, value]) => (
          <div key={label} className="rounded-xl border p-3 dark:border-white/10">
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
          最近标记文档
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-left dark:bg-white/5">
              <tr>
                {['文档', '评分', '标记', '上传时间'].map((h) => (
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
                    colSpan={4}
                    className="px-3 py-6 text-center text-gray-400"
                  >
                    加载中…
                  </td>
                </tr>
              ) : recentFlags.length === 0 ? (
                <tr>
                  <td
                    colSpan={4}
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
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

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
          {results.length === 0 ? (
            <div className="rounded-xl border border-dashed p-6 text-center text-sm text-gray-400 dark:border-white/10">
              暂无检索结果。
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
          <details>
            <summary className="cursor-pointer text-xs text-gray-500">
              原始检索结果（工程师）
            </summary>
            <pre className="mt-2 max-h-[420px] overflow-auto rounded-xl border bg-gray-50 p-3 text-xs dark:border-white/10 dark:bg-gray-900">
              {JSON.stringify(result, null, 2)}
            </pre>
          </details>
        </div>
      ) : null}
    </section>
  );
}
