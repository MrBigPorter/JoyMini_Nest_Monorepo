'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRequest } from 'ahooks';
import { aiOpsApi } from '@/api';
import { PageHeader } from '@/components/scaffold/PageHeader';
import { AiErrorBanner } from '@/components/ai-ops/AiErrorBanner';
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

  const {
    data: summaryData,
    loading: summaryLoading,
    error: summaryError,
    refresh: refreshSummary,
  } = useRequest(() => aiOpsApi.getUsageSummary({ from, to }), {
    refreshDeps: [from, to],
  });
  const {
    data: usersData,
    loading: usersLoading,
    error: usersError,
    refresh: refreshUsers,
  } = useRequest(
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
        title="用量与成本"
        description="AI 客服主链路 token 与预估成本（UTC；仅成功流，不含 blog-ai / embedding / eval）"
      />

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <label className="text-gray-500">From</label>
        <input
          type="date"
          className="rounded-lg border px-3 py-1.5 dark:border-white/10 dark:bg-gray-800"
          value={from}
          onChange={(e) => {
            setFrom(e.target.value);
            setPage(1);
          }}
        />
        <label className="text-gray-500">To</label>
        <input
          type="date"
          className="rounded-lg border px-3 py-1.5 dark:border-white/10 dark:bg-gray-800"
          value={to}
          onChange={(e) => {
            setTo(e.target.value);
            setPage(1);
          }}
        />
      </div>

      {summaryError || usersError ? (
        <AiErrorBanner
          message="用量数据加载失败，下面的数字可能不完整。"
          onRetry={() => {
            void refreshSummary();
            void refreshUsers();
          }}
        />
      ) : null}

      {summaryLoading ? (
        <div className="py-6 text-center text-sm text-gray-400">Loading...</div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-xl border border-gray-100 bg-white p-4 dark:border-white/10 dark:bg-gray-900">
              <div className="text-xs text-gray-500">Total Tokens</div>
              <div className="mt-1 text-2xl font-semibold">
                {summary?.totals.totalTokens.toLocaleString() ?? '—'}
              </div>
            </div>
            <div className="rounded-xl border border-gray-100 bg-white p-4 dark:border-white/10 dark:bg-gray-900">
              <div className="text-xs text-gray-500">Requests</div>
              <div className="mt-1 text-2xl font-semibold">
                {summary?.totals.requests.toLocaleString() ?? '—'}
              </div>
            </div>
            <div className="rounded-xl border border-gray-100 bg-white p-4 dark:border-white/10 dark:bg-gray-900">
              <div className="text-xs text-gray-500">Users</div>
              <div className="mt-1 text-2xl font-semibold">
                {summary?.totals.users.toLocaleString() ?? '—'}
              </div>
            </div>
            <div className="rounded-xl border border-gray-100 bg-white p-4 dark:border-white/10 dark:bg-gray-900">
              <div className="text-xs text-gray-500">
                预估成本（{summary?.cost.currency ?? 'USD'}）
              </div>
              <div className="mt-1 text-2xl font-semibold">
                {summary?.cost.configured
                  ? summary.cost.totalCost.toFixed(4)
                  : '未配置单价'}
              </div>
              <div className="mt-1 text-xs text-gray-400">
                每日 token 限额：
                {summary?.quota.dailyTokenLimit.toLocaleString() ?? '—'}
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-gray-100 bg-white p-4 text-xs text-gray-500 dark:border-white/10 dark:bg-gray-900">
            口径：{summary?.coverage.note}
            {!summary?.pricing.configured
              ? ' 成本需要配置 AI_PRICE_INPUT_PER_1M / AI_PRICE_OUTPUT_PER_1M。'
              : ` 单价：输入 ${summary.pricing.inputPer1M}/${summary.pricing.currency}/1M，输出 ${summary.pricing.outputPer1M}/${summary.pricing.currency}/1M。`}
          </div>

          {summary?.daily?.length ? (
            <section className="rounded-xl border border-gray-100 bg-white p-4 dark:border-white/10 dark:bg-gray-900">
              <h2 className="mb-3 text-sm font-semibold">按天</h2>
              <div className="max-h-64 overflow-y-auto">
                <table className="min-w-full text-xs">
                  <thead className="text-left text-gray-500">
                    <tr>
                      <th className="py-1">日期</th>
                      <th className="py-1">Tokens</th>
                      <th className="py-1">Requests</th>
                      <th className="py-1">预估成本</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.daily.map((day) => (
                      <tr key={day.date} className="border-t dark:border-white/5">
                        <td className="py-1">{day.date}</td>
                        <td className="py-1">{day.totalTokens.toLocaleString()}</td>
                        <td className="py-1">{day.requests}</td>
                        <td className="py-1">
                          {day.configured ? day.totalCost.toFixed(4) : '未配置'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}
        </>
      )}

      <section className="rounded-xl border border-gray-100 bg-white p-4 dark:border-white/10 dark:bg-gray-900">
        <h2 className="mb-3 text-sm font-semibold">按用户</h2>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-left dark:bg-white/5">
              <tr>
                {[
                  'User',
                  'Phone',
                  'Total',
                  'Cost',
                  'Prompt',
                  'Completion',
                  'Requests',
                  '单日最高',
                  '单日超限',
                  '详情',
                ].map((h) => (
                  <th key={h} className="px-3 py-2">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {usersLoading && (
                <tr>
                  <td
                    colSpan={10}
                    className="px-3 py-6 text-center text-gray-400"
                  >
                    Loading...
                  </td>
                </tr>
              )}
              {!usersLoading && !usersError && (users?.list.length ?? 0) === 0 && (
                <tr>
                  <td
                    colSpan={10}
                    className="px-3 py-6 text-center text-gray-400"
                  >
                    该时间段没有 AI 用量
                  </td>
                </tr>
              )}
              {users?.list.map((u) => (
                <tr
                  key={u.userId}
                  className="border-t border-gray-100 dark:border-white/5"
                >
                  <td className="px-3 py-2">
                    <div className="font-medium">
                      {u.nickname ?? '(unknown)'}
                    </div>
                    <div className="font-mono text-xs text-gray-400">
                      {u.userId}
                    </div>
                  </td>
                  <td className="px-3 py-2">{u.phoneMasked ?? '-'}</td>
                  <td className="px-3 py-2">
                    {u.totalTokens.toLocaleString()}
                  </td>
                  <td className="px-3 py-2">
                    {summary?.pricing.configured
                      ? `${(u.estimatedCost ?? 0).toFixed(4)}`
                      : '未配置'}
                  </td>
                  <td className="px-3 py-2">
                    {u.promptTokens.toLocaleString()}
                  </td>
                  <td className="px-3 py-2">
                    {u.completionTokens.toLocaleString()}
                  </td>
                  <td className="px-3 py-2">{u.requests}</td>
                  <td className="px-3 py-2">
                    {(u.maxDailyTokens ?? 0).toLocaleString()}
                  </td>
                  <td className="px-3 py-2">{u.overDailyLimit ? '是' : '-'}</td>
                  <td className="px-3 py-2">
                    <Link
                      href={`/ai-ops/usage/${u.userId}`}
                      className="text-blue-600 hover:underline dark:text-blue-400"
                    >
                      查看
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-3 flex items-center justify-between text-sm">
          <span className="text-gray-500">Total {users?.total ?? 0}</span>
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
