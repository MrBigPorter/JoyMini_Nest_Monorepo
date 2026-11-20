'use client';

import { useMemo, useState } from 'react';
import { useRequest } from 'ahooks';
import { Button } from '@repo/ui';
import { aiOpsApi } from '@/api';
import { PageHeader } from '@/components/scaffold/PageHeader';
import {
  canManageFlows,
  useAiOpsRole,
} from '@/lib/ai-ops-permissions';
import type {
  AiFlowAudit,
  AiFlowBinding,
  AiFlowDefinition,
} from '@/type/types';

/** 业务类型中文名；原始 flowType 仍放在 title 里，便于和日志对照。 */
const FLOW_TYPE_LABELS: Record<string, string> = {
  DEPOSIT: '充值',
  WITHDRAWAL: '取款',
  COUPON_CLAIM: '领券',
  BALANCE_QUERY: '查余额',
  ORDER_QUERY: '查订单',
  COUPON_QUERY: '查优惠券',
  POLICY: '政策查询',
  GENERAL: '闲聊',
};

const DEFINITION_STATUS_LABELS: Record<string, string> = {
  ACTIVE: '生效中',
  DRAFT: '草稿',
  DEPRECATED: '已弃用',
  ARCHIVED: '已归档',
};

const BINDING_STATUS_LABELS: Record<string, string> = {
  ACTIVE: '生效中',
  ROLLED_BACK: '已换回',
};

const ACTION_LABELS: Record<string, string> = {
  BIND: '新会话绑定',
  SWITCH: '切换版本',
  ROLLBACK_DEFINITION: '换回旧版本（仅绑定）',
  ROLLBACK_STATE: '回滚会话状态',
};

/** 后端 switch/rollback 的拒绝码 → 运营可读原因。 */
const REJECTION_REASON_LABELS: Record<string, string> = {
  target_version_not_found: '目标版本不存在，请刷新版本列表后重试',
  flow_type_mismatch: '目标版本与当前会话的流程类型不一致',
  target_version_not_active: '该版本当前不是生效版本，不能用于“切换流程版本”',
  target_version_draft: '草稿版本不能换回',
  binding_not_found: '该会话没有对应流程类型的绑定，无法切换',
  same_version: '目标版本与当前绑定版本相同，无需切换',
  flow_in_progress: '流程正在填写、确认或查询中，请等本次流程结束后再切换',
  conversation_not_found: '会话不存在或已被删除',
  human_handling: '会话正由人工客服接待，不能切换流程版本',
  thread_drift: '会话线程已变化（与绑定记录不一致），请先人工核对',
  pending_check_unavailable: '无法确认是否有待确认操作（缓存不可用），已拒绝切换',
  state_rollback_unavailable: '状态回滚能力不可用',
  same_checkpoint: '目标检查点与当前检查点相同',
};

function flowTypeLabel(flowType: string): string {
  const label = FLOW_TYPE_LABELS[flowType];
  return label ? `${label} (${flowType})` : flowType;
}

function statusLabel(
  status: string,
  labels: Record<string, string>,
): string {
  return labels[status] ?? status;
}

function translateRejection(reason: string): string {
  return REJECTION_REASON_LABELS[reason] ?? `未知拒绝原因（${reason}）`;
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err ?? '未知错误');
}

function bindingVersion(
  binding: AiFlowBinding,
  byId: Map<string, AiFlowDefinition>,
): string {
  if (binding.definition?.version != null) return `v${binding.definition.version}`;
  const def = byId.get(binding.definitionVersionId);
  return def ? `v${def.version}` : '版本未知';
}

function StatusBadge({
  status,
  labels,
}: {
  status: string;
  labels: Record<string, string>;
}) {
  return (
    <span
      title={status}
      className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-700 dark:bg-white/10 dark:text-gray-200"
    >
      {statusLabel(status, labels)}
    </span>
  );
}

type ActionState = { tone: 'success' | 'error'; message: string } | null;

export default function AiFlowsPage() {
  const role = useAiOpsRole();
  const canWrite = canManageFlows(role);

  const [conversationId, setConversationId] = useState('');
  const [targetVersionId, setTargetVersionId] = useState('');
  const [reason, setReason] = useState('');
  const [actionState, setActionState] = useState<ActionState>(null);
  const [submitting, setSubmitting] = useState(false);

  const {
    data: definitionsData,
    loading: definitionsLoading,
    error: definitionsError,
    refresh: refreshDefinitions,
  } = useRequest(() => aiOpsApi.getFlowDefinitions());
  const {
    data: bindingsData,
    loading: bindingsLoading,
    error: bindingsError,
    refresh: refreshBindings,
  } = useRequest(
    () =>
      conversationId.trim()
        ? aiOpsApi.getFlowBindings(conversationId.trim())
        : Promise.resolve([]),
    { refreshDeps: [conversationId] },
  );
  const {
    data: auditData,
    loading: auditLoading,
    error: auditError,
    refresh: refreshAudit,
  } = useRequest(
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

  const definitionById = useMemo(
    () => new Map(definitions.map((d) => [d.id, d])),
    [definitions],
  );
  const selectedTarget = useMemo(
    () => definitions.find((d) => d.id === targetVersionId) ?? null,
    [definitions, targetVersionId],
  );

  const hasConversation = Boolean(conversationId.trim());
  const bindingsReady = hasConversation && !bindingsLoading && !bindingsError;
  const bindingFlowTypes = new Set(bindings.map((b) => b.flowType));
  // 数据足够判断时，提前拦住明显会失败的跨流程类型切换。
  const noBinding = bindingsReady && bindings.length === 0;
  const targetMismatch =
    bindingsReady &&
    bindings.length > 0 &&
    selectedTarget != null &&
    !bindingFlowTypes.has(selectedTarget.flowType);

  const canAttempt =
    canWrite &&
    !submitting &&
    hasConversation &&
    selectedTarget != null &&
    !noBinding &&
    !targetMismatch;
  const switchDisabled = !canAttempt || selectedTarget?.status !== 'ACTIVE';
  const rollbackDisabled = !canAttempt || selectedTarget?.status === 'DRAFT';

  const selectedBinding = selectedTarget
    ? bindings.find((b) => b.flowType === selectedTarget.flowType)
    : undefined;

  const renderVersionRef = (versionId: string | null) => {
    if (!versionId) return <span>-</span>;
    const definition = definitionById.get(versionId);
    return (
      <span title={versionId}>
        {definition ? `v${definition.version}` : `${versionId.slice(0, 8)}…`}
      </span>
    );
  };

  const doSwitch = async (mode: 'switch' | 'rollback') => {
    setActionState(null);

    if (!hasConversation) {
      setActionState({ tone: 'error', message: '请先填写 conversationId' });
      return;
    }
    if (!selectedTarget) {
      setActionState({ tone: 'error', message: '请先选择目标版本' });
      return;
    }
    if (!reason.trim()) {
      setActionState({
        tone: 'error',
        message: '请填写切换原因（用于审计追溯）',
      });
      return;
    }
    if (targetMismatch) {
      setActionState({
        tone: 'error',
        message: `目标版本属于「${flowTypeLabel(
          selectedTarget.flowType,
        )}」，但该会话没有对应绑定，切换会被拒绝`,
      });
      return;
    }
    if (mode === 'switch' && selectedTarget.status !== 'ACTIVE') {
      setActionState({
        tone: 'error',
        message: `版本 v${selectedTarget.version} 当前为「${statusLabel(
          selectedTarget.status,
          DEFINITION_STATUS_LABELS,
        )}」，不能用于切换；如需换回旧绑定，请使用“换回旧版本（仅绑定）”`,
      });
      return;
    }
    if (mode === 'rollback' && selectedTarget.status === 'DRAFT') {
      setActionState({
        tone: 'error',
        message: '草稿版本不能换回',
      });
      return;
    }

    const actionText =
      mode === 'rollback' ? '换回旧版本（仅绑定）' : '切换流程版本';
    const currentVersion = selectedBinding
      ? bindingVersion(selectedBinding, definitionById)
      : '未绑定';
    const confirmed = window.confirm(
      `${actionText}\n\n` +
        `会话：${conversationId.trim()}\n` +
        `流程：${flowTypeLabel(selectedTarget.flowType)}\n` +
        `版本：${currentVersion} → v${selectedTarget.version}\n` +
        `原因：${reason.trim()}\n\n` +
        '此操作只修改绑定指针，不会撤销已完成的退款、订单或优惠券，' +
        '也不会回滚流程状态。确认执行？',
    );
    if (!confirmed) return;

    setSubmitting(true);
    try {
      const payload = {
        conversationId: conversationId.trim(),
        toVersionId: selectedTarget.id,
        flowType: selectedTarget.flowType,
        reason: reason.trim(),
      };
      const result: any =
        mode === 'rollback'
          ? await aiOpsApi.rollbackFlow(payload)
          : await aiOpsApi.switchFlow(payload);
      if (result?.ok === false) {
        setActionState({
          tone: 'error',
          message: `操作被拒绝：${translateRejection(
            String(result.reason ?? ''),
          )}`,
        });
      } else {
        setActionState({
          tone: 'success',
          message: `${actionText}成功：${flowTypeLabel(
            selectedTarget.flowType,
          )} ${currentVersion} → v${selectedTarget.version}`,
        });
      }
      await Promise.all([refreshBindings(), refreshAudit()]);
    } catch (err) {
      setActionState({
        tone: 'error',
        message: `操作失败：${errorText(err)}`,
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-5 p-4">
      <PageHeader
        title="流程版本"
        description="查看 AI 会话当前绑定的流程版本，并在安全前提下切换；切换只改绑定指针，不撤销已完成的业务结果"
      />

      {!canWrite ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
          当前角色为只读，可以查看流程版本、会话绑定和审计，但不能切换版本。
        </div>
      ) : null}

      <section className="rounded-xl border border-gray-100 bg-white p-4 dark:border-white/10 dark:bg-gray-900">
        <div className="mb-1 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">流程定义版本</h2>
          <Button size="sm" variant="outline" onClick={refreshDefinitions}>
            刷新
          </Button>
        </div>
        <p className="mb-3 text-xs text-gray-500 dark:text-gray-400">
          版本号越大表示登记越晚；只有「生效中」的版本可用于切换，已弃用/已归档版本只能换回绑定。
        </p>

        {definitionsLoading ? (
          <div className="py-6 text-center text-sm text-gray-400">
            定义版本加载中…
          </div>
        ) : definitionsError ? (
          <div className="py-6 text-center text-sm text-red-600 dark:text-red-400">
            定义版本加载失败：{errorText(definitionsError)}
          </div>
        ) : grouped.length === 0 ? (
          <div className="py-6 text-center text-sm text-gray-400">
            暂无定义版本；首个会话进入流程时会自动登记。
          </div>
        ) : (
          <div className="space-y-3">
            {grouped.map(([flowType, versions]) => (
              <div key={flowType}>
                <div
                  className="mb-1 text-xs font-medium text-gray-500"
                  title={flowType}
                >
                  {flowTypeLabel(flowType)}
                </div>
                <div className="flex flex-wrap gap-2">
                  {versions.map((v) => (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() => setTargetVersionId(v.id)}
                      aria-pressed={targetVersionId === v.id}
                      aria-label={`${flowTypeLabel(flowType)} v${v.version}，${statusLabel(
                        v.status,
                        DEFINITION_STATUS_LABELS,
                      )}`}
                      className={`rounded-lg border px-3 py-1.5 text-xs ${
                        targetVersionId === v.id
                          ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-900/30'
                          : 'dark:border-white/10'
                      }`}
                    >
                      v{v.version} ·{' '}
                      <StatusBadge
                        status={v.status}
                        labels={DEFINITION_STATUS_LABELS}
                      />
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-xl border border-gray-100 bg-white p-4 dark:border-white/10 dark:bg-gray-900">
        <h2 className="mb-3 text-sm font-semibold">会话绑定与版本切换</h2>

        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-xs text-gray-500">
            conversationId
            <input
              className="min-w-[260px] rounded-lg border px-3 py-2 text-sm dark:border-white/10 dark:bg-gray-800"
              placeholder="conversationId"
              value={conversationId}
              onChange={(e) => setConversationId(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-gray-500">
            切换原因（必填）
            <input
              className="min-w-[240px] rounded-lg border px-3 py-2 text-sm dark:border-white/10 dark:bg-gray-800"
              placeholder="例如：修复取款流程确认话术"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          {canWrite ? (
            <>
              <Button
                onClick={() => doSwitch('switch')}
                disabled={switchDisabled}
                title={
                  selectedTarget?.status !== 'ACTIVE'
                    ? '只有生效中的版本可以切换'
                    : undefined
                }
              >
                切换流程版本
              </Button>
              <Button
                variant="outline"
                onClick={() => doSwitch('rollback')}
                disabled={rollbackDisabled}
                title="仅修改绑定指针，不撤销业务结果"
              >
                换回旧版本（仅绑定）
              </Button>
            </>
          ) : (
            <span className="text-xs text-gray-400">只读，无切换权限</span>
          )}
        </div>

        <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
          切换/换回只修改会话的流程绑定指针；不会撤销已完成的退款、订单或优惠券，也不会回滚流程状态。
        </p>

        {noBinding ? (
          <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
            该会话还没有任何流程绑定，无法切换版本；新会话会在首次进入流程时自动绑定。
          </div>
        ) : null}
        {targetMismatch && selectedTarget ? (
          <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
            目标版本属于「{flowTypeLabel(selectedTarget.flowType)}」，但该会话当前绑定的是
            {bindings.map((b) => flowTypeLabel(b.flowType)).join('、')}
            ，不能跨流程类型切换。
          </div>
        ) : null}
        {selectedTarget &&
        selectedTarget.status !== 'ACTIVE' &&
        !targetMismatch ? (
          <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
            所选版本 v{selectedTarget.version} 为「
            {statusLabel(selectedTarget.status, DEFINITION_STATUS_LABELS)}
            」，
            {selectedTarget.status === 'DRAFT'
              ? '既不能切换也不能换回。'
              : '不能用于“切换流程版本”；如需换回旧绑定，请使用“换回旧版本（仅绑定）”。'}
          </div>
        ) : null}

        {actionState ? (
          <div
            role={actionState.tone === 'error' ? 'alert' : 'status'}
            className={`mt-3 rounded-lg px-3 py-2 text-sm ${
              actionState.tone === 'error'
                ? 'border border-red-200 bg-red-50 text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300'
                : 'border border-green-200 bg-green-50 text-green-700 dark:border-green-500/30 dark:bg-green-500/10 dark:text-green-300'
            }`}
          >
            {actionState.message}
          </div>
        ) : null}

        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-left dark:bg-white/5">
              <tr>
                {[
                  '流程类型',
                  '当前版本',
                  '绑定状态',
                  '当前步骤',
                  '线程',
                  '更新时间',
                ].map((h) => (
                  <th key={h} className="px-3 py-2">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {bindingsLoading && (
                <tr>
                  <td
                    colSpan={6}
                    className="px-3 py-6 text-center text-gray-400"
                  >
                    会话绑定加载中…
                  </td>
                </tr>
              )}
              {bindingsError && (
                <tr>
                  <td
                    colSpan={6}
                    className="px-3 py-6 text-center text-red-600 dark:text-red-400"
                  >
                    会话绑定加载失败：{errorText(bindingsError)}
                  </td>
                </tr>
              )}
              {!bindingsLoading &&
                !bindingsError &&
                bindings.length === 0 && (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-3 py-6 text-center text-gray-400"
                    >
                      {hasConversation
                        ? '该会话暂无流程绑定'
                        : '输入 conversationId 查询绑定'}
                    </td>
                  </tr>
                )}
              {bindings.map((b) => (
                <tr
                  key={b.id}
                  className="border-t border-gray-100 dark:border-white/5"
                >
                  <td className="px-3 py-2" title={b.flowType}>
                    {flowTypeLabel(b.flowType)}
                  </td>
                  <td className="px-3 py-2">
                    {bindingVersion(b, definitionById)}
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge
                      status={b.status}
                      labels={BINDING_STATUS_LABELS}
                    />
                  </td>
                  <td className="px-3 py-2">{b.flowStep}</td>
                  <td
                    className="px-3 py-2 font-mono text-xs"
                    title={b.threadId ?? ''}
                  >
                    {b.threadId ?? '-'}
                  </td>
                  <td className="px-3 py-2">
                    {new Date(b.updatedAt).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-xl border border-gray-100 bg-white p-4 dark:border-white/10 dark:bg-gray-900">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">审计日志</h2>
          <Button size="sm" variant="outline" onClick={refreshAudit}>
            刷新
          </Button>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-left dark:bg-white/5">
              <tr>
                {[
                  '时间',
                  '操作',
                  '流程类型',
                  '原版本',
                  '目标版本',
                  '操作人',
                  '原因 / 结果',
                ].map((h) => (
                  <th key={h} className="px-3 py-2">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {auditLoading && (
                <tr>
                  <td
                    colSpan={7}
                    className="px-3 py-6 text-center text-gray-400"
                  >
                    审计日志加载中…
                  </td>
                </tr>
              )}
              {auditError && (
                <tr>
                  <td
                    colSpan={7}
                    className="px-3 py-6 text-center text-red-600 dark:text-red-400"
                  >
                    审计日志加载失败：{errorText(auditError)}
                  </td>
                </tr>
              )}
              {!auditLoading && !auditError && audits.length === 0 && (
                <tr>
                  <td
                    colSpan={7}
                    className="px-3 py-6 text-center text-gray-400"
                  >
                    暂无审计记录
                  </td>
                </tr>
              )}
              {audits.map((a) => (
                <tr
                  key={a.id}
                  className="border-t border-gray-100 dark:border-white/5"
                >
                  <td className="px-3 py-2">
                    {new Date(a.createdAt).toLocaleString()}
                  </td>
                  <td className="px-3 py-2" title={a.action}>
                    {ACTION_LABELS[a.action] ?? a.action}
                  </td>
                  <td className="px-3 py-2" title={a.flowType}>
                    {flowTypeLabel(a.flowType)}
                  </td>
                  <td className="px-3 py-2">
                    {renderVersionRef(a.fromVersionId)}
                  </td>
                  <td className="px-3 py-2">
                    {renderVersionRef(a.toVersionId)}
                  </td>
                  <td
                    className="px-3 py-2 font-mono text-xs"
                    title={a.actorId ?? ''}
                  >
                    {a.actorId ?? '未记录'}
                  </td>
                  <td
                    className="max-w-[260px] truncate px-3 py-2"
                    title={a.reason ?? ''}
                  >
                    {a.reason ?? '-'}
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
