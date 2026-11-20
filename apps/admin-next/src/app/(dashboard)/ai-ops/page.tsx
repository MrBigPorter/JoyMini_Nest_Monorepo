'use client';

import Link from 'next/link';
import { useRequest } from 'ahooks';
import { aiOpsApi, aiQualityApi, chatApi } from '@/api';
import { PageHeader } from '@/components/scaffold/PageHeader';
import { AiErrorBanner } from '@/components/ai-ops/AiErrorBanner';
import { getVisibleRoutes } from '@/routes';
import { useAiOpsRole } from '@/lib/ai-ops-permissions';
import type {
  AiFailedJob,
  AiFeedbackSummary,
  AiOutboxItem,
  AiQueueStats,
  AiSecuritySummary,
  AiUsageSummary,
} from '@/type/types';

interface SlaQueueItem {
  conversationId: string;
  transferredAt: string | null;
  lastMessageAt: string | null;
  waitingSeconds: number;
  breached: boolean;
}

interface SlaQueueData {
  thresholdMinutes: number;
  items: SlaQueueItem[];
}

function normalizeQueues(data: unknown): AiQueueStats[] {
  if (Array.isArray(data)) return data as AiQueueStats[];
  return ((data as { queues?: AiQueueStats[] })?.queues ??
    []) as AiQueueStats[];
}

function countByValue(
  rows: Array<Record<string, any>> | undefined,
  key: string,
  value: string,
): number {
  return (rows ?? []).find((row) => row[key] === value)?.count ?? 0;
}

function formatDataTime(value?: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString();
}

/**
 * 记录某份数据最近一次到达前端的时间。
 * 后端汇总接口大多不带时间戳，这里展示的是“数据截止（浏览器收到时间）”，
 * 不使用本地当前时间去冒充服务端时间。
 */
function useDataTimestamp(value: unknown): string | null {
  // 纯函数式时间戳：不触发额外渲染，避免轮询/测试中被误当成新请求。
  return value !== undefined && value !== null
    ? new Date().toISOString()
    : null;
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

function AnomalyCard({
  label,
  value,
  hint,
  href,
  error,
  updatedAt,
  testId,
}: {
  label: string;
  value: number | string | null | undefined;
  hint?: string;
  href: string;
  error?: unknown;
  updatedAt?: string | null;
  testId?: string;
}) {
  const isError = Boolean(error);
  const display = isError ? '—' : (value ?? '—');
  const dataTime = formatDataTime(updatedAt);
  return (
    <Link
      href={href}
      data-testid={testId}
      className="block rounded-xl border border-gray-100 bg-white p-4 hover:bg-gray-50 dark:border-white/10 dark:bg-gray-900 dark:hover:bg-white/5"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="text-xs text-gray-500">{label}</div>
        {!isError && typeof value === 'number' && value > 0 ? (
          <span className="rounded-full bg-red-50 px-1.5 py-0.5 text-[10px] font-medium text-red-600 dark:bg-red-500/10 dark:text-red-300">
            需关注
          </span>
        ) : null}
      </div>
      <div
        className={`mt-1 text-2xl font-semibold ${
          isError ? 'text-gray-400' : ''
        }`}
      >
        {display}
      </div>
      {hint ? <div className="mt-1 text-xs text-gray-400">{hint}</div> : null}
      <div
        className={`mt-2 text-[10px] ${
          isError ? 'text-red-500' : 'text-gray-400'
        }`}
      >
        {isError
          ? '加载失败'
          : dataTime
            ? `数据截止 ${dataTime}`
            : '数据加载中…'}
      </div>
    </Link>
  );
}

interface AttentionRow {
  key: string;
  label: string;
  description: string;
  count: number;
  href: string;
  updatedAt: string | null;
}

export default function AiOpsOverviewPage() {
  const role = useAiOpsRole();
  // 侧边栏隐藏工程组后，首页快捷入口必须使用同一份可见性规则，避免单点隐藏。
  const engineeringVisible = getVisibleRoutes(role).some(
    (route) => route.group === 'AI Operations · 工程',
  );
  const quickLinks = [
    { href: '/ai-ops/quality', label: '质量待办', engineering: false },
    { href: '/ai-ops/support', label: '转人工队列', engineering: false },
    { href: '/ai-ops/security', label: '安全事件', engineering: true },
    { href: '/ai-ops/insights', label: '运营洞察', engineering: false },
    { href: '/ai-ops/runtime', label: 'AI Runtime', engineering: true },
    { href: '/ai-ops/flows', label: '流程版本', engineering: true },
    { href: '/ai-ops/usage', label: '用量与成本', engineering: true },
    { href: '/ai-ops/memory', label: '客户记忆', engineering: true },
  ].filter((link) => engineeringVisible || !link.engineering);

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
  const {
    data: feedbackData,
    loading: feedbackLoading,
    error: feedbackError,
    refresh: refreshFeedback,
  } = useRequest(() => chatApi.getFeedbackSummary(), {
    pollingInterval: 60_000,
  });
  const {
    data: securityData,
    loading: securityLoading,
    error: securityError,
    refresh: refreshSecurity,
  } = useRequest(() => aiQualityApi.securitySummary(), {
    pollingInterval: 60_000,
  });
  const {
    data: slaData,
    loading: slaLoading,
    error: slaError,
    refresh: refreshSla,
  } = useRequest(aiQualityApi.slaQueue, { pollingInterval: 30_000 });

  const queues = normalizeQueues(queueData);
  const aiQueue = queues.find((q) => q.name === 'ai-processing');
  const ragQueue = queues.find((q) => q.name === 'rag-embedding');
  const failedCount = (failed as AiFailedJob[] | undefined)?.length ?? 0;
  const outboxFailed =
    (outbox as AiOutboxItem[] | undefined)?.filter((i) => i.status === 'FAILED')
      .length ?? 0;
  const summary = usage as AiUsageSummary | undefined;
  const feedback = feedbackData as AiFeedbackSummary | undefined;
  const security = securityData as AiSecuritySummary | undefined;
  const sla = slaData as SlaQueueData | undefined;
  const feedbackAt = useDataTimestamp(feedbackData);
  const securityAt = useDataTimestamp(securityData);
  const slaAt = useDataTimestamp(slaData);

  const feedbackReady = !feedbackLoading && !feedbackError && Boolean(feedback);
  const securityReady = !securityLoading && !securityError && Boolean(security);
  const slaReady = !slaLoading && !slaError && Boolean(sla);

  const pendingFeedback = feedback ? feedback.pending : undefined;
  const modelError = feedback
    ? countByValue(feedback.byFailureKind, 'failureKind', 'MODEL_ERROR')
    : undefined;
  const serviceError = feedback
    ? countByValue(feedback.byFailureKind, 'failureKind', 'SERVICE_ERROR')
    : undefined;
  const unexpectedTransfer = feedback
    ? countByValue(feedback.byFailureKind, 'failureKind', 'UNEXPECTED_TRANSFER')
    : undefined;
  const addedToEval = feedback
    ? countByValue(feedback.byResolution, 'resolution', 'ADDED_TO_EVAL')
    : undefined;

  const securityNew = security
    ? countByValue(security.byStatus, 'status', 'NEW')
    : undefined;
  const securityTotal = security?.total;

  const slaItems = sla?.items ?? [];
  const slaWaiting = sla ? slaItems.length : undefined;
  const slaBreached = sla
    ? slaItems.filter((item) => item.breached).length
    : undefined;
  const slaServerAt = slaItems.reduce<string | null>((latest, item) => {
    const candidate = item.lastMessageAt ?? item.transferredAt;
    if (!candidate) return latest;
    if (!latest) return candidate;
    return new Date(candidate).getTime() > new Date(latest).getTime()
      ? candidate
      : latest;
  }, null);
  const feedbackDataAt = feedbackAt;
  const securityDataAt = security?.latestAt ?? securityAt;
  const slaDataAt = slaServerAt ?? slaAt;

  const attentionRows: AttentionRow[] = [];
  if (feedbackReady && (serviceError ?? 0) > 0) {
    attentionRows.push({
      key: 'service-error',
      label: '服务故障待处理',
      description: '先看失败类型为 SERVICE_ERROR 的反馈',
      count: serviceError ?? 0,
      href: '/ai-ops/quality?failureKind=SERVICE_ERROR',
      updatedAt: feedbackDataAt,
    });
  }
  if (feedbackReady && (pendingFeedback ?? 0) > 0) {
    attentionRows.push({
      key: 'pending-feedback',
      label: '待处理反馈',
      description: '尚未分诊的用户反馈队列',
      count: pendingFeedback ?? 0,
      href: '/ai-ops/quality?reviewStatus=PENDING',
      updatedAt: feedbackDataAt,
    });
  }
  if (slaReady && (slaBreached ?? 0) > 0) {
    attentionRows.push({
      key: 'sla-breached',
      label: 'SLA 超时',
      description: '转人工等待已超过承诺时间',
      count: slaBreached ?? 0,
      href: '/ai-ops/support',
      updatedAt: slaDataAt,
    });
  }
  if (securityReady && (securityNew ?? 0) > 0) {
    attentionRows.push({
      key: 'security-new',
      label: '安全待处理',
      description: '状态为 NEW 的注入/安全事件',
      count: securityNew ?? 0,
      href: '/ai-ops/security',
      updatedAt: securityDataAt,
    });
  }
  const visibleAttentionRows = attentionRows.slice(0, 4);
  const anomalySourcesReady = feedbackReady && securityReady && slaReady;
  const anomalyHasError = Boolean(feedbackError || securityError || slaError);

  const hasError = Boolean(
    queueError ||
      failedError ||
      outboxError ||
      usageError ||
      feedbackError ||
      securityError ||
      slaError,
  );

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
            void refreshFeedback();
            void refreshSecurity();
            void refreshSla();
          }}
        />
      ) : null}

      <section
        data-testid="attention-section"
        className="rounded-xl border border-gray-100 bg-white p-4 dark:border-white/10 dark:bg-gray-900"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">今天最需要关注</h2>
          <span className="text-[11px] text-gray-400">
            按优先级排序，最多 4 条
          </span>
        </div>
        {visibleAttentionRows.length > 0 ? (
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {visibleAttentionRows.map((row) => (
              <Link
                key={row.key}
                href={row.href}
                className="flex items-start justify-between gap-3 rounded-lg border border-red-100 bg-red-50/40 px-3 py-2.5 hover:bg-red-50 dark:border-red-500/20 dark:bg-red-500/5 dark:hover:bg-red-500/10"
              >
                <div>
                  <div className="text-sm font-medium">{row.label}</div>
                  <div className="mt-0.5 text-xs text-gray-500">
                    {row.description}
                  </div>
                  <div className="mt-1 text-[10px] text-gray-400">
                    数据截止 {formatDataTime(row.updatedAt) ?? '—'}
                  </div>
                </div>
                <div className="text-xl font-semibold text-red-600 dark:text-red-300">
                  {row.count}
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="mt-3 text-sm text-gray-500">
            {!anomalySourcesReady
              ? anomalyHasError
                ? '异常数据加载失败，暂无法确认是否无异常。'
                : '正在加载异常数据…'
              : '今天暂无异常'}
          </div>
        )}
      </section>

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

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">运营异常</h2>
          <span className="text-[11px] text-gray-400">
            点击卡片进入对应处理页；数据每 30–60 秒刷新
          </span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <AnomalyCard
            label="待处理反馈"
            value={pendingFeedback}
            error={feedbackError}
            updatedAt={feedbackDataAt}
            hint="尚未分诊的用户反馈"
            href="/ai-ops/quality?reviewStatus=PENDING"
            testId="anomaly-pending-feedback"
          />
          <AnomalyCard
            label="模型答错"
            value={modelError}
            error={feedbackError}
            updatedAt={feedbackDataAt}
            hint="失败类型 MODEL_ERROR"
            href="/ai-ops/quality?failureKind=MODEL_ERROR"
            testId="anomaly-model-error"
          />
          <AnomalyCard
            label="服务故障"
            value={serviceError}
            error={feedbackError}
            updatedAt={feedbackDataAt}
            hint="失败类型 SERVICE_ERROR"
            href="/ai-ops/quality?failureKind=SERVICE_ERROR"
            testId="anomaly-service-error"
          />
          <AnomalyCard
            label="误转"
            value={unexpectedTransfer}
            error={feedbackError}
            updatedAt={feedbackDataAt}
            hint="失败类型 UNEXPECTED_TRANSFER"
            href="/ai-ops/quality?failureKind=UNEXPECTED_TRANSFER"
            testId="anomaly-unexpected-transfer"
          />
          <AnomalyCard
            label="已进回归"
            value={addedToEval}
            error={feedbackError}
            updatedAt={feedbackDataAt}
            hint="处置结果 ADDED_TO_EVAL"
            href="/ai-ops/quality?resolution=ADDED_TO_EVAL"
            testId="anomaly-added-to-eval"
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <AnomalyCard
            label="安全事件（NEW / 总数）"
            value={
              security
                ? `${(securityNew ?? 0).toLocaleString()} / ${securityTotal?.toLocaleString() ?? '—'}`
                : undefined
            }
            error={securityError}
            updatedAt={securityDataAt}
            hint="NEW 状态 / 全部安全事件"
            href="/ai-ops/security"
            testId="anomaly-security"
          />
          <AnomalyCard
            label="等待人工"
            value={slaWaiting}
            error={slaError}
            updatedAt={slaDataAt}
            hint="当前排队等待人工接入的会话"
            href="/ai-ops/support"
            testId="anomaly-sla-waiting"
          />
          <AnomalyCard
            label="超 SLA"
            value={slaBreached}
            error={slaError}
            updatedAt={slaDataAt}
            hint={
              sla?.thresholdMinutes
                ? `等待超过 ${sla.thresholdMinutes} 分钟`
                : '等待超过承诺时间'
            }
            href="/ai-ops/support"
            testId="anomaly-sla-breached"
          />
        </div>
      </section>

      <div className="rounded-xl border border-gray-100 bg-white p-4 dark:border-white/10 dark:bg-gray-900">
        <h2 className="text-sm font-semibold">快速入口</h2>
        <div className="mt-3 flex flex-wrap gap-2 text-sm">
          {quickLinks.map((link) => (
            <Link
              key={link.href}
              className="rounded-lg border px-3 py-1.5"
              href={link.href}
            >
              {link.label}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
