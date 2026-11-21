'use client';

import { useState } from 'react';
import { useRequest } from 'ahooks';
import { Button } from '@repo/ui';
import { aiOpsApi } from '@/api';
import { PageHeader } from '@/components/scaffold/PageHeader';
import { AiErrorBanner } from '@/components/ai-ops/AiErrorBanner';
import { useAiOpsRole } from '@/lib/ai-ops-permissions';
import type {
  AiAnalysisRunRow,
  AiMetricWindowRow,
  AiProblemEventRow,
} from '@/type/types';

const METRIC_LABELS: Record<string, string> = {
  problem_rate: '问题率',
  service_error_rate: '服务故障率',
  zero_hit_rate: '零命中率',
  explicit_negative_rate: '显式负反馈率',
  repeat_rate: '重复追问率',
};

const TYPE_LABELS: Record<string, string> = {
  EXPLICIT_NEGATIVE: '显式负反馈',
  SERVICE_ERROR: '服务故障',
  ZERO_HIT: '检索零命中',
  REPEATED_QUESTION: '重复追问',
  USER_ABANDONED: '用户放弃',
  UNEXPECTED_TRANSFER: '误转',
  EVAL_UNSOLVED: '评测未解决',
  SECURITY_HIT: '安全命中',
};

const STATUS_LABELS: Record<string, string> = {
  RUNNING: '运行中',
  COMPLETED: '已完成',
  FAILED: '失败',
};

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

const card =
  'rounded-xl border border-gray-100 bg-white p-4 dark:border-white/10 dark:bg-gray-900';

export default function AiAnalysisPage() {
  const role = useAiOpsRole();
  const canRun = role === 'SUPER_ADMIN' || role === 'ADMIN';
  const [date, setDate] = useState(today());
  const [message, setMessage] = useState('');
  const [running, setRunning] = useState(false);

  const {
    data: runsData,
    loading: runsLoading,
    error: runsError,
    refresh: refreshRuns,
  } = useRequest(() => aiOpsApi.getAnalysisRuns(20));
  const {
    data: metricsData,
    loading: metricsLoading,
    error: metricsError,
    refresh: refreshMetrics,
  } = useRequest(() => aiOpsApi.getAnalysisMetrics(date), {
    refreshDeps: [date],
  });
  const {
    data: eventsData,
    loading: eventsLoading,
    error: eventsError,
    refresh: refreshEvents,
  } = useRequest(
    () => aiOpsApi.getAnalysisEvents({ date, pageSize: 50 }),
    { refreshDeps: [date] },
  );

  const runs = (runsData ?? []) as AiAnalysisRunRow[];
  const metrics = (metricsData?.metrics ?? []) as AiMetricWindowRow[];
  const events = (eventsData?.list ?? []) as AiProblemEventRow[];
  const windowStart = metricsData?.windowStart ?? eventsData?.windowStart;

  const run = async () => {
    setRunning(true);
    setMessage('');
    try {
      const result = await aiOpsApi.runAnalysis(date);
      setMessage(
        `分析完成：${result.createdEvents} 条事件，窗口 ${date}`,
      );
      await Promise.all([refreshRuns(), refreshMetrics(), refreshEvents()]);
    } catch (err: any) {
      setMessage(err?.message ?? '分析失败，请重试');
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-5 p-4">
      <PageHeader
        title="问题分析"
        description="按 UTC 日窗口把反馈、链路、评测与安全事件标准化为问题事件和指标"
      />

      <section className={`${card} flex flex-wrap items-end gap-3`}>
        <label className="flex flex-col gap-1 text-xs text-gray-500">
          分析日期（UTC）
          <input
            type="date"
            aria-label="分析日期"
            className="rounded-lg border px-3 py-1.5 text-sm dark:border-white/10 dark:bg-gray-800"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
        <Button
          size="sm"
          onClick={() => void run()}
          disabled={!canRun || running}
        >
          {running ? '分析中…' : '运行分析'}
        </Button>
        {!canRun ? (
          <span className="text-xs text-gray-500">只读角色仅可查看结果</span>
        ) : null}
        {message ? (
          <span className="text-xs text-gray-600 dark:text-gray-300">
            {message}
          </span>
        ) : null}
      </section>

      {runsError ? (
        <AiErrorBanner
          message="分析运行记录加载失败"
          onRetry={() => void refreshRuns()}
        />
      ) : null}
      <section className={card}>
        <h2 className="text-sm font-semibold">分析任务</h2>
        {runsLoading ? (
          <div className="py-4 text-sm text-gray-400">Loading...</div>
        ) : runs.length === 0 ? (
          <div className="py-4 text-sm text-gray-500">
            还没有分析运行，选择日期后点「运行分析」。
          </div>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-left text-xs text-gray-500">
                <tr>
                  <th className="px-2 py-2">窗口</th>
                  <th className="px-2 py-2">状态</th>
                  <th className="px-2 py-2">事件数</th>
                  <th className="px-2 py-2">耗时</th>
                  <th className="px-2 py-2">失败原因</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((item) => (
                  <tr
                    key={item.id}
                    className="border-t border-gray-100 dark:border-white/5"
                  >
                    <td className="px-2 py-2 font-mono text-xs">
                      {item.windowStart.slice(0, 10)}
                    </td>
                    <td className="px-2 py-2">
                      {STATUS_LABELS[item.status] ?? item.status}
                    </td>
                    <td className="px-2 py-2">{item.createdEvents}</td>
                    <td className="px-2 py-2">
                      {item.finishedAt
                        ? `${Math.max(
                            0,
                            Math.round(
                              (new Date(item.finishedAt).getTime() -
                                new Date(item.startedAt).getTime()) /
                                1000,
                            ),
                          )}s`
                        : '—'}
                    </td>
                    <td className="max-w-[260px] truncate px-2 py-2 text-xs text-red-600">
                      {item.error ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {metricsError ? (
        <AiErrorBanner
          message="指标加载失败"
          onRetry={() => void refreshMetrics()}
        />
      ) : null}
      <section className={card}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold">指标</h2>
          <span className="text-xs text-gray-500">
            {windowStart
              ? `窗口 ${windowStart.slice(0, 10)}（UTC）`
              : '暂无完成窗口'}
          </span>
        </div>
        {metricsLoading ? (
          <div className="py-4 text-sm text-gray-400">Loading...</div>
        ) : metrics.length === 0 ? (
          <div className="py-4 text-sm text-gray-500">
            该日期还没有指标，先运行分析。
          </div>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-left text-xs text-gray-500">
                <tr>
                  <th className="px-2 py-2">指标</th>
                  <th className="px-2 py-2">维度</th>
                  <th className="px-2 py-2">值</th>
                  <th className="px-2 py-2">分子 / 分母</th>
                  <th className="px-2 py-2">样本量</th>
                </tr>
              </thead>
              <tbody>
                {metrics.map((item) => (
                  <tr
                    key={item.id}
                    className="border-t border-gray-100 dark:border-white/5"
                  >
                    <td className="px-2 py-2">
                      {METRIC_LABELS[item.metric] ?? item.metric}
                    </td>
                    <td className="px-2 py-2">
                      {item.dimension === 'ALL'
                        ? '全部'
                        : `${item.dimension}:${item.dimensionValue}`}
                    </td>
                    <td className="px-2 py-2 font-medium">
                      {formatPercent(item.value)}
                    </td>
                    <td className="px-2 py-2">
                      {item.numerator} / {item.denominator}
                    </td>
                    <td className="px-2 py-2">{item.sampleSize}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {eventsError ? (
        <AiErrorBanner
          message="问题事件加载失败"
          onRetry={() => void refreshEvents()}
        />
      ) : null}
      <section className={card}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold">
            问题事件（{eventsData?.total ?? 0}）
          </h2>
          <span className="text-xs text-gray-500">
            只存 ID 与脱敏摘要，不存原文
          </span>
        </div>
        {eventsLoading ? (
          <div className="py-4 text-sm text-gray-400">Loading...</div>
        ) : events.length === 0 ? (
          <div className="py-4 text-sm text-gray-500">
            该日期没有问题事件。
          </div>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-left text-xs text-gray-500">
                <tr>
                  <th className="px-2 py-2">时间</th>
                  <th className="px-2 py-2">类型</th>
                  <th className="px-2 py-2">严重度</th>
                  <th className="px-2 py-2">意图</th>
                  <th className="px-2 py-2">会话</th>
                  <th className="px-2 py-2">状态</th>
                </tr>
              </thead>
              <tbody>
                {events.map((item) => (
                  <tr
                    key={item.id}
                    className="border-t border-gray-100 dark:border-white/5"
                  >
                    <td className="whitespace-nowrap px-2 py-2 text-xs">
                      {new Date(item.occurredAt).toLocaleString()}
                    </td>
                    <td className="px-2 py-2">
                      {TYPE_LABELS[item.type] ?? item.type}
                    </td>
                    <td className="px-2 py-2">{item.severity}</td>
                    <td className="px-2 py-2">{item.intent ?? '—'}</td>
                    <td className="px-2 py-2 font-mono text-xs">
                      {item.conversationId ?? '—'}
                    </td>
                    <td className="px-2 py-2">{item.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
