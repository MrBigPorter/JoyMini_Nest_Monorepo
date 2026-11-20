'use client';

import { useState } from 'react';
import { useRequest } from 'ahooks';
import { aiQualityApi } from '@/api';
import { PageHeader } from '@/components/scaffold/PageHeader';
import type { AiInsightsOverview } from '@/type/types';

function isoDaysAgo(days: number) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

export default function AiInsightsPage() {
  const [from, setFrom] = useState(isoDaysAgo(7));
  const [to, setTo] = useState(isoDaysAgo(0));
  const { data, loading } = useRequest(
    () => aiQualityApi.insightsOverview({ from, to }),
    { refreshDeps: [from, to] },
  );
  const overview = data as AiInsightsOverview | undefined;

  return (
    <div className="space-y-5 p-4">
      <PageHeader
        title="AI Insights"
        description="AI 对话、转人工、反馈与用量的运营指标（UTC）"
      />

      <div className="flex items-center gap-2 text-sm">
        <input
          type="date"
          className="rounded-lg border px-3 py-1.5 dark:border-white/10 dark:bg-gray-800"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        />
        <span>→</span>
        <input
          type="date"
          className="rounded-lg border px-3 py-1.5 dark:border-white/10 dark:bg-gray-800"
          value={to}
          onChange={(e) => setTo(e.target.value)}
        />
      </div>

      {loading ? (
        <div className="py-6 text-center text-sm text-gray-400">Loading...</div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[
              ['Conversations', overview?.conversations],
              ['AI messages', overview?.messages.ai],
              ['Transfer rate', overview?.transfers.rate],
              ['Repeated questions', overview?.feedback.repeatedQuestion],
              ['Abandoned', overview?.feedback.abandoned],
              ['Human messages', overview?.messages.human],
              ['Total tokens', overview?.usage.totalTokens],
              ['Requests', overview?.usage.requests],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-xl border p-4 dark:border-white/10">
                <div className="text-xs text-gray-500">{label}</div>
                <div className="mt-1 text-2xl font-semibold">
                  {typeof value === 'number' ? value.toLocaleString() : '—'}
                </div>
              </div>
            ))}
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <section className="rounded-xl border p-4 dark:border-white/10">
              <h2 className="mb-2 text-sm font-semibold">转人工原因</h2>
              {(overview?.transfers.byReason ?? []).length === 0 ? (
                <div className="py-4 text-sm text-gray-400">暂无</div>
              ) : (
                <table className="min-w-full text-sm">
                  <tbody>
                    {overview?.transfers.byReason.map((item) => (
                      <tr key={item.reason} className="border-t dark:border-white/5">
                        <td className="py-1">{item.reason}</td>
                        <td className="py-1 text-right">{item.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>

            <section className="rounded-xl border p-4 dark:border-white/10">
              <h2 className="mb-2 text-sm font-semibold">反馈分诊状态</h2>
              {(overview?.feedback.byReviewStatus ?? []).length === 0 ? (
                <div className="py-4 text-sm text-gray-400">暂无</div>
              ) : (
                <table className="min-w-full text-sm">
                  <tbody>
                    {overview?.feedback.byReviewStatus.map((item) => (
                      <tr key={item.status} className="border-t dark:border-white/5">
                        <td className="py-1">{item.status}</td>
                        <td className="py-1 text-right">{item.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          </div>

          <div className="rounded-xl border p-4 text-xs text-gray-500 dark:border-white/10">
            {(overview?.notes ?? []).map((note) => (
              <div key={note}>· {note}</div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
