'use client';

import { useState } from 'react';
import { useRequest } from 'ahooks';
import { Button } from '@repo/ui';
import { aiQualityApi, chatApi, knowledgeApi } from '@/api';
import { PageHeader } from '@/components/scaffold/PageHeader';
import { AiErrorBanner } from '@/components/ai-ops/AiErrorBanner';
import { canTriageFeedback, useAiOpsRole } from '@/lib/ai-ops-permissions';
import type { AiFeedbackItem, EvalDataset, EvalRun } from '@/type/types';

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

function formatPassRate(summary?: Record<string, any> | null): string {
  const rate = summary?.passRate;
  return typeof rate === 'number' ? `${(rate * 100).toFixed(1)}%` : '-';
}

function reviewStatusLabel(raw?: string | null): string {
  return raw ? (REVIEW_STATUS_LABELS[raw as ReviewStatus] ?? raw) : '-';
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
      {tab === 'feedback' ? <FeedbackPanel /> : null}
      {tab === 'eval' ? <EvalPanel /> : null}
      {tab === 'rag' ? <RagPanel /> : null}
    </div>
  );
}

function FeedbackPanel() {
  const [reviewStatus, setReviewStatus] = useState('');
  const [page, setPage] = useState(1);
  const [actionError, setActionError] = useState('');
  const [reviewMode, setReviewMode] = useState(false);
  const [reviewIndex, setReviewIndex] = useState(0);
  const role = useAiOpsRole();
  const canTriage = canTriageFeedback(role);

  const { data, loading, error, refresh } = useRequest(
    () =>
      chatApi.getFeedbackList({
        page,
        pageSize: 20,
        ...(reviewStatus ? { reviewStatus } : {}),
      } as any),
    { refreshDeps: [page, reviewStatus] },
  );

  const list = ((data as any)?.list ?? []) as FeedbackRow[];
  const total = (data as any)?.total ?? 0;

  const triage = async (
    id: string,
    patch: {
      reviewStatus: ReviewStatus;
      verdict?: 'correct' | 'incorrect';
      errorType?: string;
    },
  ) => {
    const note = window.prompt('备注（可选，用于记录分诊原因）') ?? undefined;
    setActionError('');
    try {
      await aiQualityApi.updateFeedback(id, { ...patch, note });
      await refresh();
      return true;
    } catch (err: any) {
      setActionError(err?.message ?? '分诊失败，请重试');
      return false;
    }
  };

  const candidates = list.filter(
    (item) => !item.reviewStatus || item.reviewStatus === 'PENDING',
  );
  const reviewList = candidates.length > 0 ? candidates : list;
  const current = reviewMode ? reviewList[reviewIndex] : null;

  const advanceReview = () => {
    if (reviewIndex + 1 >= reviewList.length) {
      setReviewMode(false);
      setReviewIndex(0);
      return;
    }
    setReviewIndex((index) => index + 1);
  };

  const handleReview = async (
    kind: 'correct' | 'incorrect' | 'exclude',
  ) => {
    if (!current) return;
    const patch =
      kind === 'correct'
        ? { reviewStatus: 'REVIEWED' as const, verdict: 'correct' as const }
        : kind === 'incorrect'
          ? { reviewStatus: 'REVIEWED' as const, verdict: 'incorrect' as const }
          : { reviewStatus: 'IGNORED' as const };
    const ok = await triage(current.id, patch);
    if (ok) advanceReview();
  };

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-xs text-gray-500">
          分诊状态
          <select
            aria-label="反馈分诊状态"
            className="rounded-lg border px-3 py-1.5 text-sm dark:border-white/10 dark:bg-gray-800"
            value={reviewStatus}
            onChange={(e) => {
              setReviewStatus(e.target.value);
              setPage(1);
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

      {error ? (
        <AiErrorBanner message="反馈列表加载失败，请重试" onRetry={refresh} />
      ) : null}
      {actionError ? (
        <AiErrorBanner message={actionError} onRetry={() => setActionError('')} />
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
              <div>{current.input ?? '-'}</div>
              <div className="mb-1 mt-3 text-xs text-gray-500">AI 回答</div>
              <div className="max-h-40 overflow-y-auto text-gray-700 dark:text-gray-300">
                {current.answer ?? '-'}
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
                '用户问题',
                'AI 回答',
                '分诊状态',
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
                <td colSpan={8} className="px-3 py-6 text-center text-gray-400">
                  加载中…
                </td>
              </tr>
            ) : error ? null : list.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-gray-400">
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
                  <td
                    className="max-w-[260px] truncate px-3 py-2"
                    title={item.input ?? ''}
                  >
                    {item.input ?? '-'}
                  </td>
                  <td
                    className="max-w-[320px] truncate px-3 py-2 text-gray-600 dark:text-gray-300"
                    title={item.answer ?? ''}
                  >
                    {item.answer ?? '-'}
                  </td>
                  <td className="px-3 py-2">
                    {reviewStatusLabel(item.reviewStatus)}
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
                            onClick={() => void triage(item.id, { reviewStatus: 'REVIEWED' })}
                          >
                            确认问题
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => void triage(item.id, { reviewStatus: 'IGNORED' })}
                          >
                            排除
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
  const [message, setMessage] = useState('');
  const [advanced, setAdvanced] = useState(false);

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
    { refreshDeps: [runId], pollingInterval: runId ? 3000 : undefined },
  );

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

  const start = async () => {
    if (!selectedId) return;
    if (!window.confirm('确认启动批量评测？会调用 judge 模型。')) return;
    try {
      const created = await aiQualityApi.startRun(selectedId);
      setRunId(created.id);
      setMessage('已启动，正在轮询结果…');
    } catch (err: any) {
      setMessage(err?.message ?? '启动失败');
    }
  };

  const ds = dataset as
    | (EvalDataset & { cases: any[]; runs: EvalRun[] })
    | null;
  const runData = run as EvalRun | null;
  const list = (datasets as EvalDataset[] | undefined) ?? [];
  const selectedMeta = list.find((item) => item.id === selectedId);
  const lastRun = ds?.runs?.[0];

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
                {ds?.runs?.length ?? selectedMeta?._count?.runs ?? 0}
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
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" onClick={start}>
              启动批量评测
            </Button>
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
          </div>
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

      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
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
                {['文档', '评分', '标记', '解析时间'].map((h) => (
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
