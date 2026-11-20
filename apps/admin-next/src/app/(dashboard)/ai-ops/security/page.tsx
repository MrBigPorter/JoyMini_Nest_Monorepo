'use client';

import { useState } from 'react';
import { useRequest } from 'ahooks';
import { aiQualityApi } from '@/api';
import { PageHeader } from '@/components/scaffold/PageHeader';
import type { AiSecurityEventRow, AiSecuritySummary } from '@/type/types';

export default function AiSecurityPage() {
  const [type, setType] = useState('');
  const [page, setPage] = useState(1);
  const { data: summaryData } = useRequest(() =>
    aiQualityApi.securitySummary(),
  );
  const { data } = useRequest(
    () =>
      aiQualityApi.securityEvents({
        page,
        pageSize: 20,
        ...(type ? { type } : {}),
      }),
    { refreshDeps: [page, type], pollingInterval: 30_000 },
  );

  const summary = summaryData as AiSecuritySummary | undefined;
  const list = (data?.list ?? []) as AiSecurityEventRow[];
  const total = data?.total ?? 0;

  return (
    <div className="space-y-5 p-4">
      <PageHeader
        title="AI Security"
        description="注入检测命中（不存用户原文）；当前模式来自环境变量"
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border p-4 dark:border-white/10">
          <div className="text-xs text-gray-500">Detection mode</div>
          <div className="mt-1 text-xl font-semibold">
            {summary?.mode ?? '-'}
          </div>
        </div>
        <div className="rounded-xl border p-4 dark:border-white/10">
          <div className="text-xs text-gray-500">Total hits</div>
          <div className="mt-1 text-xl font-semibold">
            {summary?.total ?? 0}
          </div>
        </div>
        <div className="rounded-xl border p-4 dark:border-white/10">
          <div className="text-xs text-gray-500">Latest hit</div>
          <div className="mt-1 text-sm">
            {summary?.latestAt
              ? new Date(summary.latestAt).toLocaleString()
              : '-'}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-3 text-xs">
        {(summary?.byType ?? []).map((item) => (
          <span
            key={item.type}
            className="rounded-lg border px-2 py-1 dark:border-white/10"
          >
            {item.type}: {item.count}
          </span>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <select
          className="rounded-lg border px-3 py-1.5 text-sm dark:border-white/10 dark:bg-gray-800"
          value={type}
          onChange={(e) => {
            setType(e.target.value);
            setPage(1);
          }}
        >
          <option value="">All types</option>
          <option value="prompt_override">prompt_override</option>
          <option value="internal_probe">internal_probe</option>
          <option value="privilege_probe">privilege_probe</option>
        </select>
        <span className="text-xs text-gray-500">Total {total}</span>
      </div>

      <div className="overflow-x-auto rounded-xl border border-gray-100 dark:border-white/10">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-left dark:bg-white/5">
            <tr>
              {[
                'Time',
                'Type',
                'Mode',
                'Length',
                'User hash',
                'Conversation',
              ].map((h) => (
                <th key={h} className="px-3 py-2">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {list.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-gray-400">
                  暂无命中；若 mode=off，说明检测未启用
                </td>
              </tr>
            )}
            {list.map((row) => (
              <tr
                key={row.id}
                className="border-t border-gray-100 dark:border-white/5"
              >
                <td className="px-3 py-2">
                  {new Date(row.createdAt).toLocaleString()}
                </td>
                <td className="px-3 py-2">{row.type}</td>
                <td className="px-3 py-2">{row.mode}</td>
                <td className="px-3 py-2">{row.length}</td>
                <td className="px-3 py-2 font-mono text-xs">
                  {row.userIdHash?.slice(0, 10) ?? '-'}
                </td>
                <td className="px-3 py-2 font-mono text-xs">
                  {row.conversationId ?? '-'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
