'use client';

import { useState } from 'react';
import { useRequest } from 'ahooks';
import { Button } from '@repo/ui';
import { aiOpsApi } from '@/api';
import { PageHeader } from '@/components/scaffold/PageHeader';
import { AiErrorBanner } from '@/components/ai-ops/AiErrorBanner';
import { canManageQueues, useAiOpsRole } from '@/lib/ai-ops-permissions';
import type { AiFailedJob, AiOutboxItem, AiQueueStats } from '@/type/types';

function normalizeQueues(data: unknown): AiQueueStats[] {
  if (Array.isArray(data)) return data as AiQueueStats[];
  return ((data as { queues?: AiQueueStats[] })?.queues ??
    []) as AiQueueStats[];
}

export default function AiRuntimePage() {
  const [outboxStatus, setOutboxStatus] = useState('');
  const role = useAiOpsRole();
  const canWrite = canManageQueues(role);

  const {
    data: queueData,
    loading: queueLoading,
    error: queueError,
    refresh: refreshQueues,
  } = useRequest(aiOpsApi.getQueues, { pollingInterval: 15_000 });
  const {
    data: failed,
    loading: failedLoading,
    error: failedError,
    refresh: refreshFailed,
  } = useRequest(() => aiOpsApi.getAiFailed(100), { pollingInterval: 30_000 });
  const {
    data: outbox,
    loading: outboxLoading,
    error: outboxError,
    refresh: refreshOutbox,
  } = useRequest(() => aiOpsApi.getOutbox(outboxStatus || undefined, 100), {
    refreshDeps: [outboxStatus],
    pollingInterval: 30_000,
  });

  const queues = normalizeQueues(queueData);
  const failedJobs = (failed as AiFailedJob[] | undefined) ?? [];
  const outboxRows = (outbox as AiOutboxItem[] | undefined) ?? [];
  const hasError = Boolean(queueError || failedError || outboxError);

  const runQueueAction = async (
    action: 'pause' | 'resume' | 'clean',
    q: AiQueueStats,
  ) => {
    const name = q.name;
    const impact =
      action === 'clean'
        ? '只清理已完成任务，失败任务会保留。'
        : `当前排队 ${q.waiting} 条、处理中 ${q.active} 条。`;
    const labels = {
      pause: '暂停 AI 回复',
      resume: '恢复 AI 回复',
      clean: '清理已完成任务',
    };
    if (
      !window.confirm(`${labels[action]}：队列 ${name}。${impact} 确认执行？`)
    )
      return;
    try {
      const result: any =
        action === 'pause'
          ? await aiOpsApi.pauseQueue(name)
          : action === 'resume'
            ? await aiOpsApi.resumeQueue(name)
            : await aiOpsApi.cleanQueue(name);
      if (result?.success === false) {
        throw new Error(result?.message ?? '服务端未执行该操作');
      }
      await refreshQueues();
    } catch (err: any) {
      window.alert(err?.message ?? '操作失败');
    }
  };

  const replayAi = async (messageId: string) => {
    if (!window.confirm(`确认重放 AI 死信 ${messageId}？`)) return;
    try {
      const result: any = await aiOpsApi.replayAiJob(messageId);
      if (result?.ok === false) window.alert(result.reason);
      await refreshFailed();
    } catch (err: any) {
      window.alert(err?.message ?? '重放失败');
    }
  };

  const replayOutbox = async (messageId: string) => {
    if (!window.confirm(`确认重放 Outbox 任务 ${messageId}？`)) return;
    try {
      const result: any = await aiOpsApi.replayOutbox(messageId);
      if (result?.ok === false) window.alert(result.reason);
      await refreshOutbox();
    } catch (err: any) {
      window.alert(err?.message ?? '重放失败');
    }
  };

  return (
    <div className="space-y-5 p-4">
      <PageHeader
        title="AI Runtime"
        description="队列、AI 死信、Outbox 投递状态；写操作会二次确认"
      />

      {hasError ? (
        <AiErrorBanner
          message="部分运行数据加载失败，下面的空表不代表系统正常。"
          onRetry={() => {
            void refreshQueues();
            void refreshFailed();
            void refreshOutbox();
          }}
        />
      ) : null}

      {!canWrite ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
          当前角色为只读，可以查看队列和失败任务，但不能暂停、恢复或重放。
        </div>
      ) : null}

      <section className="rounded-xl border border-gray-100 bg-white p-4 dark:border-white/10 dark:bg-gray-900">
        <h2 className="mb-3 text-sm font-semibold">队列</h2>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-left dark:bg-white/5">
              <tr>
                {[
                  'Queue',
                  'Waiting',
                  'Active',
                  'Failed',
                  'Delayed',
                  'Paused',
                  'Actions',
                ].map((h) => (
                  <th key={h} className="px-3 py-2">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {queueLoading && (
                <tr>
                  <td
                    colSpan={7}
                    className="px-3 py-6 text-center text-gray-400"
                  >
                    Loading...
                  </td>
                </tr>
              )}
              {!queueLoading && queues.length === 0 && (
                <tr>
                  <td
                    colSpan={7}
                    className="px-3 py-6 text-center text-gray-400"
                  >
                    {queueError ? '队列加载失败，请重试' : '暂无队列数据'}
                  </td>
                </tr>
              )}
              {queues.map((q) => (
                <tr
                  key={q.name}
                  className="border-t border-gray-100 dark:border-white/5"
                >
                  <td className="px-3 py-2 font-mono text-xs">{q.name}</td>
                  <td className="px-3 py-2">{q.waiting}</td>
                  <td className="px-3 py-2">{q.active}</td>
                  <td className="px-3 py-2">{q.failed}</td>
                  <td className="px-3 py-2">{q.delayed}</td>
                  <td className="px-3 py-2">{q.isPaused ? '是' : '否'}</td>
                  <td className="px-3 py-2">
                    <div className="flex gap-2">
                      {canWrite ? (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => runQueueAction('pause', q)}
                          >
                            暂停
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => runQueueAction('resume', q)}
                          >
                            恢复
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => runQueueAction('clean', q)}
                          >
                            清理已完成
                          </Button>
                        </>
                      ) : (
                        <span className="text-xs text-gray-400">只读</span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-xl border border-gray-100 bg-white p-4 dark:border-white/10 dark:bg-gray-900">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">AI 死信</h2>
          <Button size="sm" variant="outline" onClick={refreshFailed}>
            刷新
          </Button>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-left dark:bg-white/5">
              <tr>
                {[
                  'Message',
                  'Conversation',
                  'Attempts',
                  'Reason',
                  'Failed At',
                  'Action',
                ].map((h) => (
                  <th key={h} className="px-3 py-2">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {failedLoading && (
                <tr>
                  <td
                    colSpan={6}
                    className="px-3 py-6 text-center text-gray-400"
                  >
                    Loading...
                  </td>
                </tr>
              )}
              {!failedLoading && failedJobs.length === 0 && (
                <tr>
                  <td
                    colSpan={6}
                    className="px-3 py-6 text-center text-gray-400"
                  >
                    {failedError ? '死信加载失败，请重试' : '没有死信'}
                  </td>
                </tr>
              )}
              {failedJobs.map((job) => (
                <tr
                  key={job.messageId}
                  className="border-t border-gray-100 dark:border-white/5"
                >
                  <td className="px-3 py-2 font-mono text-xs">
                    {job.messageId}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {job.conversationId ?? '-'}
                  </td>
                  <td className="px-3 py-2">{job.attemptsMade}</td>
                  <td
                    className="max-w-[280px] truncate px-3 py-2"
                    title={job.failedReason}
                  >
                    {job.failedReason}
                  </td>
                  <td className="px-3 py-2">
                    {job.failedAt
                      ? new Date(job.failedAt).toLocaleString()
                      : '-'}
                  </td>
                  <td className="px-3 py-2">
                    {canWrite ? (
                      <Button size="sm" onClick={() => replayAi(job.messageId)}>
                        重新处理
                      </Button>
                    ) : (
                      <span className="text-xs text-gray-400">只读</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-xl border border-gray-100 bg-white p-4 dark:border-white/10 dark:bg-gray-900">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Outbox</h2>
          <div className="flex items-center gap-2">
            <select
              className="rounded-lg border px-3 py-1.5 text-sm dark:border-white/10 dark:bg-gray-800"
              value={outboxStatus}
              onChange={(e) => setOutboxStatus(e.target.value)}
            >
              <option value="">All</option>
              <option value="PENDING">PENDING</option>
              <option value="SENDING">SENDING</option>
              <option value="SENT">SENT</option>
              <option value="FAILED">FAILED</option>
            </select>
            <Button size="sm" variant="outline" onClick={refreshOutbox}>
              刷新
            </Button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-left dark:bg-white/5">
              <tr>
                {[
                  'Message',
                  'Conversation',
                  'Status',
                  'Attempts',
                  'Last Error',
                  'Next Attempt',
                  'Action',
                ].map((h) => (
                  <th key={h} className="px-3 py-2">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {outboxLoading && (
                <tr>
                  <td
                    colSpan={7}
                    className="px-3 py-6 text-center text-gray-400"
                  >
                    Loading...
                  </td>
                </tr>
              )}
              {!outboxLoading && outboxRows.length === 0 && (
                <tr>
                  <td
                    colSpan={7}
                    className="px-3 py-6 text-center text-gray-400"
                  >
                    {outboxError
                      ? 'Outbox 加载失败，请重试'
                      : '没有 Outbox 任务'}
                  </td>
                </tr>
              )}
              {outboxRows.map((item) => (
                <tr
                  key={item.id}
                  className="border-t border-gray-100 dark:border-white/5"
                >
                  <td className="px-3 py-2 font-mono text-xs">
                    {item.messageId}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {item.conversationId}
                  </td>
                  <td className="px-3 py-2">{item.status}</td>
                  <td className="px-3 py-2">{item.attempts}</td>
                  <td
                    className="max-w-[240px] truncate px-3 py-2"
                    title={item.lastError ?? ''}
                  >
                    {item.lastError ?? '-'}
                  </td>
                  <td className="px-3 py-2">
                    {new Date(item.nextAttemptAt).toLocaleString()}
                  </td>
                  <td className="px-3 py-2">
                    {item.status === 'FAILED' && canWrite ? (
                      <Button
                        size="sm"
                        onClick={() => replayOutbox(item.messageId)}
                      >
                        重新投递
                      </Button>
                    ) : (
                      '-'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
