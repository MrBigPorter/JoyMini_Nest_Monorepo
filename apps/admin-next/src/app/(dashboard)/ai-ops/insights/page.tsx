'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRequest } from 'ahooks';
import { aiQualityApi } from '@/api';
import { PageHeader } from '@/components/scaffold/PageHeader';
import { AiErrorBanner } from '@/components/ai-ops/AiErrorBanner';
import type { AiInsightsOverview, AiInsightsRate } from '@/type/types';

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

const REVIEW_STATUS_LABELS: Record<string, string> = {
  PENDING: '待审核',
  REVIEWED: '已审核',
  IGNORED: '已忽略',
};

function isoDaysAgo(days: number) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

function labelOf(map: Record<string, string>, raw: string): string {
  return map[raw] ?? raw;
}

function formatNumber(value: number | undefined): string {
  return typeof value === 'number' ? value.toLocaleString() : '—';
}

function formatRate(rate: AiInsightsRate | undefined): string {
  return rate ? `${(rate.rate * 100).toFixed(1)}%` : '—';
}

function formatFraction(rate: AiInsightsRate | undefined): string {
  return rate ? `分子/分母：${rate.numerator} / ${rate.denominator}` : '—';
}

function formatTransferRate(overview: AiInsightsOverview): string {
  const numerator = overview.transfers.numerator ?? overview.transfers.total;
  const denominator = overview.transfers.denominator ?? overview.conversations;
  if (!denominator) return '—';
  const pct = (numerator / denominator) * 100;
  return `${pct.toFixed(1)}% (${numerator}/${denominator})`;
}

export default function AiInsightsPage() {
  const [from, setFrom] = useState(isoDaysAgo(7));
  const [to, setTo] = useState(isoDaysAgo(0));
  const invalidRange = Boolean(from && to && from > to);

  const { data, loading, error, refresh } = useRequest(
    () =>
      invalidRange
        ? Promise.resolve(null)
        : aiQualityApi.insightsOverview({ from, to }),
    { refreshDeps: [from, to] },
  );
  const overview = data as AiInsightsOverview | null | undefined;

  const kpis: Array<{
    label: string;
    value: string;
    sub?: string;
    href?: string;
  }> = [
    {
      label: '会话数',
      value: formatNumber(overview?.conversations),
      href: '/customer-service',
    },
    {
      label: 'AI 消息',
      value: formatNumber(overview?.messages.ai),
    },
    {
      label: '转人工率',
      value: overview ? formatTransferRate(overview) : '—',
      sub: '会话口径；分母 = 窗口内创建或转人工的 SUPPORT/AI 会话（暂无列表下钻）',
    },
    {
      label: '模型错误率',
      value: formatRate(overview?.rates?.modelError),
      sub: formatFraction(overview?.rates?.modelError),
    },
    {
      label: '服务故障率',
      value: formatRate(overview?.rates?.serviceError),
      sub: formatFraction(overview?.rates?.serviceError),
    },
    {
      label: '误转率',
      value: formatRate(overview?.rates?.misTransfer),
      sub: formatFraction(overview?.rates?.misTransfer),
    },
    {
      label: '重复追问',
      value: formatNumber(overview?.feedback.repeatedQuestion),
      href: '/ai-ops/quality?queue=SIGNAL&signal=repeated_question',
    },
    {
      label: '用户放弃',
      value: formatNumber(overview?.feedback.abandoned),
      href: '/ai-ops/quality?queue=SIGNAL&signal=abandoned',
    },
    {
      label: '人工消息（客服回复）',
      value: formatNumber(overview?.messages.human),
    },
    {
      label: '疑似误转（信号区）',
      value: formatNumber(
        overview?.feedback.suspectedMisTransfer ??
          overview?.feedback.transferred,
      ),
      href: '/ai-ops/quality?signal=transferred',
    },
    {
      label: 'Token 用量',
      value: formatNumber(overview?.usage.totalTokens),
      href: '/ai-ops/usage',
    },
    {
      label: '请求数',
      value: formatNumber(overview?.usage.requests),
      href: '/ai-ops/usage',
    },
  ];

  return (
    <div className="space-y-5 p-4">
      <PageHeader
        title="运营洞察"
        description="AI 对话、转人工、反馈与用量的运营指标（UTC）"
      />

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <label className="flex items-center gap-2">
          <span className="text-xs text-gray-500">From</span>
          <input
            type="date"
            aria-label="From date"
            className="rounded-lg border px-3 py-1.5 dark:border-white/10 dark:bg-gray-800"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <span>→</span>
        <label className="flex items-center gap-2">
          <span className="text-xs text-gray-500">To</span>
          <input
            type="date"
            aria-label="To date"
            className="rounded-lg border px-3 py-1.5 dark:border-white/10 dark:bg-gray-800"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
        <span className="text-xs text-gray-500">
          时间范围：
          {overview?.range
            ? `${overview.range.from} → ${overview.range.to}`
            : `${from || '—'} → ${to || '—'}`}
          {' · '}
          {overview?.range?.timezone ?? 'UTC'}
        </span>
      </div>

      {invalidRange ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
          开始日期不能晚于结束日期，请调整筛选范围。
        </div>
      ) : loading ? (
        <div className="py-6 text-center text-sm text-gray-400">加载中…</div>
      ) : error ? (
        <AiErrorBanner message="洞察数据加载失败，请重试" onRetry={refresh} />
      ) : !overview ? (
        <div className="py-6 text-center text-sm text-gray-400">暂无数据</div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {kpis.map((kpi) => {
              const content = (
                <>
                  <div className="text-xs text-gray-500">{kpi.label}</div>
                  <div className="mt-1 text-2xl font-semibold">{kpi.value}</div>
                  {kpi.sub ? (
                    <div className="mt-1 text-xs text-gray-500">{kpi.sub}</div>
                  ) : null}
                </>
              );

              return kpi.href ? (
                <Link
                  key={kpi.label}
                  href={kpi.href}
                  className="rounded-xl border p-4 transition hover:border-blue-400 dark:border-white/10"
                >
                  {content}
                </Link>
              ) : (
                <div
                  key={kpi.label}
                  className="rounded-xl border p-4 dark:border-white/10"
                >
                  {content}
                </div>
              );
            })}
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <section className="rounded-xl border p-4 dark:border-white/10">
              <h2 className="mb-2 text-sm font-semibold">转人工原因</h2>
              {overview.transfers.byReason.length === 0 ? (
                <div className="py-4 text-sm text-gray-400">暂无</div>
              ) : (
                <table className="min-w-full text-sm">
                  <tbody>
                    {overview.transfers.byReason.map((item) => (
                      <tr
                        key={item.reason}
                        className="border-t dark:border-white/5"
                      >
                        <td className="py-1" title={item.reason}>
                          {labelOf(TRANSFER_REASON_LABELS, item.reason)}
                        </td>
                        <td className="py-1 text-right">{item.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>

            <section className="rounded-xl border p-4 dark:border-white/10">
              <h2 className="mb-2 text-sm font-semibold">反馈分诊状态</h2>
              {overview.feedback.byReviewStatus.length === 0 ? (
                <div className="py-4 text-sm text-gray-400">暂无</div>
              ) : (
                <table className="min-w-full text-sm">
                  <tbody>
                    {overview.feedback.byReviewStatus.map((item) => (
                      <tr
                        key={item.status}
                        className="border-t dark:border-white/5"
                      >
                        <td className="py-1" title={item.status}>
                          {labelOf(REVIEW_STATUS_LABELS, item.status)}
                        </td>
                        <td className="py-1 text-right">{item.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          </div>

          <div className="rounded-xl border p-4 text-xs text-gray-500 dark:border-white/10">
            {(overview.notes ?? []).map((note) => (
              <div key={note}>· {note}</div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
