'use client';

import { useMemo, useState } from 'react';
import { useRequest } from 'ahooks';
import { Button } from '@repo/ui';
import { aiOpsApi } from '@/api';
import { PageHeader } from '@/components/scaffold/PageHeader';
import type {
  AiFlowAudit,
  AiFlowBinding,
  AiFlowDefinition,
} from '@/type/types';

export default function AiFlowsPage() {
  const [conversationId, setConversationId] = useState('');
  const [targetVersionId, setTargetVersionId] = useState('');
  const [reason, setReason] = useState('');
  const [actionMessage, setActionMessage] = useState('');

  const { data: definitionsData, loading: definitionsLoading } = useRequest(
    () => aiOpsApi.getFlowDefinitions(),
  );
  const {
    data: bindingsData,
    loading: bindingsLoading,
    refresh: refreshBindings,
  } = useRequest(
    () =>
      conversationId.trim()
        ? aiOpsApi.getFlowBindings(conversationId.trim())
        : Promise.resolve([]),
    { refreshDeps: [conversationId] },
  );
  const { data: auditData, refresh: refreshAudit } = useRequest(
    () =>
      aiOpsApi.getFlowAudit({
        conversationId: conversationId.trim() || undefined,
        limit: 100,
      }),
    { refreshDeps: [conversationId] },
  );

  const definitions = (definitionsData as AiFlowDefinition[] | undefined) ?? [];
  const bindings = (bindingsData as AiFlowBinding[] | undefined) ?? [];
  const audits = (auditData as AiFlowAudit[] | undefined) ?? [];
  const grouped = useMemo(() => {
    const map = new Map<string, AiFlowDefinition[]>();
    for (const d of definitions) {
      map.set(d.flowType, [...(map.get(d.flowType) ?? []), d]);
    }
    return [...map.entries()];
  }, [definitions]);

  const doSwitch = async (rollback: boolean) => {
    if (!conversationId.trim() || !targetVersionId) {
      setActionMessage('需要填写 conversationId 并选择目标版本');
      return;
    }
    if (!window.confirm(`确认${rollback ? '回滚' : '切换'}该会话的流程版本？`)) {
      return;
    }
    try {
      const payload = {
        conversationId: conversationId.trim(),
        toVersionId: targetVersionId,
        reason: reason || undefined,
      };
      const result: any = rollback
        ? await aiOpsApi.rollbackFlow(payload)
        : await aiOpsApi.switchFlow(payload);
      if (result?.ok === false) {
        setActionMessage(`拒绝：${result.reason}`);
      } else {
        setActionMessage('操作成功');
      }
      await Promise.all([refreshBindings(), refreshAudit()]);
    } catch (err: any) {
      setActionMessage(err?.message ?? '操作失败');
    }
  };

  return (
    <div className="space-y-5 p-4">
      <PageHeader
        title="AI Flow Versions"
        description="流程定义版本、会话绑定与审计；切换只改绑定指针，不撤销业务副作用"
      />

      <section className="rounded-xl border border-gray-100 bg-white p-4 dark:border-white/10 dark:bg-gray-900">
        <h2 className="mb-3 text-sm font-semibold">定义版本</h2>
        {definitionsLoading ? (
          <div className="py-6 text-center text-sm text-gray-400">Loading...</div>
        ) : grouped.length === 0 ? (
          <div className="py-6 text-center text-sm text-gray-400">
            暂无定义；首个会话进入流程时会懒注册
          </div>
        ) : (
          <div className="space-y-3">
            {grouped.map(([flowType, versions]) => (
              <div key={flowType}>
                <div className="mb-1 text-xs font-medium text-gray-500">{flowType}</div>
                <div className="flex flex-wrap gap-2">
                  {versions.map((v) => (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() => setTargetVersionId(v.id)}
                      className={`rounded-lg border px-3 py-1.5 text-xs ${
                        targetVersionId === v.id
                          ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-900/30'
                          : 'dark:border-white/10'
                      }`}
                    >
                      v{v.version} · {v.status} · {v.definitionHash.slice(0, 8)}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-xl border border-gray-100 bg-white p-4 dark:border-white/10 dark:bg-gray-900">
        <h2 className="mb-3 text-sm font-semibold">会话绑定</h2>
        <div className="flex flex-wrap items-end gap-2">
          <input
            className="min-w-[260px] rounded-lg border px-3 py-2 text-sm dark:border-white/10 dark:bg-gray-800"
            placeholder="conversationId"
            value={conversationId}
            onChange={(e) => setConversationId(e.target.value)}
          />
          <input
            className="min-w-[200px] rounded-lg border px-3 py-2 text-sm dark:border-white/10 dark:bg-gray-800"
            placeholder="切换原因（可选）"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <Button onClick={() => doSwitch(false)}>Switch</Button>
          <Button variant="outline" onClick={() => doSwitch(true)}>
            Rollback definition
          </Button>
        </div>
        {actionMessage ? (
          <div className="mt-3 text-sm text-gray-600 dark:text-gray-300">
            {actionMessage}
          </div>
        ) : null}

        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-left dark:bg-white/5">
              <tr>
                {['Flow', 'Version', 'Step', 'Thread', 'Status', 'Updated'].map((h) => (
                  <th key={h} className="px-3 py-2">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {bindingsLoading && (
                <tr><td colSpan={6} className="px-3 py-6 text-center text-gray-400">Loading...</td></tr>
              )}
              {!bindingsLoading && bindings.length === 0 && (
                <tr><td colSpan={6} className="px-3 py-6 text-center text-gray-400">
                  输入 conversationId 查询绑定
                </td></tr>
              )}
              {bindings.map((b) => (
                <tr key={b.id} className="border-t border-gray-100 dark:border-white/5">
                  <td className="px-3 py-2">{b.flowType}</td>
                  <td className="px-3 py-2">{b.definition?.version ?? '-'}</td>
                  <td className="px-3 py-2">{b.flowStep}</td>
                  <td className="px-3 py-2 font-mono text-xs">{b.threadId ?? '-'}</td>
                  <td className="px-3 py-2">{b.status}</td>
                  <td className="px-3 py-2">{new Date(b.updatedAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-xl border border-gray-100 bg-white p-4 dark:border-white/10 dark:bg-gray-900">
        <h2 className="mb-3 text-sm font-semibold">审计日志</h2>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-left dark:bg-white/5">
              <tr>
                {['Time', 'Action', 'Flow', 'From', 'To', 'Actor', 'Reason'].map((h) => (
                  <th key={h} className="px-3 py-2">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {audits.length === 0 && (
                <tr><td colSpan={7} className="px-3 py-6 text-center text-gray-400">暂无审计记录</td></tr>
              )}
              {audits.map((a) => (
                <tr key={a.id} className="border-t border-gray-100 dark:border-white/5">
                  <td className="px-3 py-2">{new Date(a.createdAt).toLocaleString()}</td>
                  <td className="px-3 py-2">{a.action}</td>
                  <td className="px-3 py-2">{a.flowType}</td>
                  <td className="px-3 py-2 font-mono text-xs">{a.fromVersionId?.slice(0, 8) ?? '-'}</td>
                  <td className="px-3 py-2 font-mono text-xs">{a.toVersionId?.slice(0, 8) ?? '-'}</td>
                  <td className="px-3 py-2 font-mono text-xs">{a.actorId ?? '-'}</td>
                  <td className="max-w-[220px] truncate px-3 py-2" title={a.reason ?? ''}>{a.reason ?? '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
