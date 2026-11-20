'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRequest } from 'ahooks';
import { aiQualityApi } from '@/api';
import { PageHeader } from '@/components/scaffold/PageHeader';
import { AiErrorBanner } from '@/components/ai-ops/AiErrorBanner';
import type { SupportSlaSnapshotRow } from '@/type/types';

function formatWait(seconds: number): string {
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest > 0 ? `${minutes} 分 ${rest} 秒` : `${minutes} 分钟`;
}

export default function AiSupportPage() {
  const [hours, setHours] = useState(24);
  const { data, loading, error, refresh } = useRequest(
    () => aiQualityApi.slaHistory(hours),
    { refreshDeps: [hours], pollingInterval: 60_000 },
  );

  const latest = data?.latest as SupportSlaSnapshotRow | null | undefined;
  const snapshots = (data?.snapshots ?? []) as SupportSlaSnapshotRow[];
  const thresholdMinutes = data?.thresholdMinutes;
  const maxWaiting = Math.max(1, ...snapshots.map((s) => s.waiting));
  const visible = snapshots.slice(-120);

  return (
    <div className="space-y-5 p-4">
      <PageHeader
        title="转人工队列"
        description="转人工排队与 SLA 历史快照；只展示聚合值，不含用户信息"
      />

      {error ? (
        <AiErrorBanner
          message="SLA 数据加载失败，下面的数字可能不是最新。"
          onRetry={() => void refresh()}
        />
      ) : null}

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <select
          className="rounded-lg border px-3 py-1.5 dark:border-white/10 dark:bg-gray-800"
          value={hours}
          onChange={(e) => setHours(Number(e.target.value))}
        >
          <option value={6}>最近 6 小时</option>
          <option value={24}>最近 24 小时</option>
          <option value={72}>最近 72 小时</option>
          <option value={168}>最近 7 天</option>
        </select>
        {thresholdMinutes ? (
          <span className="text-xs text-gray-500">
            SLA 承诺：{thresholdMinutes} 分钟内响应
          </span>
        ) : null}
        {latest ? (
          <span className="text-xs text-gray-500">
            数据截止：{new Date(latest.createdAt).toLocaleString()}
          </span>
        ) : null}
        <Link
          className="rounded-lg border px-3 py-1.5 text-xs hover:bg-gray-50 dark:border-white/10 dark:hover:bg-white/5"
          href="/customer-service"
        >
          打开客服工作台
        </Link>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border p-4 dark:border-white/10">
          <div className="text-xs text-gray-500">当前等待</div>
          <div className="mt-1 text-2xl font-semibold">
            {error ? '—' : (latest?.waiting ?? '—')}
          </div>
          <div className="mt-1 text-xs text-gray-400">等待人工接入的会话</div>
        </div>
        <div className="rounded-xl border p-4 dark:border-white/10">
          <div className="text-xs text-gray-500">超过 SLA</div>
          <div className="mt-1 text-2xl font-semibold">
            {error ? '—' : (latest?.breached ?? '—')}
          </div>
          <div className="mt-1 text-xs text-gray-400">
            {thresholdMinutes
              ? `等待超过 ${thresholdMinutes} 分钟`
              : '等待超过承诺时间'}
          </div>
        </div>
        <div className="rounded-xl border p-4 dark:border-white/10">
          <div className="text-xs text-gray-500">最长等待</div>
          <div className="mt-1 text-2xl font-semibold">
            {latest ? formatWait(latest.longestWait) : '—'}
          </div>
          <div className="mt-1 text-xs text-gray-400">当前排队最久的会话</div>
        </div>
      </div>

      <section className="rounded-xl border border-gray-100 bg-white p-4 dark:border-white/10 dark:bg-gray-900">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">等待趋势</h2>
          <span className="text-xs text-gray-500">
            图表显示最近约 2 小时；表格显示最近 50 条
          </span>
        </div>
        {loading ? (
          <div className="py-6 text-center text-sm text-gray-400">
            Loading...
          </div>
        ) : error ? (
          <div className="py-6 text-center text-sm text-red-500">
            SLA 数据加载失败
          </div>
        ) : snapshots.length === 0 ? (
          <div className="py-6 text-center text-sm text-gray-400">
            暂无快照；cron 每分钟写入一次
          </div>
        ) : (
          <>
            <div className="flex h-32 items-end gap-[2px]">
              {visible.map((s) => (
                <div
                  key={s.id}
                  className="flex-1 rounded-t bg-blue-500/70"
                  style={{
                    height: `${Math.max(4, (s.waiting / maxWaiting) * 100)}%`,
                  }}
                  title={`${new Date(s.createdAt).toLocaleString()} waiting=${s.waiting} breached=${s.breached}`}
                />
              ))}
            </div>
            <div className="mt-3 max-h-64 overflow-y-auto">
              <table className="min-w-full text-xs">
                <thead className="text-left text-gray-500">
                  <tr>
                    <th className="py-1">时间</th>
                    <th className="py-1">等待</th>
                    <th className="py-1">超 SLA</th>
                    <th className="py-1">最长等待</th>
                  </tr>
                </thead>
                <tbody>
                  {[...snapshots]
                    .reverse()
                    .slice(0, 50)
                    .map((s) => (
                      <tr key={s.id} className="border-t dark:border-white/5">
                        <td className="py-1">
                          {new Date(s.createdAt).toLocaleString()}
                        </td>
                        <td className="py-1">{s.waiting}</td>
                        <td className="py-1">{s.breached}</td>
                        <td className="py-1">{formatWait(s.longestWait)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
