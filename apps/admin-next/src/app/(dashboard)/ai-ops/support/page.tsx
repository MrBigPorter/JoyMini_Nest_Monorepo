'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRequest } from 'ahooks';
import { Button } from '@repo/ui';
import { aiQualityApi, chatApi } from '@/api';
import { PageHeader } from '@/components/scaffold/PageHeader';
import { AiErrorBanner } from '@/components/ai-ops/AiErrorBanner';
import { useAiOpsRole } from '@/lib/ai-ops-permissions';
import { buildCustomerServiceConversationHref } from '@/lib/customer-service-cache';
import type { SupportSlaSnapshotRow } from '@/type/types';

function formatWait(seconds: number): string {
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest > 0 ? `${minutes} 分 ${rest} 秒` : `${minutes} 分钟`;
}

/** 转人工队列的写操作角色：ADMIN / SUPER_ADMIN / EDITOR。后端 RolesGuard 仍是最终边界。 */
function canManageSupport(role: string): boolean {
  const normalized = (role ?? '').toUpperCase();
  return (
    normalized === 'SUPER_ADMIN' ||
    normalized === 'ADMIN' ||
    normalized === 'EDITOR'
  );
}

interface ActionFeedback {
  type: 'success' | 'error';
  message: string;
}

export default function AiSupportPage() {
  const [hours, setHours] = useState(24);
  const [actionFeedback, setActionFeedback] = useState<ActionFeedback | null>(
    null,
  );
  const [pendingId, setPendingId] = useState<string | null>(null);
  const role = useAiOpsRole();
  const canWrite = canManageSupport(role);
  const rawTextPlaceholder = role === 'VIEWER' ? '只读账号不显示原文' : null;
  const { data, loading, error, refresh } = useRequest(
    () => aiQualityApi.slaHistory(hours),
    { refreshDeps: [hours], pollingInterval: 60_000 },
  );
  const {
    data: queueData,
    loading: queueLoading,
    error: queueError,
    refresh: refreshQueue,
  } = useRequest(aiQualityApi.slaQueue, { pollingInterval: 30_000 });

  const latest = data?.latest as SupportSlaSnapshotRow | null | undefined;
  const snapshots = (data?.snapshots ?? []) as SupportSlaSnapshotRow[];
  const thresholdMinutes = data?.thresholdMinutes;
  const maxWaiting = Math.max(1, ...snapshots.map((s) => s.waiting));
  const visible = snapshots.slice(-120);
  const queueItems = queueData?.items ?? [];

  const refreshAfterAction = async () => {
    await Promise.all([refreshQueue(), refresh()]);
  };

  const runClaim = async (conversationId: string) => {
    if (!canWrite || pendingId) return;
    if (
      !window.confirm(
        `确认认领会话 ${conversationId}？认领后将由你进行人工接待。`,
      )
    ) {
      return;
    }
    setPendingId(conversationId);
    setActionFeedback(null);
    try {
      const result = await chatApi.claim(conversationId);
      if (!result || result.success === false) {
        throw new Error('服务端未确认认领，请刷新队列后重试');
      }
      setActionFeedback({
        type: 'success',
        message: `已认领会话 ${conversationId}`,
      });
      await refreshAfterAction();
    } catch (err) {
      setActionFeedback({
        type: 'error',
        message: `认领失败：${
          err instanceof Error ? err.message : '请稍后重试'
        }`,
      });
    } finally {
      setPendingId(null);
    }
  };

  const runClose = async (conversationId: string) => {
    if (!canWrite || pendingId) return;
    const reason = window.prompt(
      `关闭会话 ${conversationId}，请填写关闭原因（必填）：`,
      '',
    );
    if (reason === null) return;
    const trimmedReason = reason.trim();
    if (!trimmedReason) {
      setActionFeedback({
        type: 'error',
        message: '关闭原因不能为空，已取消关闭',
      });
      return;
    }
    if (
      !window.confirm(
        `确认关闭会话 ${conversationId}？\n关闭原因：${trimmedReason}`,
      )
    ) {
      return;
    }
    setPendingId(conversationId);
    setActionFeedback(null);
    try {
      const result = await chatApi.closeConversation(conversationId, {
        reason: trimmedReason,
      });
      if (!result || result.success === false) {
        throw new Error('服务端未确认关闭，请刷新队列后重试');
      }
      setActionFeedback({
        type: 'success',
        message: `已关闭会话 ${conversationId}`,
      });
      await refreshAfterAction();
    } catch (err) {
      setActionFeedback({
        type: 'error',
        message: `关闭失败：${
          err instanceof Error ? err.message : '请稍后重试'
        }`,
      });
    } finally {
      setPendingId(null);
    }
  };

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

      {!canWrite ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
          当前角色为只读，可以查看转人工队列，但不能认领或关闭会话。
        </div>
      ) : null}

      {actionFeedback ? (
        <div
          role={actionFeedback.type === 'error' ? 'alert' : 'status'}
          className={
            actionFeedback.type === 'error'
              ? 'flex flex-wrap items-center justify-between gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300'
              : 'flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300'
          }
        >
          <span>{actionFeedback.message}</span>
          <button
            type="button"
            className="text-xs underline underline-offset-2"
            onClick={() => setActionFeedback(null)}
          >
            知道了
          </button>
        </div>
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
          <h2 className="text-sm font-semibold">等待中的会话</h2>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void refreshQueue()}
          >
            刷新
          </Button>
        </div>
        {queueError ? (
          <div className="py-6 text-center text-sm text-red-500">
            队列加载失败，请重试
          </div>
        ) : queueLoading ? (
          <div className="py-6 text-center text-sm text-gray-400">
            Loading...
          </div>
        ) : queueItems.length === 0 ? (
          <div className="py-6 text-center text-sm text-gray-400">
            当前没有人等待人工接入
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-left dark:bg-white/5">
                <tr>
                  {[
                    '会话',
                    '等待',
                    '转人工原因',
                    '最后消息',
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
                {queueItems.map((item) => (
                  <tr
                    key={item.conversationId}
                    className="border-t border-gray-100 dark:border-white/5"
                  >
                    <td className="px-3 py-2 font-mono text-xs">
                      {item.conversationId}
                    </td>
                    <td className="px-3 py-2">
                      {formatWait(item.waitingSeconds)}
                    </td>
                    <td className="px-3 py-2">{item.transferReason ?? '-'}</td>
                    <td
                      className="max-w-[260px] truncate px-3 py-2"
                      title={rawTextPlaceholder ?? item.lastMessage ?? ''}
                    >
                      {rawTextPlaceholder ?? item.lastMessage ?? '-'}
                    </td>
                    <td className="px-3 py-2">
                      {item.breached ? (
                        <span className="text-red-600 dark:text-red-400">
                          超 SLA
                        </span>
                      ) : (
                        '等待中'
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap items-center gap-2">
                        {canWrite ? (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={pendingId === item.conversationId}
                              onClick={() => void runClaim(item.conversationId)}
                            >
                              {pendingId === item.conversationId
                                ? '处理中...'
                                : '认领'}
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={pendingId === item.conversationId}
                              onClick={() => void runClose(item.conversationId)}
                            >
                              关闭
                            </Button>
                          </>
                        ) : (
                          <span className="text-xs text-gray-400">只读</span>
                        )}
                        <Link
                          className="text-xs text-blue-600 hover:underline"
                          href={buildCustomerServiceConversationHref(
                            item.conversationId,
                          )}
                        >
                          打开
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

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
