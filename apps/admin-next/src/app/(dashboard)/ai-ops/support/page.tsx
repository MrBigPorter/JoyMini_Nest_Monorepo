'use client';

import { useState } from 'react';
import { useRequest } from 'ahooks';
import { aiQualityApi } from '@/api';
import { PageHeader } from '@/components/scaffold/PageHeader';
import type { SupportSlaSnapshotRow } from '@/type/types';

export default function AiSupportPage() {
  const [hours, setHours] = useState(24);
  const { data, loading } = useRequest(() => aiQualityApi.slaHistory(hours), {
    refreshDeps: [hours],
    pollingInterval: 60_000,
  });

  const latest = data?.latest as SupportSlaSnapshotRow | null | undefined;
  const snapshots = (data?.snapshots ?? []) as SupportSlaSnapshotRow[];
  const maxWaiting = Math.max(1, ...snapshots.map((s) => s.waiting));

  return (
    <div className="space-y-5 p-4">
      <PageHeader
        title="Support Ops"
        description="转人工排队与 SLA 历史快照（每分钟一次，不含用户信息）"
      />

      <div className="flex items-center gap-2">
        <select
          className="rounded-lg border px-3 py-1.5 text-sm dark:border-white/10 dark:bg-gray-800"
          value={hours}
          onChange={(e) => setHours(Number(e.target.value))}
        >
          <option value={6}>Last 6h</option>
          <option value={24}>Last 24h</option>
          <option value={72}>Last 72h</option>
          <option value={168}>Last 7d</option>
        </select>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border p-4 dark:border-white/10">
          <div className="text-xs text-gray-500">Waiting</div>
          <div className="mt-1 text-2xl font-semibold">
            {latest?.waiting ?? '—'}
          </div>
        </div>
        <div className="rounded-xl border p-4 dark:border-white/10">
          <div className="text-xs text-gray-500">SLA breached</div>
          <div className="mt-1 text-2xl font-semibold">
            {latest?.breached ?? '—'}
          </div>
        </div>
        <div className="rounded-xl border p-4 dark:border-white/10">
          <div className="text-xs text-gray-500">Longest wait</div>
          <div className="mt-1 text-2xl font-semibold">
            {latest ? `${latest.longestWait}s` : '—'}
          </div>
        </div>
      </div>

      <section className="rounded-xl border border-gray-100 bg-white p-4 dark:border-white/10 dark:bg-gray-900">
        <h2 className="mb-3 text-sm font-semibold">Waiting trend</h2>
        {loading ? (
          <div className="py-6 text-center text-sm text-gray-400">
            Loading...
          </div>
        ) : snapshots.length === 0 ? (
          <div className="py-6 text-center text-sm text-gray-400">
            暂无快照；cron 每分钟写入一次
          </div>
        ) : (
          <>
            <div className="flex h-32 items-end gap-[2px]">
              {snapshots.slice(-120).map((s) => (
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
                    <th className="py-1">Time</th>
                    <th className="py-1">Waiting</th>
                    <th className="py-1">Breached</th>
                    <th className="py-1">Longest</th>
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
                        <td className="py-1">{s.longestWait}s</td>
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
