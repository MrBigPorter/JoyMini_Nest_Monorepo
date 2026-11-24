'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { useRequest } from 'ahooks';
import { aiOpsApi } from '@/api';
import { PageHeader } from '@/components/scaffold/PageHeader';
import { AiErrorBanner } from '@/components/ai-ops/AiErrorBanner';
import type { AiUsageUserDetail } from '@/type/types';

function isoDaysAgo(days: number) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

/**
 * 单用户 AI 用量详情（`admin-ai-governance-console` 2.5）。
 * 数据来自 `GET /admin/ai-usage/users/:userId`：按天 token、成本与限额判断。
 * 手机号由服务端脱敏，前端不再二次处理。
 */
export default function AiUsageUserDetailPage() {
  const params = useParams<{ userId: string }>();
  const userId = params?.userId ?? '';
  const [from, setFrom] = useState(isoDaysAgo(7));
  const [to, setTo] = useState(isoDaysAgo(0));

  const { data, loading, error, refresh } = useRequest(
    () => aiOpsApi.getUserUsage(userId, { from, to }),
    { refreshDeps: [userId, from, to], ready: Boolean(userId) },
  );

  const detail = data as AiUsageUserDetail | undefined;
  const nickname = detail?.user.nickname ?? '(unknown)';
  const overDays = detail?.daily.filter((d) => d.overDailyLimit) ?? [];

  return (
    <div className="space-y-5 p-4">
      <PageHeader
        title="用户用量详情"
        description="单用户 AI 客服 token 与预估成本（UTC；仅成功流）"
        showBackButton
        backButtonLabel="返回用量"
      />

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <label className="text-gray-500">From</label>
        <input
          type="date"
          className="rounded-lg border px-3 py-1.5 dark:border-white/10 dark:bg-gray-800"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        />
        <label className="text-gray-500">To</label>
        <input
          type="date"
          className="rounded-lg border px-3 py-1.5 dark:border-white/10 dark:bg-gray-800"
          value={to}
          onChange={(e) => setTo(e.target.value)}
        />
      </div>

      {error ? (
        <AiErrorBanner
          message="用户用量加载失败。"
          onRetry={() => void refresh()}
        />
      ) : null}

      {loading ? (
        <div className="py-6 text-center text-sm text-gray-400">Loading...</div>
      ) : !detail ? (
        <div className="py-6 text-center text-sm text-gray-400">
          没有该用户的用量数据
        </div>
      ) : (
        <>
          <section className="rounded-xl border border-gray-100 bg-white p-4 dark:border-white/10 dark:bg-gray-900">
            <div className="text-lg font-semibold">{nickname}</div>
            <div className="mt-1 font-mono text-xs text-gray-400">
              {detail.user.id}
            </div>
            <div className="mt-1 text-sm text-gray-500">
              手机号：{detail.user.phone ?? '-'}
            </div>
          </section>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-xl border border-gray-100 bg-white p-4 dark:border-white/10 dark:bg-gray-900">
              <div className="text-xs text-gray-500">Total Tokens</div>
              <div className="mt-1 text-2xl font-semibold">
                {detail.totals.totalTokens.toLocaleString()}
              </div>
            </div>
            <div className="rounded-xl border border-gray-100 bg-white p-4 dark:border-white/10 dark:bg-gray-900">
              <div className="text-xs text-gray-500">Requests</div>
              <div className="mt-1 text-2xl font-semibold">
                {detail.totals.requests.toLocaleString()}
              </div>
            </div>
            <div className="rounded-xl border border-gray-100 bg-white p-4 dark:border-white/10 dark:bg-gray-900">
              <div className="text-xs text-gray-500">
                预估成本（{detail.cost.currency}）
              </div>
              <div className="mt-1 text-2xl font-semibold">
                {detail.cost.configured
                  ? detail.cost.totalCost.toFixed(4)
                  : '未配置单价'}
              </div>
            </div>
            <div className="rounded-xl border border-gray-100 bg-white p-4 dark:border-white/10 dark:bg-gray-900">
              <div className="text-xs text-gray-500">每日 token 限额</div>
              <div className="mt-1 text-2xl font-semibold">
                {detail.quota.dailyTokenLimit.toLocaleString()}
              </div>
              <div className="mt-1 text-xs text-gray-400">
                超限天数：{overDays.length}
              </div>
            </div>
          </div>

          <section className="rounded-xl border border-gray-100 bg-white p-4 dark:border-white/10 dark:bg-gray-900">
            <h2 className="mb-3 text-sm font-semibold">按天</h2>
            {detail.daily.length === 0 ? (
              <div className="py-4 text-center text-sm text-gray-400">
                该时间段没有用量
              </div>
            ) : (
              <div className="max-h-96 overflow-y-auto">
                <table className="min-w-full text-xs">
                  <thead className="text-left text-gray-500">
                    <tr>
                      <th className="py-1">日期</th>
                      <th className="py-1">Prompt</th>
                      <th className="py-1">Completion</th>
                      <th className="py-1">Tokens</th>
                      <th className="py-1">Requests</th>
                      <th className="py-1">超限</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.daily.map((day) => (
                      <tr
                        key={day.date}
                        className="border-t dark:border-white/5"
                      >
                        <td className="py-1">{day.date}</td>
                        <td className="py-1">
                          {day.promptTokens.toLocaleString()}
                        </td>
                        <td className="py-1">
                          {day.completionTokens.toLocaleString()}
                        </td>
                        <td className="py-1">
                          {day.totalTokens.toLocaleString()}
                        </td>
                        <td className="py-1">{day.requests}</td>
                        <td
                          className={
                            day.overDailyLimit
                              ? 'py-1 font-medium text-amber-600'
                              : 'py-1'
                          }
                        >
                          {day.overDailyLimit ? '是' : '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
