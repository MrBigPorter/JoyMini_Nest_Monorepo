'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRequest } from 'ahooks';
import { Button } from '@repo/ui';
import { aiContextApi } from '@/api';
import { AiErrorBanner } from '@/components/ai-ops/AiErrorBanner';
import { PageHeader } from '@/components/scaffold/PageHeader';
import { canReadContext, useAiOpsRole } from '@/lib/ai-ops-permissions';
import type { ConversationDebugSnapshot } from '@/type/types';

type JsonObject = Record<string, unknown>;

// ─── 安全读取工具：快照来自后端，字段可能缺失或形态变化 ─────────────

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 把任意值压成一行业务可读文本；空值返回空字符串。 */
function compactText(value: unknown): string {
  if (value === null || value === undefined || value === '') return '';
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return String(value);
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return '';
    return value
      .map((item) =>
        isObject(item) || Array.isArray(item)
          ? JSON.stringify(item)
          : String(item),
      )
      .join('、');
  }
  if (isObject(value)) {
    const entries = Object.entries(value).filter(
      ([, v]) => v !== null && v !== undefined && v !== '',
    );
    if (entries.length === 0) return '';
    return entries
      .map(([key, v]) => {
        const inner =
          isObject(v) || Array.isArray(v) ? JSON.stringify(v) : String(v);
        return `${key}: ${inner}`;
      })
      .join(' · ');
  }
  return String(value);
}

/** 空值统一展示“未提供”，避免页面上出现空白格。 */
function readable(value: unknown): string {
  return compactText(value) || '未提供';
}

function pick(obj: JsonObject, keys: string[]): unknown {
  for (const key of keys) {
    const value = obj[key];
    if (value !== null && value !== undefined && value !== '') return value;
  }
  return undefined;
}

function formatTime(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const ms = value < 1e12 ? value * 1000 : value;
    return new Date(ms).toLocaleString();
  }
  if (typeof value === 'string' && value.trim()) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
  }
  return '';
}

function isPermissionDenied(error: unknown): boolean {
  if (!isObject(error)) return false;
  const response = isObject(error.response) ? error.response : undefined;
  return (
    response?.status === 403 || error.code === 403 || error.statusCode === 403
  );
}

function errorMessage(error: unknown): string {
  if (!isObject(error)) return '';
  if (typeof error.message === 'string' && error.message) {
    return error.message;
  }
  if (isObject(error.response) && isObject(error.response.data)) {
    const message = error.response.data.message;
    if (typeof message === 'string' && message) return message;
  }
  return '';
}

const SNAPSHOT_ERROR_MESSAGES: Record<string, string> = {
  graph_not_initialized:
    'AI 图谱尚未初始化，暂时读不到会话上下文，请稍后重试。',
  thread_not_found: '未找到该会话的 checkpoint（会话不存在或尚未产生对话）。',
  inspect_failed: '读取会话上下文失败，请稍后重试。',
};

function snapshotErrorMessage(code: string): string {
  return SNAPSHOT_ERROR_MESSAGES[code] ?? `读取上下文失败（${code}）`;
}

const FLOW_ROWS: Array<{ label: string; keys: string[] }> = [
  { label: '流程', keys: ['flow', 'activeFlow'] },
  { label: '流程类型', keys: ['flowType', 'type'] },
  { label: '步骤', keys: ['step'] },
  { label: '状态', keys: ['status'] },
  { label: '槽位', keys: ['slots', 'data'] },
];

const KNOWN_FLOW_KEYS = new Set([
  'flow',
  'activeFlow',
  'flowType',
  'type',
  'step',
  'status',
  'slots',
  'data',
]);

const MESSAGE_ROLE_LABELS: Record<string, string> = {
  human: '用户',
  user: '用户',
  ai: 'AI',
  assistant: 'AI',
  human_agent: '人工客服',
  system: '系统',
  tool: '工具',
};

const ACTION_STATUS_LABELS: Record<string, string> = {
  REQUESTED: '已请求',
  CONFIRM_CREATED: '等待确认',
  CONFIRMED: '已确认待执行',
  EXECUTED: '已执行',
  EXPIRED: '已过期',
  TRANSFERRED: '已转人工',
  FAILED: '失败',
};

const ACTION_STATUS_CLASS: Record<string, string> = {
  CONFIRM_CREATED:
    'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300',
  CONFIRMED:
    'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300',
  EXECUTED:
    'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300',
  EXPIRED: 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300',
  FAILED: 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300',
  TRANSFERRED:
    'bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-gray-300',
};

const cardClass =
  'rounded-xl border border-gray-100 bg-white p-4 dark:border-white/10 dark:bg-gray-900';

/** 只展示最近的消息，避免超长会话撑爆页面。 */
const MAX_DISPLAY_MESSAGES = 20;

function hasContent(value: unknown): boolean {
  return compactText(value) !== '';
}

function hasFlowData(flow: JsonObject): boolean {
  return FLOW_ROWS.some((row) => hasContent(pick(flow, row.keys)));
}

function hasContextData(context: JsonObject): boolean {
  return (
    hasContent(context.activeEntity) ||
    hasContent(context.slots) ||
    (Array.isArray(context.corrections) && context.corrections.length > 0) ||
    (Array.isArray(context.unresolved) && context.unresolved.length > 0)
  );
}

export default function AiContextPage() {
  const [conversationId, setConversationId] = useState('');
  const [queryId, setQueryId] = useState('');
  const role = useAiOpsRole();
  const allowed = canReadContext(role);

  const { data, loading, error, refresh } = useRequest(
    () =>
      queryId && allowed
        ? aiContextApi.inspect(queryId)
        : Promise.resolve(null),
    { refreshDeps: [queryId, allowed] },
  );
  const snapshot = data as ConversationDebugSnapshot | null;

  // 从反馈列表的 Context 链接进入时，自动查询对应会话。
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get(
      'conversationId',
    );
    if (id) {
      setConversationId(id);
      setQueryId(id);
    }
  }, []);

  // 查询时同步 URL，刷新/分享后仍能回到同一会话。
  const runQuery = (raw: string) => {
    const id = raw.trim();
    setQueryId(id);
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    if (id) {
      url.searchParams.set('conversationId', id);
    } else {
      url.searchParams.delete('conversationId');
    }
    window.history.replaceState(
      window.history.state,
      '',
      `${url.pathname}${url.search}${url.hash}`,
    );
  };

  const flowState = isObject(snapshot?.flowState) ? snapshot.flowState : {};
  const contextState = isObject(snapshot?.contextState)
    ? snapshot.contextState
    : {};
  const pendingConfirm = isObject(snapshot?.pendingConfirm)
    ? snapshot.pendingConfirm
    : null;
  const messages = useMemo(
    () =>
      Array.isArray(snapshot?.messages)
        ? snapshot.messages.slice(-MAX_DISPLAY_MESSAGES)
        : [],
    [snapshot],
  );

  // 用 type + 时间 + 内容生成稳定 key，同文重复消息再补序号，避免 index key。
  const messageKeys = useMemo(() => {
    const seen = new Map<string, number>();
    return messages.map((message) => {
      const raw = message as unknown as JsonObject;
      const time = compactText(raw.createdAt ?? raw.timestamp ?? raw.time);
      const base = `${message.type}|${time}|${message.content}`;
      const occurrence = seen.get(base) ?? 0;
      seen.set(base, occurrence + 1);
      return `${base}#${occurrence}`;
    });
  }, [messages]);

  const flowName = compactText(pick(flowState, ['flow', 'activeFlow']));
  const flowStep = compactText(flowState.step);
  const diagnosis = snapshot?.diagnosis;
  const diagnosisFlags = diagnosis?.flags ?? [];
  const actions = snapshot?.actions ?? [];
  const extraFlowKeys = Object.keys(flowState).filter(
    (key) => !KNOWN_FLOW_KEYS.has(key) && hasContent(flowState[key]),
  );
  const slotEntries = isObject(contextState.slots)
    ? Object.entries(contextState.slots).filter(([, value]) => hasContent(value))
    : [];
  const corrections = Array.isArray(contextState.corrections)
    ? contextState.corrections
    : [];
  const unresolved = Array.isArray(contextState.unresolved)
    ? contextState.unresolved
    : [];
  const paramEntries = pendingConfirm
    ? Object.entries(pendingConfirm.params ?? {}).filter(([, value]) =>
        hasContent(value),
      )
    : [];
  const snapshotUserId = compactText(
    (snapshot as unknown as JsonObject | null)?.userId,
  );

  const statusLine = !snapshot
    ? '暂无快照'
    : pendingConfirm
      ? `等待确认：${readable(pendingConfirm.action)}（未执行）`
      : flowName
        ? flowStep === 'COMPLETED'
          ? `流程「${flowName}」已结束（COMPLETED）`
          : `流程「${flowName}」进行中${flowStep ? `，当前步骤 ${flowStep}` : ''}`
        : messages.length > 0
          ? '无进行中的业务流程，最近有对话记录'
          : '暂无上下文数据';

  const isEmpty =
    !!snapshot &&
    !pendingConfirm &&
    messages.length === 0 &&
    !hasFlowData(flowState) &&
    !hasContextData(contextState);

  if (!allowed) {
    return (
      <div className="space-y-5 p-4">
        <PageHeader
          title="会话上下文"
          description="查看这个会话在办什么、卡在哪、AI 理解了什么、有没有待确认操作"
        />
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
          当前角色为 {role || 'viewer'}，无权查看会话上下文。请联系管理员开通
          Context 读取权限。
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5 p-4">
      <PageHeader
        title="会话上下文"
        description="查看这个会话在办什么、卡在哪、AI 理解了什么、有没有待确认操作"
      />

      <div className="flex flex-wrap items-center gap-2">
        <input
          className="min-w-[300px] rounded-lg border px-3 py-2 text-sm dark:border-white/10 dark:bg-gray-800"
          placeholder="conversationId"
          value={conversationId}
          onChange={(e) => setConversationId(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') runQuery(conversationId);
          }}
        />
        <Button onClick={() => runQuery(conversationId)}>查询</Button>
      </div>

      {snapshot && !snapshot.error && diagnosis ? (
        diagnosisFlags.length > 0 ? (
          <section className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">
                诊断摘要 · {diagnosisFlags.length} 项
              </h2>
              {diagnosis.lastUserMessageAt ? (
                <span className="text-xs text-amber-700 dark:text-amber-300/80">
                  最后用户消息 {formatTime(diagnosis.lastUserMessageAt)}
                </span>
              ) : null}
            </div>
            <ul className="mt-3 space-y-2">
              {diagnosisFlags.map((flag) => (
                <li key={flag.key} className="flex items-start gap-2">
                  <span
                    className={
                      flag.severity === 'high'
                        ? 'mt-0.5 rounded-full bg-red-100 px-1.5 py-0.5 text-[11px] font-medium text-red-700 dark:bg-red-500/20 dark:text-red-300'
                        : 'mt-0.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-500/20 dark:text-amber-300'
                    }
                  >
                    异常
                  </span>
                  <span>
                    <span className="font-medium">{flag.label}</span>
                    <span className="text-amber-800/80 dark:text-amber-200/70">
                      {' '}
                      — {flag.detail}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300">
            未发现未回复、语言不一致、敏感信息索要或流程错位等明显异常。
          </div>
        )
      ) : null}

      {loading ? (
        <div className="py-6 text-center text-sm text-gray-400">Loading...</div>
      ) : !queryId ? (
        <div className="py-6 text-center text-sm text-gray-400">
          输入 conversationId 查询
        </div>
      ) : error ? (
        isPermissionDenied(error) ? (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
            无权查看该会话上下文（403）。请联系管理员确认你的 AI Ops 角色权限。
          </div>
        ) : (
          <AiErrorBanner
            message={
              errorMessage(error) || '读取会话上下文失败，请稍后重试。'
            }
            onRetry={() => {
              void refresh();
            }}
          />
        )
      ) : snapshot?.error ? (
        <div className="rounded-xl border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-700 dark:border-orange-500/30 dark:bg-orange-500/10 dark:text-orange-300">
          <div>{snapshotErrorMessage(snapshot.error)}</div>
          <div className="mt-1 font-mono text-xs opacity-70">
            {snapshot.error}
          </div>
        </div>
      ) : snapshot ? (
        <>
          <section className={cardClass}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold">会话概览</h2>
                <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                  {statusLine}
                </p>
              </div>
              <span
                className={
                  pendingConfirm
                    ? 'rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-700 dark:bg-amber-500/15 dark:text-amber-300'
                    : 'rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-500 dark:bg-white/10 dark:text-gray-400'
                }
              >
                {pendingConfirm ? '等待确认，未执行' : '无待确认操作'}
              </span>
            </div>

            <dl className="mt-4 grid gap-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <dt className="text-gray-500">会话 ID</dt>
                <dd className="mt-1 break-all font-mono">
                  {snapshot.conversationId || queryId}
                </dd>
              </div>
              <div>
                <dt className="text-gray-500">用户 ID</dt>
                <dd className="mt-1 break-all font-mono">
                  {snapshotUserId || '未提供'}
                </dd>
              </div>
              <div>
                <dt className="text-gray-500">Previous intent</dt>
                <dd className="mt-1">
                  {snapshot.previousIntent || '未提供'}
                </dd>
              </div>
              <div>
                <dt className="text-gray-500">流程 / 步骤</dt>
                <dd className="mt-1">
                  {flowName || '未提供'}
                  {flowStep ? (
                    <span className="text-gray-500"> · {flowStep}</span>
                  ) : null}
                </dd>
              </div>
            </dl>
          </section>

          {isEmpty ? (
            <div className="rounded-xl border border-gray-100 bg-white px-4 py-6 text-center text-sm text-gray-500 dark:border-white/10 dark:bg-gray-900">
              该会话暂时没有 flowState、contextState 或消息数据。
            </div>
          ) : (
            <>
              <div className="grid gap-4 lg:grid-cols-2">
                <section className={cardClass}>
                  <h2 className="text-sm font-semibold">流程状态 flowState</h2>
                  <p className="mt-1 text-xs text-gray-500">
                    按业务字段汇总，原始结构见页面底部。
                  </p>
                  <dl className="mt-3 divide-y divide-gray-100 text-sm dark:divide-white/5">
                    {FLOW_ROWS.map((row) => {
                      const value = pick(flowState, row.keys);
                      return (
                        <div
                          key={row.label}
                          className="grid grid-cols-[88px_1fr] gap-3 py-2"
                        >
                          <dt className="text-gray-500">{row.label}</dt>
                          <dd
                            className={
                              hasContent(value)
                                ? 'break-words'
                                : 'text-gray-400'
                            }
                          >
                            {readable(value)}
                          </dd>
                        </div>
                      );
                    })}
                    {extraFlowKeys.map((key) => (
                      <div
                        key={key}
                        className="grid grid-cols-[88px_1fr] gap-3 py-2"
                      >
                        <dt className="break-all text-gray-500">{key}</dt>
                        <dd className="break-words">
                          {readable(flowState[key])}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </section>

                <section className={cardClass}>
                  <h2 className="text-sm font-semibold">
                    对话上下文 contextState
                  </h2>
                  <p className="mt-1 text-xs text-gray-500">
                    当前实体、槽位、改口历史与未解决问题。
                  </p>

                  <div className="mt-3 space-y-4 text-sm">
                    <div>
                      <div className="text-xs text-gray-500">
                        当前实体 activeEntity
                      </div>
                      <div
                        className={
                          hasContent(contextState.activeEntity)
                            ? 'mt-1 break-words'
                            : 'mt-1 text-gray-400'
                        }
                      >
                        {readable(contextState.activeEntity)}
                      </div>
                    </div>

                    <div>
                      <div className="text-xs text-gray-500">槽位 slots</div>
                      {slotEntries.length === 0 ? (
                        <div className="mt-1 text-gray-400">未提供</div>
                      ) : (
                        <ul className="mt-1 space-y-1">
                          {slotEntries.map(([key, value]) => (
                            <li
                              key={key}
                              className="flex flex-wrap gap-x-2 break-words"
                            >
                              <span className="font-mono text-xs text-gray-500">
                                {key}
                              </span>
                              <span>{readable(value)}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>

                    <div>
                      <div className="text-xs text-gray-500">
                        改口 corrections
                      </div>
                      {corrections.length === 0 ? (
                        <div className="mt-1 text-gray-400">无</div>
                      ) : (
                        <ul className="mt-1 space-y-1">
                          {corrections.map((item, index) => {
                            const record = isObject(item) ? item : {};
                            const at = formatTime(record.at);
                            return (
                              <li
                                key={`${compactText(record.from)}-${compactText(
                                  record.to,
                                )}-${compactText(record.at)}-${index}`}
                                className="break-words"
                              >
                                从「{readable(record.from)}」改为「
                                {readable(record.to)}」
                                {at ? (
                                  <span className="text-xs text-gray-400">
                                    {' '}
                                    · {at}
                                  </span>
                                ) : null}
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>

                    <div>
                      <div className="text-xs text-gray-500">
                        未解决 unresolved
                      </div>
                      {unresolved.length === 0 ? (
                        <div className="mt-1 text-gray-400">无</div>
                      ) : (
                        <ul className="mt-1 list-inside list-disc space-y-1">
                          {unresolved.map((item, index) => (
                            <li
                              key={`${compactText(item)}-${index}`}
                              className="break-words"
                            >
                              {readable(item)}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                </section>
              </div>

              <section className={cardClass}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold">
                    待确认操作 pendingConfirm
                  </h2>
                  {pendingConfirm ? (
                    <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
                      等待确认，未执行
                    </span>
                  ) : null}
                </div>

                {!pendingConfirm ? (
                  <p className="mt-3 text-sm text-gray-500">
                    当前没有待确认操作。
                  </p>
                ) : (
                  <div className="mt-3 space-y-3 text-sm">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <div className="text-xs text-gray-500">动作 action</div>
                        <div className="mt-1 break-words font-medium">
                          {readable(pendingConfirm.action)}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-gray-500">
                          摘要 summary
                        </div>
                        <div className="mt-1 break-words">
                          {readable(pendingConfirm.summary)}
                        </div>
                      </div>
                    </div>

                    <div>
                      <div className="text-xs text-gray-500">参数 params</div>
                      {paramEntries.length === 0 ? (
                        <div className="mt-1 text-gray-400">未提供</div>
                      ) : (
                        <dl className="mt-1 grid gap-2 rounded-lg bg-gray-50 p-3 text-xs dark:bg-gray-950/40 sm:grid-cols-2">
                          {paramEntries.map(([key, value]) => (
                            <div key={key} className="flex flex-wrap gap-x-2">
                              <dt className="font-mono text-gray-500">
                                {key}
                              </dt>
                              <dd className="break-words">
                                {readable(value)}
                              </dd>
                            </div>
                          ))}
                        </dl>
                      )}
                    </div>

                    <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
                      这只是等待中的确认快照，系统尚未执行该操作；需由用户在前端确认后才会生效。
                    </p>
                  </div>
                )}
              </section>

              <section className={cardClass}>
                <h2 className="text-sm font-semibold">
                  动作生命周期（{actions.length}）
                </h2>
                <p className="mt-1 text-xs text-gray-500">
                  确认卡片从创建到执行/过期/转人工的记录；没有记录代表该轮没有写操作。
                </p>
                {actions.length === 0 ? (
                  <p className="mt-3 text-sm text-gray-500">暂无动作记录。</p>
                ) : (
                  <div className="mt-3 space-y-2 text-xs">
                    {actions.map((action) => (
                      <div
                        key={action.id}
                        className="rounded-lg border border-gray-100 p-3 dark:border-white/10"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">
                            {action.action}
                          </span>
                          <span
                            className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                              ACTION_STATUS_CLASS[action.status] ??
                              'bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-gray-300'
                            }`}
                          >
                            {ACTION_STATUS_LABELS[action.status] ??
                              action.status}
                          </span>
                          <span className="ml-auto text-gray-400">
                            {formatTime(action.createdAt)}
                          </span>
                        </div>
                        <div className="mt-1 flex flex-wrap gap-3 text-gray-500">
                          {action.expiresAt ? (
                            <span>
                              过期时间 {formatTime(action.expiresAt)}
                            </span>
                          ) : null}
                          {action.messageId ? (
                            <span className="font-mono">
                              触发消息 {action.messageId}
                            </span>
                          ) : null}
                        </div>
                        {action.error ? (
                          <div className="mt-1 text-red-600 dark:text-red-300">
                            {action.error}
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section className={cardClass}>
                <h2 className="text-sm font-semibold">
                  最近消息（{messages.length}）
                </h2>
                <p className="mt-1 text-xs text-gray-500">
                  展示最近的消息，内容可能已截断。
                </p>
                <div className="mt-3 max-h-96 space-y-2 overflow-y-auto pr-1 text-xs">
                  {messages.length === 0 ? (
                    <div className="py-4 text-center text-gray-400">
                      没有消息
                    </div>
                  ) : (
                    messages.map((message, index) => {
                      const raw = message as unknown as JsonObject;
                      const source = compactText(
                        raw.source ?? raw.channel ?? raw.from,
                      );
                      const time = formatTime(
                        raw.createdAt ?? raw.timestamp ?? raw.time,
                      );
                      const roleLabel =
                        MESSAGE_ROLE_LABELS[message.type] ?? message.type;
                      return (
                        <div
                          key={messageKeys[index]}
                          className="rounded-lg border border-gray-100 p-3 dark:border-white/10"
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600 dark:bg-white/10 dark:text-gray-300">
                              {roleLabel}
                            </span>
                            {source ? (
                              <span className="text-[11px] text-gray-400">
                                来源 {source}
                              </span>
                            ) : null}
                            {diagnosis?.unanswered &&
                            index === messages.length - 1 ? (
                              <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-700 dark:bg-red-500/20 dark:text-red-300">
                                未回复
                              </span>
                            ) : null}
                            <span className="ml-auto text-[11px] text-gray-400">
                              {time || '时间未提供'}
                            </span>
                          </div>
                          <div className="mt-2 whitespace-pre-wrap break-words">
                            {message.content || '（空内容）'}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </section>
            </>
          )}

          <details className="rounded-xl border border-gray-100 bg-white dark:border-white/10 dark:bg-gray-900">
            <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-gray-600 dark:text-gray-300">
              原始 JSON（工程师）
            </summary>
            <pre className="max-h-96 overflow-auto border-t border-gray-100 p-4 text-xs dark:border-white/10">
              {JSON.stringify(snapshot, null, 2)}
            </pre>
          </details>
        </>
      ) : (
        <div className="rounded-xl border border-gray-100 bg-white px-4 py-6 text-center text-sm text-gray-500 dark:border-white/10 dark:bg-gray-900">
          未获取到该会话的上下文数据。
        </div>
      )}
    </div>
  );
}
