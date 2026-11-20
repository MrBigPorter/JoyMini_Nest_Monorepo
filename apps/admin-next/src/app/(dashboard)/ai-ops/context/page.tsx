'use client';

import { useState } from 'react';
import { useRequest } from 'ahooks';
import { Button } from '@repo/ui';
import { aiContextApi } from '@/api';
import { PageHeader } from '@/components/scaffold/PageHeader';
import type { ConversationDebugSnapshot } from '@/type/types';

export default function AiContextPage() {
  const [conversationId, setConversationId] = useState('');
  const [queryId, setQueryId] = useState('');
  const { data, loading } = useRequest(
    () =>
      queryId
        ? aiContextApi.inspect(queryId)
        : Promise.resolve(null),
    { refreshDeps: [queryId] },
  );
  const snapshot = data as ConversationDebugSnapshot | null;

  return (
    <div className="space-y-5 p-4">
      <PageHeader
        title="Context Debug"
        description="只读查看单会话 checkpoint 中的 flowState/contextState；不写消息、不调模型"
      />

      <div className="flex flex-wrap items-center gap-2">
        <input
          className="min-w-[300px] rounded-lg border px-3 py-2 text-sm dark:border-white/10 dark:bg-gray-800"
          placeholder="conversationId"
          value={conversationId}
          onChange={(e) => setConversationId(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') setQueryId(conversationId.trim());
          }}
        />
        <Button onClick={() => setQueryId(conversationId.trim())}>查询</Button>
      </div>

      {loading ? (
        <div className="py-6 text-center text-sm text-gray-400">Loading...</div>
      ) : !queryId ? (
        <div className="py-6 text-center text-sm text-gray-400">输入 conversationId 查询</div>
      ) : snapshot?.error ? (
        <div className="rounded-xl border border-orange-200 p-4 text-sm text-orange-700 dark:border-orange-500/30 dark:text-orange-300">
          {snapshot.error}
        </div>
      ) : snapshot ? (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border p-3 text-xs dark:border-white/10">
              <div className="text-gray-500">Thread</div>
              <div className="mt-1 break-all font-mono">{snapshot.threadId ?? '-'}</div>
            </div>
            <div className="rounded-xl border p-3 text-xs dark:border-white/10">
              <div className="text-gray-500">Checkpoint</div>
              <div className="mt-1 break-all font-mono">{snapshot.checkpointId ?? '-'}</div>
            </div>
            <div className="rounded-xl border p-3 text-xs dark:border-white/10">
              <div className="text-gray-500">Previous intent</div>
              <div className="mt-1">{snapshot.previousIntent || '-'}</div>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <section className="rounded-xl border p-4 dark:border-white/10">
              <h2 className="mb-2 text-sm font-semibold">flowState</h2>
              <pre className="max-h-64 overflow-auto rounded-lg bg-gray-50 p-3 text-xs dark:bg-gray-900">
                {JSON.stringify(snapshot.flowState, null, 2)}
              </pre>
            </section>
            <section className="rounded-xl border p-4 dark:border-white/10">
              <h2 className="mb-2 text-sm font-semibold">contextState</h2>
              <pre className="max-h-64 overflow-auto rounded-lg bg-gray-50 p-3 text-xs dark:bg-gray-900">
                {JSON.stringify(snapshot.contextState, null, 2)}
              </pre>
            </section>
            <section className="rounded-xl border p-4 dark:border-white/10">
              <h2 className="mb-2 text-sm font-semibold">pendingConfirm</h2>
              <pre className="max-h-64 overflow-auto rounded-lg bg-gray-50 p-3 text-xs dark:bg-gray-900">
                {JSON.stringify(snapshot.pendingConfirm, null, 2)}
              </pre>
            </section>
            <section className="rounded-xl border p-4 dark:border-white/10">
              <h2 className="mb-2 text-sm font-semibold">最近消息（截断）</h2>
              <div className="max-h-64 space-y-2 overflow-y-auto text-xs">
                {snapshot.messages.length === 0 && (
                  <div className="text-gray-400">没有消息</div>
                )}
                {snapshot.messages.map((m, index) => (
                  <div key={index} className="rounded-lg border p-2 dark:border-white/10">
                    <div className="text-gray-500">{m.type}</div>
                    <div>{m.content}</div>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </>
      ) : null}
    </div>
  );
}
