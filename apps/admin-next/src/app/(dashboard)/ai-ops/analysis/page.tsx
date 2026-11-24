'use client';

import { useState } from 'react';
import { useRequest } from 'ahooks';
import { Button } from '@repo/ui';
import { aiOpsApi } from '@/api';
import { PageHeader } from '@/components/scaffold/PageHeader';
import { AiErrorBanner } from '@/components/ai-ops/AiErrorBanner';
import { useAiOpsRole } from '@/lib/ai-ops-permissions';
import { useAuthStore } from '@/store/useAuthStore';
import type {
  AiAnalysisAlertRow,
  AiAnalysisRunRow,
  AiMetricWindowRow,
  AiProblemClusterRow,
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

const CLUSTER_STATUS_LABELS: Record<string, string> = {
  NEW: '待处理',
  ASSIGNED: '已分配',
  FIXING: '修复中',
  VERIFYING: '验证中',
  CLOSED: '已关闭',
  IGNORED: '已忽略',
};

const FIX_TYPE_LABELS: Record<string, string> = {
  KNOWLEDGE: '补知识',
  PROMPT: '改 Prompt',
  ROUTING: '调路由',
  TOOL: '修工具',
  MODEL: '模型能力',
  INFRA: '基础设施',
  SERVICE: '服务故障',
  SECURITY: '安全',
  UX: '体验',
  UNKNOWN: '待判断',
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
  } = useRequest(() => aiOpsApi.getAnalysisEvents({ date, pageSize: 50 }), {
    refreshDeps: [date],
  });
  const {
    data: clustersData,
    loading: clustersLoading,
    error: clustersError,
    refresh: refreshClusters,
  } = useRequest(() => aiOpsApi.getAnalysisClusters({ page: 1 }));
  const {
    data: alertsData,
    loading: alertsLoading,
    error: alertsError,
    refresh: refreshAlerts,
  } = useRequest(() => aiOpsApi.getAnalysisAlerts({ status: 'NEW', page: 1 }));
  const adminId = useAuthStore((state) => state.userInfo?.id);

  const clusters = (clustersData?.list ?? []) as AiProblemClusterRow[];
  const alerts = (alertsData?.list ?? []) as AiAnalysisAlertRow[];

  const patchCluster = async (
    id: string,
    patch: {
      status?: string;
      ownerAdminId?: string | null;
      fixType?: string | null;
    },
  ) => {
    try {
      await aiOpsApi.updateAnalysisCluster(id, patch);
      await refreshClusters();
      setMessage('问题簇已更新');
    } catch (err: any) {
      setMessage(err?.message ?? '更新问题簇失败');
    }
  };

  const createRegression = async (cluster: AiProblemClusterRow) => {
    const datasetId = window.prompt('目标评测集 ID（可在回归测试页找到）');
    if (!datasetId) return;
    const expected = window.prompt(
      '期望答案 / 必须提到的要点（必填，作为回归判分标准）',
    );
    if (!expected?.trim()) {
      setMessage('回归用例必须填写期望答案');
      return;
    }
    try {
      await aiOpsApi.createClusterRegression(cluster.id, {
        datasetId,
        expected: expected.trim(),
      });
      await refreshClusters();
      setMessage('已生成回归用例，问题簇进入修复中');
    } catch (err: any) {
      setMessage(err?.message ?? '生成回归用例失败');
    }
  };

  const ack = async (id: string) => {
    try {
      await aiOpsApi.ackAnalysisAlert(id);
      await refreshAlerts();
    } catch (err: any) {
      setMessage(err?.message ?? '确认告警失败');
    }
  };

  const runs = (runsData ?? []) as AiAnalysisRunRow[];
  const metrics = (metricsData?.metrics ?? []) as AiMetricWindowRow[];
  const events = (eventsData?.list ?? []) as AiProblemEventRow[];
  const windowStart = metricsData?.windowStart ?? eventsData?.windowStart;

  const run = async () => {
    setRunning(true);
    setMessage('');
    try {
      const result = await aiOpsApi.runAnalysis(date);
      setMessage(`分析完成：${result.createdEvents} 条事件，窗口 ${date}`);
      await Promise.all([
        refreshRuns(),
        refreshMetrics(),
        refreshEvents(),
        refreshClusters(),
        refreshAlerts(),
      ]);
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
          <div className="py-4 text-sm text-gray-500">该日期没有问题事件。</div>
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

      {clustersError ? (
        <AiErrorBanner
          message="问题簇加载失败"
          onRetry={() => void refreshClusters()}
        />
      ) : null}
      <section className={card}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold">
            问题簇（{clustersData?.total ?? 0}）
          </h2>
          <span className="text-xs text-gray-500">
            按规范化问题归并；运营按簇处理，不逐条看
          </span>
        </div>
        {clustersLoading ? (
          <div className="py-4 text-sm text-gray-400">Loading...</div>
        ) : clusters.length === 0 ? (
          <div className="py-4 text-sm text-gray-500">
            当前没有问题簇；先运行分析。
          </div>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-left text-xs text-gray-500">
                <tr>
                  <th className="px-2 py-2">代表问题</th>
                  <th className="px-2 py-2">条数</th>
                  <th className="px-2 py-2">严重度</th>
                  <th className="px-2 py-2">意图</th>
                  <th className="px-2 py-2">建议归因</th>
                  <th className="px-2 py-2">状态</th>
                  <th className="px-2 py-2">修复类型</th>
                  <th className="px-2 py-2">操作</th>
                </tr>
              </thead>
              <tbody>
                {clusters.map((item) => (
                  <tr
                    key={item.id}
                    className="border-t border-gray-100 align-top dark:border-white/5"
                  >
                    <td className="max-w-[320px] px-2 py-2">
                      <div className="break-words">
                        {item.representativeText}
                      </div>
                      <div className="mt-1 font-mono text-[11px] text-gray-400">
                        {item.id}
                      </div>
                    </td>
                    <td className="px-2 py-2">{item.count}</td>
                    <td className="px-2 py-2">{item.severity}</td>
                    <td className="px-2 py-2">{item.intent ?? '—'}</td>
                    <td className="px-2 py-2">
                      {FIX_TYPE_LABELS[item.suggestedCause ?? ''] ??
                        item.suggestedCause ??
                        '—'}
                    </td>
                    <td className="px-2 py-2">
                      <select
                        aria-label={`问题簇状态 ${item.id}`}
                        className="rounded border px-2 py-1 text-xs dark:border-white/10 dark:bg-gray-800"
                        value={item.status}
                        disabled={!canRun}
                        onChange={(e) =>
                          void patchCluster(item.id, {
                            status: e.target.value,
                          })
                        }
                      >
                        {Object.entries(CLUSTER_STATUS_LABELS).map(
                          ([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ),
                        )}
                      </select>
                    </td>
                    <td className="px-2 py-2">
                      <select
                        aria-label={`修复类型 ${item.id}`}
                        className="rounded border px-2 py-1 text-xs dark:border-white/10 dark:bg-gray-800"
                        value={item.fixType ?? ''}
                        disabled={!canRun}
                        onChange={(e) =>
                          void patchCluster(item.id, {
                            fixType: e.target.value || null,
                          })
                        }
                      >
                        <option value="">未定</option>
                        {Object.entries(FIX_TYPE_LABELS).map(
                          ([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ),
                        )}
                      </select>
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex flex-wrap gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!canRun}
                          onClick={() =>
                            void patchCluster(item.id, {
                              status: 'ASSIGNED',
                              ownerAdminId: adminId ?? null,
                            })
                          }
                        >
                          认领
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!canRun}
                          onClick={() => void createRegression(item)}
                        >
                          建回归
                        </Button>
                        <span className="text-[11px] text-gray-400">
                          {item.ownerAdminId ?? '未分配'}
                        </span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {alertsError ? (
        <AiErrorBanner
          message="告警加载失败"
          onRetry={() => void refreshAlerts()}
        />
      ) : null}
      <section className={card}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold">
            待确认告警（{alertsData?.total ?? 0}）
          </h2>
          <span className="text-xs text-gray-500">
            当前窗口 vs 近 7 天基线；样本不足不告警
          </span>
        </div>
        {alertsLoading ? (
          <div className="py-4 text-sm text-gray-400">Loading...</div>
        ) : alerts.length === 0 ? (
          <div className="py-4 text-sm text-gray-500">没有待确认告警。</div>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-left text-xs text-gray-500">
                <tr>
                  <th className="px-2 py-2">窗口</th>
                  <th className="px-2 py-2">指标</th>
                  <th className="px-2 py-2">当前 / 基线</th>
                  <th className="px-2 py-2">样本</th>
                  <th className="px-2 py-2">严重度</th>
                  <th className="px-2 py-2">说明</th>
                  <th className="px-2 py-2">操作</th>
                </tr>
              </thead>
              <tbody>
                {alerts.map((item) => (
                  <tr
                    key={item.id}
                    className="border-t border-gray-100 dark:border-white/5"
                  >
                    <td className="whitespace-nowrap px-2 py-2 text-xs">
                      {item.windowStart.slice(0, 10)}
                    </td>
                    <td className="px-2 py-2">
                      {METRIC_LABELS[item.metric] ?? item.metric}
                    </td>
                    <td className="px-2 py-2">
                      {formatPercent(item.value)} /{' '}
                      {formatPercent(item.baseline)}
                    </td>
                    <td className="px-2 py-2">{item.sampleSize}</td>
                    <td className="px-2 py-2">{item.severity}</td>
                    <td className="max-w-[360px] px-2 py-2 text-xs">
                      {item.message}
                    </td>
                    <td className="px-2 py-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!canRun}
                        onClick={() => void ack(item.id)}
                      >
                        确认
                      </Button>
                    </td>
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
