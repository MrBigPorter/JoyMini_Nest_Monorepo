'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRequest } from 'ahooks';
import { Button } from '@repo/ui';
import { aiQualityApi } from '@/api';
import { PageHeader } from '@/components/scaffold/PageHeader';
import { AiErrorBanner } from '@/components/ai-ops/AiErrorBanner';
import {
  canReadContext,
  canTriageSecurity,
  useAiOpsRole,
} from '@/lib/ai-ops-permissions';
import type { AiSecurityEventRow, AiSecuritySummary } from '@/type/types';

const PAGE_SIZE = 20;

const SECURITY_TYPE_LABELS: Record<string, string> = {
  prompt_override: '指令覆盖/越狱',
  internal_probe: '内部信息探测',
  privilege_probe: '越权/冒充管理员',
};

const SECURITY_MODE_LABELS: Record<string, string> = {
  off: '关闭（不检测）',
  log: '仅记录（不拦截）',
  enforce: '拦截（拒绝并降级）',
};

const SECURITY_TYPE_OPTIONS = Object.entries(SECURITY_TYPE_LABELS).map(
  ([value, label]) => ({ value, label }),
);

const SECURITY_STATUS_LABELS: Record<string, string> = {
  NEW: '待处理',
  CONFIRMED: '已确认攻击',
  FALSE_POSITIVE: '误报',
  BLOCKED: '已拦截',
};

function labelOf(map: Record<string, string>, raw: string): string {
  return map[raw] ?? raw;
}

export default function AiSecurityPage() {
  const [type, setType] = useState('');
  const [status, setStatus] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const role = useAiOpsRole();
  const canOpenContext = canReadContext(role);
  const canTriage = canTriageSecurity(role);

  const {
    data: summaryData,
    loading: summaryLoading,
    error: summaryError,
    refresh: refreshSummary,
  } = useRequest(
    () =>
      aiQualityApi.securitySummary({
        ...(type ? { type } : {}),
        ...(status ? { status } : {}),
        ...(from ? { from } : {}),
        ...(to ? { to } : {}),
      }),
    { refreshDeps: [type, status, from, to], pollingInterval: 30_000 },
  );

  const {
    data,
    loading,
    error,
    refresh: refreshList,
  } = useRequest(
    () =>
      aiQualityApi.securityEvents({
        page,
        pageSize: PAGE_SIZE,
        ...(type ? { type } : {}),
        ...(status ? { status } : {}),
        ...(from ? { from } : {}),
        ...(to ? { to } : {}),
      }),
    {
      refreshDeps: [page, type, status, from, to],
      pollingInterval: 30_000,
    },
  );

  const summary = summaryData as AiSecuritySummary | undefined;
  const list = (data?.list ?? []) as AiSecurityEventRow[];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const resetPage = () => setPage(1);

  return (
    <div className="space-y-5 p-4">
      <PageHeader
        title="安全事件"
        description="注入检测命中汇总与明细（不存用户原文）；当前模式来自环境变量"
      />

      {summaryError ? (
        <AiErrorBanner
          message="安全汇总加载失败，请重试"
          onRetry={refreshSummary}
        />
      ) : null}

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border p-4 dark:border-white/10">
          <div className="text-xs text-gray-500">Detection mode</div>
          <div
            className="mt-1 text-xl font-semibold"
            title={summary?.mode ?? undefined}
          >
            {summary
              ? labelOf(SECURITY_MODE_LABELS, summary.mode)
              : summaryLoading
                ? '加载中…'
                : '—'}
          </div>
        </div>
        <div className="rounded-xl border p-4 dark:border-white/10">
          <div className="text-xs text-gray-500">Total hits</div>
          <div className="mt-1 text-xl font-semibold">
            {summary
              ? summary.total.toLocaleString()
              : summaryLoading
                ? '加载中…'
                : '—'}
          </div>
        </div>
        <div className="rounded-xl border p-4 dark:border-white/10">
          <div className="text-xs text-gray-500">Latest hit</div>
          <div className="mt-1 text-sm">
            {summary?.latestAt
              ? new Date(summary.latestAt).toLocaleString()
              : summaryLoading
                ? '加载中…'
                : '-'}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-gray-500">按类型</span>
        {(summary?.byType ?? []).map((item) => (
          <span
            key={item.type}
            title={item.type}
            className="rounded-lg border px-2 py-1 dark:border-white/10"
          >
            {labelOf(SECURITY_TYPE_LABELS, item.type)}: {item.count}
          </span>
        ))}
        {summary && summary.byType.length === 0 ? (
          <span className="text-gray-400">暂无</span>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-gray-500">按模式</span>
        {(summary?.byMode ?? []).map((item) => (
          <span
            key={item.mode}
            title={item.mode}
            className="rounded-lg border px-2 py-1 dark:border-white/10"
          >
            {labelOf(SECURITY_MODE_LABELS, item.mode)}: {item.count}
          </span>
        ))}
        {summary && summary.byMode.length === 0 ? (
          <span className="text-gray-400">暂无</span>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-gray-500">按状态</span>
        {(summary?.byStatus ?? []).map((item) => (
          <span
            key={item.status}
            title={item.status}
            className="rounded-lg border px-2 py-1 dark:border-white/10"
          >
            {labelOf(SECURITY_STATUS_LABELS, item.status)}: {item.count}
          </span>
        ))}
        {summary && (summary.byStatus ?? []).length === 0 ? (
          <span className="text-gray-400">暂无</span>
        ) : null}
      </div>

      <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3 text-xs text-gray-600 dark:border-white/10 dark:bg-white/5 dark:text-gray-400">
        检测模式：off = 不检测；log = 只记录，不改变回答；enforce（拦截）=
        拒绝并降级。事件仅记录类型、模式与长度，不存用户原文。
      </div>

      <div className="flex flex-wrap items-end gap-3 text-sm">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-gray-500">类型</span>
          <select
            aria-label="Security type"
            className="rounded-lg border px-3 py-1.5 dark:border-white/10 dark:bg-gray-800"
            value={type}
            onChange={(e) => {
              setType(e.target.value);
              resetPage();
            }}
          >
            <option value="">全部类型</option>
            {SECURITY_TYPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-gray-500">状态</span>
          <select
            aria-label="Security status"
            className="rounded-lg border px-3 py-1.5 dark:border-white/10 dark:bg-gray-800"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              resetPage();
            }}
          >
            <option value="">全部状态</option>
            {Object.entries(SECURITY_STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-gray-500">From</span>
          <input
            type="date"
            aria-label="From date"
            className="rounded-lg border px-3 py-1.5 dark:border-white/10 dark:bg-gray-800"
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
              resetPage();
            }}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-gray-500">To</span>
          <input
            type="date"
            aria-label="To date"
            className="rounded-lg border px-3 py-1.5 dark:border-white/10 dark:bg-gray-800"
            value={to}
            onChange={(e) => {
              setTo(e.target.value);
              resetPage();
            }}
          />
        </label>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setType('');
            setStatus('');
            setFrom('');
            setTo('');
            resetPage();
          }}
        >
          重置
        </Button>
        <span className="text-xs text-gray-500">共 {total} 条</span>
      </div>

      {error ? (
        <AiErrorBanner
          message="命中列表加载失败，请重试"
          onRetry={refreshList}
        />
      ) : null}

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
                '状态',
                '操作',
              ].map((h) => (
                <th key={h} className="px-3 py-2">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && list.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-gray-400">
                  Loading...
                </td>
              </tr>
            )}
            {!loading && error && list.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-red-500">
                  加载失败，请重试
                </td>
              </tr>
            )}
            {!loading && !error && list.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-gray-400">
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
                <td className="px-3 py-2" title={row.type}>
                  {labelOf(SECURITY_TYPE_LABELS, row.type)}
                </td>
                <td className="px-3 py-2" title={row.mode}>
                  {labelOf(SECURITY_MODE_LABELS, row.mode)}
                </td>
                <td className="px-3 py-2">{row.length}</td>
                <td className="px-3 py-2 font-mono text-xs">
                  {row.userIdHash?.slice(0, 10) ?? '-'}
                </td>
                <td className="px-3 py-2 font-mono text-xs">
                  {row.conversationId ? (
                    canOpenContext ? (
                      <Link
                        href={`/ai-ops/context?conversationId=${encodeURIComponent(
                          row.conversationId,
                        )}`}
                        className="text-blue-600 hover:underline"
                      >
                        {row.conversationId}
                      </Link>
                    ) : (
                      row.conversationId
                    )
                  ) : (
                    '-'
                  )}
                </td>
                <td className="px-3 py-2" title={row.status}>
                  {labelOf(SECURITY_STATUS_LABELS, row.status ?? 'NEW')}
                </td>
                <td className="px-3 py-2">
                  {canTriage ? (
                    <div className="flex flex-wrap gap-1">
                      {[
                        ['CONFIRMED', '确认攻击'],
                        ['FALSE_POSITIVE', '误报'],
                        ['BLOCKED', '已拦截'],
                      ].map(([next, label]) => (
                        <button
                          key={next}
                          type="button"
                          className="rounded border px-2 py-0.5 text-xs hover:bg-gray-50 dark:border-white/10 dark:hover:bg-white/5"
                          onClick={async () => {
                            const note =
                              window.prompt('处置备注（可选）') ?? undefined;
                            if (!window.confirm(`确认标记为「${label}」？`))
                              return;
                            try {
                              await aiQualityApi.securityTriage(row.id, {
                                status: next,
                                note,
                              });
                              await Promise.all([
                                refreshList(),
                                refreshSummary(),
                              ]);
                            } catch (err: any) {
                              window.alert(err?.message ?? '处置失败');
                            }
                          }}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <span className="text-xs text-gray-400">只读</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="text-gray-500">
          第 {page} / {totalPages} 页 · 每页 {PAGE_SIZE} 条
        </span>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            上一页
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >
            下一页
          </Button>
        </div>
      </div>
    </div>
  );
}
