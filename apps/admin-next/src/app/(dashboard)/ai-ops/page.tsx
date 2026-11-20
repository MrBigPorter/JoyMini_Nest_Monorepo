'use client';

import Link from 'next/link';
import { useRequest } from 'ahooks';
import { aiOpsApi } from '@/api';
import { PageHeader } from '@/components/scaffold/PageHeader';
import { AiErrorBanner } from '@/components/ai-ops/AiErrorBanner';
import type {
  AiFailedJob,
  AiOutboxItem,
  AiQueueStats,
  AiUsageSummary,
} from '@/type/types';

function normalizeQueues(data: unknown): AiQueueStats[] {
  if (Array.isArray(data)) return data as AiQueueStats[];
  return ((data as { queues?: AiQueueStats[] })?.queues ??
    []) as AiQueueStats[];
}

function StatCard({
  label,
  value,
  hint,
  href,
}: {
  label: string;
  value: string | number;
  hint?: string;
  href?: string;
}) {
  const content = (
    <>
      <div className="text-xs text-gray-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
      {hint ? <div className="mt-1 text-xs text-gray-400">{hint}</div> : null}
    </>
  );
  const className =
    'rounded-xl border border-gray-100 bg-white p-4 dark:border-white/10 dark:bg-gray-900';
  return href ? (
    <Link className={`${className} block hover:bg-gray-50 dark:hover:bg-white/5`} href={href}>
      {content}
    </Link>
  ) : (
    <div className={className}>{content}</div>
  );
}

export default function AiOpsOverviewPage() {
  const today = new Date().toISOString().slice(0, 10);
  const {
    data: queueData,
    loading: queueLoading,
    error: queueError,
    refresh: refreshQueues,
  } = useRequest(aiOpsApi.getQueues, { pollingInterval: 15_000 });
  const {
    data: failed,
    error: failedError,
    refresh: refreshFailed,
  } = useRequest(() => aiOpsApi.getAiFailed(100), {
    pollingInterval: 30_000,
  });
  const {
    data: outbox,
    error: outboxError,
    refresh: refreshOutbox,
  } = useRequest(() => aiOpsApi.getOutbox(undefined, 100), {
    pollingInterval: 30_000,
  });
  const {
    data: usage,
    error: usageError,
    refresh: refreshUsage,
  } = useRequest(
    () => aiOpsApi.getUsageSummary({ from: today, to: today }),
    { pollingInterval: 60_000 },
  );

  const queues = normalizeQueues(queueData);
  const aiQueue = queues.find((q) => q.name === 'ai-processing');
  const ragQueue = queues.find((q) => q.name === 'rag-embedding');
  const failedCount = (failed as AiFailedJob[] | undefined)?.length ?? 0;
  const outboxFailed =
    (outbox as AiOutboxItem[] | undefined)?.filter((i) => i.status === 'FAILED')
      .length ?? 0;
  const summary = usage as AiUsageSummary | undefined;
  const hasError = Boolean(queueError || failedError || outboxError || usageError);

  return (
    <div className="space-y-5 p-4">
      <PageHeader
        title="今日运营"
        description="今天哪里不对：队列、未回复消息、SLA、Token"
      />

      <div className="text-xs text-gray-500">
        数据截止：{new Date().toLocaleString()}（页面每 15–60 秒刷新）
      </div>

      {hasError ? (
        <AiErrorBanner
          message="部分数据加载失败，下面的数字可能不完整。"
          onRetry={() => {
            void refreshQueues();
            void refreshFailed();
            void refreshOutbox();
            void refreshUsage();
          }}
        />
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="AI 队列等待"
          value={queueLoading ? '—' : (aiQueue?.waiting ?? 0)}
          hint={`active ${aiQueue?.active ?? 0} / failed ${aiQueue?.failed ?? 0}`}
          href="/ai-ops/runtime"
        />
        <StatCard
          label="AI 死信"
          value={failedError ? '—' : failedCount}
          hint={failedError ? '加载失败' : '需在 Runtime 页重放'}
          href="/ai-ops/runtime"
        />
        <StatCard
          label="Outbox 失败"
          value={outboxError ? '—' : outboxFailed}
          hint={outboxError ? '加载失败' : '消息已落库但未入队'}
          href="/ai-ops/runtime"
        />
        <StatCard
          label="今日 Token（UTC）"
          value={
            usageError
              ? '—'
              : (summary?.totals.totalTokens?.toLocaleString() ?? '—')
          }
          hint={
            usageError
              ? '加载失败'
              : `${summary?.totals.requests ?? 0} requests`
          }
          href="/ai-ops/usage"
        />
        <StatCard
          label="RAG 向量队列"
          value={ragQueue?.waiting ?? 0}
          hint={`failed ${ragQueue?.failed ?? 0}`}
          href="/ai-ops/runtime"
        />
      </div>

      <div className="rounded-xl border border-gray-100 bg-white p-4 dark:border-white/10 dark:bg-gray-900">
        <h2 className="text-sm font-semibold">快速入口</h2>
        <div className="mt-3 flex flex-wrap gap-2 text-sm">
          <Link
            className="rounded-lg border px-3 py-1.5"
            href="/ai-ops/quality"
          >
            质量待办
          </Link>
          <Link
            className="rounded-lg border px-3 py-1.5"
            href="/ai-ops/support"
          >
            转人工队列
          </Link>
          <Link
            className="rounded-lg border px-3 py-1.5"
            href="/ai-ops/security"
          >
            安全事件
          </Link>
          <Link
            className="rounded-lg border px-3 py-1.5"
            href="/ai-ops/insights"
          >
            运营洞察
          </Link>
          <Link
            className="rounded-lg border px-3 py-1.5"
            href="/ai-ops/runtime"
          >
            AI Runtime
          </Link>
          <Link className="rounded-lg border px-3 py-1.5" href="/ai-ops/flows">
            流程版本
          </Link>
          <Link className="rounded-lg border px-3 py-1.5" href="/ai-ops/usage">
            用量与成本
          </Link>
          <Link className="rounded-lg border px-3 py-1.5" href="/ai-ops/memory">
            客户记忆
          </Link>
        </div>
      </div>
    </div>
  );
}
