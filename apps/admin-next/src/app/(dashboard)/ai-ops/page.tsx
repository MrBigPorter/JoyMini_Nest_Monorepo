'use client';

import Link from 'next/link';
import { useRequest } from 'ahooks';
import { aiOpsApi } from '@/api';
import { PageHeader } from '@/components/scaffold/PageHeader';
import type {
  AiFailedJob,
  AiOutboxItem,
  AiQueueStats,
  AiUsageSummary,
} from '@/type/types';

function normalizeQueues(data: unknown): AiQueueStats[] {
  if (Array.isArray(data)) return data as AiQueueStats[];
  return ((data as { queues?: AiQueueStats[] })?.queues ?? []) as AiQueueStats[];
}

function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-gray-100 bg-white p-4 dark:border-white/10 dark:bg-gray-900">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
      {hint ? <div className="mt-1 text-xs text-gray-400">{hint}</div> : null}
    </div>
  );
}

export default function AiOpsOverviewPage() {
  const { data: queueData, loading: queueLoading } = useRequest(
    aiOpsApi.getQueues,
    { pollingInterval: 15_000 },
  );
  const { data: failed } = useRequest(() => aiOpsApi.getAiFailed(100), {
    pollingInterval: 30_000,
  });
  const { data: outbox } = useRequest(() => aiOpsApi.getOutbox(undefined, 100), {
    pollingInterval: 30_000,
  });
  const { data: usage } = useRequest(aiOpsApi.getUsageSummary, {
    pollingInterval: 60_000,
  });

  const queues = normalizeQueues(queueData);
  const aiQueue = queues.find((q) => q.name === 'ai-processing');
  const ragQueue = queues.find((q) => q.name === 'rag-embedding');
  const failedCount = (failed as AiFailedJob[] | undefined)?.length ?? 0;
  const outboxFailed =
    (outbox as AiOutboxItem[] | undefined)?.filter((i) => i.status === 'FAILED')
      .length ?? 0;
  const summary = usage as AiUsageSummary | undefined;

  return (
    <div className="space-y-5 p-4">
      <PageHeader
        title="AI Operations"
        description="AI 客服生产运营总览：队列、死信、Outbox、Token 用量"
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="AI 队列等待"
          value={queueLoading ? '—' : (aiQueue?.waiting ?? 0)}
          hint={`active ${aiQueue?.active ?? 0} / failed ${aiQueue?.failed ?? 0}`}
        />
        <StatCard
          label="AI 死信"
          value={failedCount}
          hint="需在 Runtime 页重放"
        />
        <StatCard
          label="Outbox 失败"
          value={outboxFailed}
          hint="消息已落库但未入队"
        />
        <StatCard
          label="今日 Token"
          value={summary?.totals.totalTokens?.toLocaleString() ?? '—'}
          hint={`${summary?.totals.requests ?? 0} requests（UTC）`}
        />
        <StatCard
          label="RAG 向量队列"
          value={ragQueue?.waiting ?? 0}
          hint={`failed ${ragQueue?.failed ?? 0}`}
        />
        <StatCard
          label="反馈覆盖"
          value="—"
          hint="Quality 页（P1）"
        />
        <StatCard
          label="注入命中"
          value="—"
          hint="Security 页（P1）"
        />
        <StatCard
          label="客服排队"
          value="—"
          hint="Support Ops 页（P1）"
        />
      </div>

      <div className="rounded-xl border border-gray-100 bg-white p-4 dark:border-white/10 dark:bg-gray-900">
        <h2 className="text-sm font-semibold">快速入口</h2>
        <div className="mt-3 flex flex-wrap gap-2 text-sm">
          <Link className="rounded-lg border px-3 py-1.5" href="/ai-ops/runtime">
            AI Runtime
          </Link>
          <Link className="rounded-lg border px-3 py-1.5" href="/ai-ops/flows">
            流程版本
          </Link>
          <Link className="rounded-lg border px-3 py-1.5" href="/ai-ops/usage">
            Token 用量
          </Link>
          <Link className="rounded-lg border px-3 py-1.5" href="/ai-ops/memory">
            用户记忆
          </Link>
        </div>
      </div>
    </div>
  );
}
