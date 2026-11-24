'use client';

import { useMemo, useState } from 'react';
import { useRequest } from 'ahooks';
import { aiOpsApi } from '@/api';
import { PageHeader } from '@/components/scaffold/PageHeader';
import { AiErrorBanner } from '@/components/ai-ops/AiErrorBanner';
import { canReadEvalReports, useAiOpsRole } from '@/lib/ai-ops-permissions';
import type { AiEvalReportSummary } from '@/type/types';

const cardClass =
  'rounded-xl border border-gray-100 bg-white p-4 dark:border-white/10 dark:bg-gray-900';

const AGG_LABELS: Record<string, string> = {
  language_match: '语言一致',
  answered: '有终态回复',
  latency: '时延达标',
  trace_present: '有链路',
  sensitive_request: '无敏感索要',
  action_completed: '动作完成',
};

function pct(value: number | null): string {
  return value == null ? '—' : `${(value * 100).toFixed(1)}%`;
}

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export default function AiOpsReportsPage() {
  const role = useAiOpsRole();
  const allowed = canReadEvalReports(role);
  const [selected, setSelected] = useState<string | null>(null);

  const { data, loading, error, refresh } = useRequest(
    () => aiOpsApi.getEvalReports(20),
    { ready: allowed, refreshDeps: [allowed] },
  );

  const reports = data ?? [];
  const current = useMemo(
    () => reports.find((item) => item.runId === selected) ?? reports[0] ?? null,
    [reports, selected],
  );

  if (!allowed) {
    return (
      <div className="space-y-5 p-4">
        <PageHeader
          title="评测报告"
          description="定时抽样评测的门禁、指标与公平性"
        />
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
          当前角色为 {role || 'viewer'}
          ，无权查看评测报告。请联系管理员开通权限。
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5 p-4">
      <PageHeader
        title="评测报告"
        description="定时抽样评测的门禁、指标与公平性；数据来自每日 JSON 报告"
      />

      {error ? (
        <AiErrorBanner
          message="读取评测报告失败，请稍后重试。"
          onRetry={() => void refresh()}
        />
      ) : null}

      {loading ? (
        <div className="py-6 text-center text-sm text-gray-400">加载中…</div>
      ) : reports.length === 0 ? (
        <div className="rounded-xl border border-gray-100 bg-white px-4 py-6 text-center text-sm text-gray-500 dark:border-white/10 dark:bg-gray-900">
          还没有评测报告。先运行 `tools/eval/conversation/daily.sh`。
        </div>
      ) : (
        <>
          <section className={cardClass}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold">最新报告</h2>
                <p className="mt-1 text-xs text-gray-500">
                  {current
                    ? `${current.runId} · dataset ${current.datasetVersion} · ${formatTime(current.generatedAt)}`
                    : '—'}
                </p>
              </div>
              <span
                className={
                  current?.gatePassed
                    ? 'rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300'
                    : 'rounded-full bg-red-100 px-2.5 py-1 text-xs font-medium text-red-700 dark:bg-red-500/15 dark:text-red-300'
                }
              >
                {current?.gatePassed ? '门禁 PASS' : '门禁 FAIL'} ·{' '}
                {current?.mode ?? 'advisory'}
              </span>
            </div>

            {current ? (
              <div className="mt-4 grid gap-4 lg:grid-cols-2">
                <div>
                  <h3 className="text-xs font-medium text-gray-500">指标</h3>
                  <div className="mt-2 divide-y divide-gray-100 text-sm dark:divide-white/5">
                    {Object.entries(current.aggregates).map(([key, row]) => (
                      <div
                        key={key}
                        className="grid grid-cols-[140px_1fr] gap-3 py-2"
                      >
                        <span>{AGG_LABELS[key] ?? key}</span>
                        <span>
                          {pct(row.rate)}（{row.pass}/{row.pass + row.fail}，
                          unknown {row.unknown}）
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <h3 className="text-xs font-medium text-gray-500">门禁</h3>
                  {current.gates.length === 0 ? (
                    <p className="mt-2 text-xs text-gray-500">
                      该报告未包含门禁数据（旧格式）。
                    </p>
                  ) : null}
                  <div className="mt-2 divide-y divide-gray-100 text-sm dark:divide-white/5">
                    {current.gates.map((gate) => (
                      <div
                        key={gate.key}
                        className="grid grid-cols-[100px_1fr] gap-3 py-2"
                      >
                        <span
                          className={
                            gate.ok
                              ? 'text-emerald-600 dark:text-emerald-300'
                              : 'text-red-600 dark:text-red-300'
                          }
                        >
                          {gate.ok ? 'PASS' : 'FAIL'}
                        </span>
                        <span>
                          {gate.label}
                          <span className="ml-2 text-xs text-gray-500">
                            {gate.detail}
                          </span>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : null}
          </section>

          {current?.fairness?.some((item) => item.flagged) ? (
            <section className={cardClass}>
              <h2 className="text-sm font-semibold">公平性告警</h2>
              <div className="mt-2 space-y-1 text-sm">
                {current.fairness
                  .filter((item) => item.flagged)
                  .map((item) => (
                    <div key={`${item.dimension}-${item.key}`}>
                      <span className="font-medium">
                        {item.dimension}/{item.key}
                      </span>
                      <span className="ml-2 text-gray-500">
                        {item.spread == null
                          ? item.note
                          : `层间差 ${(item.spread * 100).toFixed(1)}pp`}
                      </span>
                    </div>
                  ))}
              </div>
            </section>
          ) : null}

          <section className={cardClass}>
            <h2 className="text-sm font-semibold">历史报告</h2>
            <div className="mt-3 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="text-left text-xs text-gray-500">
                  <tr>
                    <th className="px-2 py-2">运行</th>
                    <th className="px-2 py-2">dataset</th>
                    <th className="px-2 py-2">会话</th>
                    <th className="px-2 py-2">drill</th>
                    <th className="px-2 py-2">门禁</th>
                    <th className="px-2 py-2">时间</th>
                  </tr>
                </thead>
                <tbody>
                  {reports.map((report) => (
                    <tr
                      key={report.runId}
                      className="cursor-pointer border-t border-gray-100 hover:bg-gray-50 dark:border-white/5 dark:hover:bg-white/5"
                      onClick={() => setSelected(report.runId)}
                    >
                      <td className="px-2 py-2 font-mono text-xs">
                        {report.runId}
                      </td>
                      <td className="px-2 py-2">{report.datasetVersion}</td>
                      <td className="px-2 py-2">{report.conversationCount}</td>
                      <td className="px-2 py-2">{report.drillCount}</td>
                      <td className="px-2 py-2">
                        <span
                          className={
                            report.gatePassed
                              ? 'text-emerald-600 dark:text-emerald-300'
                              : 'text-red-600 dark:text-red-300'
                          }
                        >
                          {report.gatePassed ? 'PASS' : 'FAIL'}
                        </span>
                      </td>
                      <td className="px-2 py-2 text-xs text-gray-500">
                        {formatTime(report.generatedAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
