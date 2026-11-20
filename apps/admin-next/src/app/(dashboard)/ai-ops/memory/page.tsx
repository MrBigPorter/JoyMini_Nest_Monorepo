'use client';

import { useState } from 'react';
import { useRequest } from 'ahooks';
import { Button } from '@repo/ui';
import { aiOpsApi } from '@/api';
import { PageHeader } from '@/components/scaffold/PageHeader';
import type { AiMemoryRow, AiMemorySummaryRow } from '@/type/types';

export default function AiMemoryPage() {
  const [userId, setUserId] = useState('');
  const [queryId, setQueryId] = useState('');

  const { data, loading, refresh } = useRequest(
    () =>
      queryId
        ? aiOpsApi.getMemoryUser(queryId)
        : Promise.resolve({ userId: '', memories: [], summaries: [] }),
    { refreshDeps: [queryId] },
  );

  const memories = (data?.memories ?? []) as AiMemoryRow[];
  const summaries = (data?.summaries ?? []) as AiMemorySummaryRow[];

  const deleteOne = async (id: string) => {
    if (!window.confirm('确认软删除这条记忆？')) return;
    try {
      await aiOpsApi.deleteMemory(id);
      await refresh();
    } catch (err: any) {
      window.alert(err?.message ?? '删除失败');
    }
  };

  const deleteAll = async () => {
    if (!queryId) return;
    if (
      !window.confirm(
        `确认删除用户 ${queryId} 的全部记忆与摘要？此操作不可撤销。`,
      )
    ) {
      return;
    }
    try {
      const result: any = await aiOpsApi.deleteUserMemories(queryId);
      window.alert(
        `已删除 memories=${result?.memories ?? 0}, summaries=${result?.summaries ?? 0}`,
      );
      await refresh();
    } catch (err: any) {
      window.alert(err?.message ?? '删除失败');
    }
  };

  return (
    <div className="space-y-5 p-4">
      <PageHeader
        title="AI Memory"
        description="按用户查看/删除长期记忆；只展示蒸馏值，不展示原始对话"
      />

      <div className="flex flex-wrap items-center gap-2">
        <input
          className="min-w-[280px] rounded-lg border px-3 py-2 text-sm dark:border-white/10 dark:bg-gray-800"
          placeholder="userId"
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') setQueryId(userId.trim());
          }}
        />
        <Button onClick={() => setQueryId(userId.trim())}>查询</Button>
        <Button variant="outline" disabled={!queryId} onClick={deleteAll}>
          删除全部记忆
        </Button>
      </div>

      {loading ? (
        <div className="py-6 text-center text-sm text-gray-400">Loading...</div>
      ) : !queryId ? (
        <div className="py-6 text-center text-sm text-gray-400">
          输入 userId 查询
        </div>
      ) : (
        <>
          <section className="rounded-xl border border-gray-100 bg-white p-4 dark:border-white/10 dark:bg-gray-900">
            <h2 className="mb-3 text-sm font-semibold">
              偏好 / 事实（{memories.length}）
            </h2>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 text-left dark:bg-white/5">
                  <tr>
                    {[
                      'Kind',
                      'Key',
                      'Value',
                      'Confidence',
                      'Status',
                      'Expires',
                      'Last used',
                      'Action',
                    ].map((h) => (
                      <th key={h} className="px-3 py-2">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {memories.length === 0 && (
                    <tr>
                      <td
                        colSpan={8}
                        className="px-3 py-6 text-center text-gray-400"
                      >
                        没有记忆
                      </td>
                    </tr>
                  )}
                  {memories.map((m) => (
                    <tr
                      key={m.id}
                      className="border-t border-gray-100 dark:border-white/5"
                    >
                      <td className="px-3 py-2">{m.kind}</td>
                      <td className="px-3 py-2 font-mono text-xs">{m.key}</td>
                      <td
                        className="max-w-[260px] truncate px-3 py-2"
                        title={m.value}
                      >
                        {m.value}
                      </td>
                      <td className="px-3 py-2">{m.confidence}</td>
                      <td className="px-3 py-2">{m.status}</td>
                      <td className="px-3 py-2">
                        {new Date(m.expiresAt).toLocaleDateString()}
                      </td>
                      <td className="px-3 py-2">
                        {m.lastUsedAt
                          ? new Date(m.lastUsedAt).toLocaleString()
                          : '-'}
                      </td>
                      <td className="px-3 py-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => deleteOne(m.id)}
                        >
                          Delete
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-xl border border-gray-100 bg-white p-4 dark:border-white/10 dark:bg-gray-900">
            <h2 className="mb-3 text-sm font-semibold">
              会话摘要（{summaries.length}）
            </h2>
            <p className="mb-3 text-xs text-gray-500">
              当前摘要表尚无写入方；为空属预期。清历史只清摘要，不删偏好。
            </p>
            <div className="space-y-2">
              {summaries.length === 0 && (
                <div className="py-4 text-center text-sm text-gray-400">
                  暂无摘要落库
                </div>
              )}
              {summaries.map((s) => (
                <div
                  key={s.id}
                  className="rounded-lg border p-3 text-sm dark:border-white/10"
                >
                  <div className="text-xs text-gray-500">
                    thread={s.threadId ?? '-'} · conversation=
                    {s.conversationId ?? '-'} · seq≤{s.coveredToSeqId}
                  </div>
                  <div className="mt-1">{s.summary}</div>
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
