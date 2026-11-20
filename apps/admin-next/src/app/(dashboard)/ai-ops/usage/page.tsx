'use client';

import { useState } from 'react';
import { useRequest } from 'ahooks';
import { aiOpsApi } from '@/api';
import { PageHeader } from '@/components/scaffold/PageHeader';
import type { AiUsageSummary, AiUsageUser } from '@/type/types';

function isoDaysAgo(days: number) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

export default function AiUsagePage() {
  const [from, setFrom] = useState(isoDaysAgo(7));
  const [to, setTo] = useState(isoDaysAgo(0));
  const [page, setPage] = useState(1);

  const { data: summaryData, loading: summaryLoading } = useRequest(
    () => aiOpsApi.getUsageSummary({ from, to }),
    { refreshDeps: [from, to] },
  );
  const { data: usersData, loading: usersLoading } = useRequest(
    () => aiOpsApi.getUsageUsers({ from, to, page, pageSize: 20 }),
    { refreshDeps: [from, to, page] },
  );

  const summary = summaryData as AiUsageSummary | undefined;
  const users = usersData as
    | { list: AiUsageUser[]; total: number; page: number; pageSize: number }
    | undefined;

  return (
    <div className="space-y-5 p-4">
      <PageHeader
        title="AI Usage"
        description="AI 客服主链路 token 用量（UTC；仅成功流，不含 blog-ai / embedding / eval）"
      />

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <label className="text-gray-500">From</label>
        <input
          type="date"
          className="rounded-lg border px-3 py-1.5 dark:border-white/10 dark:bg-gray-800"
          value={from}
          onChange={(e) => { setFrom(e.target.value); setPage(1); }}
        />
        <label className="text-gray-500">To</label>
        <input
          type="date"
          className="rounded-lg border px-3 py-1.5 dark:border-white/10 dark:bg-gray-800"
          value={to}
          onChange={(e) => { setTo(e.target.value); setPage(1); }}
        />
      </div>

      {summaryLoading ? (
        <div className="py-6 text-center text-sm text-gray-400">Loading...</div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[
              ['Total Tokens', summary?.totals.totalTokens],
              ['Requests', summary?.totals.requests],
              ['Users', summary?.totals.users],
              ['Daily Limit', summary?.quota.dailyTokenLimit],
            ].map(([label, value]) => (
              <div
                key={String(label)}
                className="rounded-xl border border-gray-100 bg-white p-4 dark:border-white/10 dark:bg-gray-900"
              >
                <div className="text-xs text-gray-500">{label}</div>
                <div className="mt-1 text-2xl font-semibold">
                  {typeof value === 'number' ? value.toLocaleString() : '—'}
                </div>
              </div>
            ))}
          </div>

          <div className="rounded-xl border border-gray-100 bg-white p-4 text-xs text-gray-500 dark:border-white/10 dark:bg-gray-900">
            口径：{summary?.coverage.note}
          </div>
        </>
      )}

      <section className="rounded-xl border border-gray-100 bg-white p-4 dark:border-white/10 dark:bg-gray-900">
        <h2 className="mb-3 text-sm font-semibold">按用户</h2>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-left dark:bg-white/5">
              <tr>
                {['User', 'Phone', 'Total', 'Prompt', 'Completion', 'Requests', 'Over limit'].map((h) => (
                  <th key={h} className="px-3 py-2">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {usersLoading && (
                <tr><td colSpan={7} className="px-3 py-6 text-center text-gray-400">Loading...</td></tr>
              )}
              {!usersLoading && (users?.list.length ?? 0) === 0 && (
                <tr><td colSpan={7} className="px-3 py-6 text-center text-gray-400">
                  该时间段没有 AI 用量
                </td></tr>
              )}
              {users?.list.map((u) => (
                <tr key={u.userId} className="border-t border-gray-100 dark:border-white/5">
                  <td className="px-3 py-2">
                    <div className="font-medium">{u.nickname ?? '(unknown)'}</div>
                    <div className="font-mono text-xs text-gray-400">{u.userId}</div>
                  </td>
                  <td className="px-3 py-2">{u.phoneMasked ?? '-'}</td>
                  <td className="px-3 py-2">{u.totalTokens.toLocaleString()}</td>
                  <td className="px-3 py-2">{u.promptTokens.toLocaleString()}</td>
                  <td className="px-3 py-2">{u.completionTokens.toLocaleString()}</td>
                  <td className="px-3 py-2">{u.requests}</td>
                  <td className="px-3 py-2">{u.overDailyLimit ? '是' : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-3 flex items-center justify-between text-sm">
          <span className="text-gray-500">
            Total {users?.total ?? 0}
          </span>
          <div className="flex gap-2">
            <button
              className="rounded-lg border px-3 py-1.5 disabled:opacity-40"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Prev
            </button>
            <button
              className="rounded-lg border px-3 py-1.5 disabled:opacity-40"
              disabled={!users || page * users.pageSize >= users.total}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
