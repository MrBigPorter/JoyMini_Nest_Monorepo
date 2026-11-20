'use client';

import { useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRequest } from 'ahooks';
import { Button } from '@repo/ui';
import { aiOpsApi, clientUserApi } from '@/api';
import { AiErrorBanner } from '@/components/ai-ops/AiErrorBanner';
import { PageHeader } from '@/components/scaffold/PageHeader';
import {
  canDeleteMemory,
  canReadMemory,
  useAiOpsRole,
} from '@/lib/ai-ops-permissions';
import { maskPhone } from '@/lib/security-utils';
import type {
  AiMemoryRow,
  AiMemorySummaryRow,
  ClientUserListItem,
} from '@/type/types';

// ─── 记忆分类与可读文案 ──────────────────────────────────────────
// 后端 kind 只有 preference / fact，但运营看的是业务分类，不是表字段。

const CATEGORY_ORDER = ['基本信息', '偏好', '业务事实', '其他'] as const;
type MemoryCategory = (typeof CATEGORY_ORDER)[number];

const BASIC_KEYS = new Set([
  'name',
  'nickname',
  'addressAs',
  'avatar',
  'gender',
  'age',
  'birthday',
]);

const KEY_LABELS: Record<string, string> = {
  language: '语言偏好',
  addressAs: '称呼',
  name: '姓名',
  nickname: '昵称',
  city: '所在城市',
  kyc_verified: '实名状态',
};

function categoryOf(memory: AiMemoryRow): MemoryCategory {
  if (
    BASIC_KEYS.has(memory.key) ||
    memory.kind === 'profile' ||
    memory.kind === 'basic'
  ) {
    return '基本信息';
  }
  if (memory.kind === 'preference') return '偏好';
  if (memory.kind === 'fact' || memory.kind === 'business') return '业务事实';
  return '其他';
}

function memoryLabel(memory: AiMemoryRow): string {
  return KEY_LABELS[memory.key] ?? memory.key;
}

// ─── 展示工具 ────────────────────────────────────────────────────

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
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

function formatTime(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function formatConfidence(value: number): string {
  if (!Number.isFinite(value)) return '—';
  const percent = value <= 1 ? value * 100 : value;
  return `${Math.round(percent)}%`;
}

function statusLabel(status: string): string {
  switch (status) {
    case 'ACTIVE':
      return '生效中';
    case 'DELETED':
      return '已软删除';
    case 'EXPIRED':
      return '已过期';
    default:
      return status || '未知';
  }
}

function statusClass(status: string): string {
  switch (status) {
    case 'ACTIVE':
      return 'text-emerald-600 dark:text-emerald-400';
    case 'DELETED':
      return 'text-red-600 dark:text-red-400';
    case 'EXPIRED':
      return 'text-orange-600 dark:text-orange-400';
    default:
      return 'text-gray-500';
  }
}

const cardClass =
  'rounded-xl border border-gray-100 bg-white p-4 dark:border-white/10 dark:bg-gray-900';

// ─── 页面 ────────────────────────────────────────────────────────

export default function AiMemoryPage() {
  const role = useAiOpsRole();
  const allowed = canReadMemory(role);
  const canDelete = canDeleteMemory(role);

  // 用户搜索（主入口）
  const [searchMode, setSearchMode] = useState<'phone' | 'userId'>('phone');
  const [searchTerm, setSearchTerm] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [searchResults, setSearchResults] = useState<
    ClientUserListItem[] | null
  >(null);
  const searchSeq = useRef(0);

  // 当前查看的用户
  const [selectedUserId, setSelectedUserId] = useState('');
  const [selectedUser, setSelectedUser] = useState<ClientUserListItem | null>(
    null,
  );
  const [directUserId, setDirectUserId] = useState('');
  const profileSeq = useRef(0);

  const { data, loading, error, refresh } = useRequest(
    () =>
      selectedUserId
        ? aiOpsApi.getMemoryUser(selectedUserId)
        : Promise.resolve(null),
    { refreshDeps: [selectedUserId] },
  );

  // useRequest 在切换用户时可能短暂保留上一个用户的数据，必须按 userId 校验。
  const activeData = useMemo(() => {
    if (!data || !selectedUserId) return null;
    return data.userId === selectedUserId ? data : null;
  }, [data, selectedUserId]);

  const memories = useMemo(
    () => (activeData?.memories ?? []) as AiMemoryRow[],
    [activeData],
  );
  const summaries = useMemo(
    () => (activeData?.summaries ?? []) as AiMemorySummaryRow[],
    [activeData],
  );
  const fetchingMemories =
    !!selectedUserId && (loading || (!activeData && !error));

  const grouped = useMemo(() => {
    const buckets = new Map<MemoryCategory, AiMemoryRow[]>();
    for (const category of CATEGORY_ORDER) buckets.set(category, []);
    for (const memory of memories) {
      buckets.get(categoryOf(memory))!.push(memory);
    }
    return CATEGORY_ORDER.map((category) => ({
      category,
      items: buckets.get(category)!,
    })).filter((group) => group.items.length > 0);
  }, [memories]);

  const runSearch = async () => {
    const term = searchTerm.trim();
    if (!term) {
      setSearchError('请输入手机号或用户 ID');
      setSearchResults(null);
      return;
    }
    const seq = ++searchSeq.current;
    setSearching(true);
    setSearchError('');
    try {
      const res = await clientUserApi.getUsers({
        page: 1,
        pageSize: 10,
        ...(searchMode === 'phone' ? { phone: term } : { userId: term }),
      });
      if (seq !== searchSeq.current) return;
      setSearchResults(res.list ?? []);
    } catch (err) {
      if (seq !== searchSeq.current) return;
      setSearchError(errorMessage(err) || '搜索用户失败，请稍后重试');
      setSearchResults(null);
    } finally {
      if (seq === searchSeq.current) setSearching(false);
    }
  };

  const selectUser = (user: ClientUserListItem) => {
    profileSeq.current += 1;
    setSelectedUser(user);
    setSelectedUserId(user.id);
  };

  const openByUserId = async () => {
    const id = directUserId.trim();
    if (!id) return;
    const seq = ++profileSeq.current;
    setSelectedUser(null);
    setSelectedUserId(id);
    try {
      const profile = await clientUserApi.getUserById(id);
      if (seq === profileSeq.current) setSelectedUser(profile);
    } catch {
      // 高级入口允许只凭 userId 查看；资料拉取失败时头部只展示 userId。
    }
  };

  const deleteOne = async (id: string) => {
    if (!canDelete) return;
    if (!window.confirm('确认软删除这条记忆？软删除后需后台恢复。')) return;
    try {
      await aiOpsApi.deleteMemory(id);
      await refresh();
    } catch (err) {
      window.alert(errorMessage(err) || '删除失败');
    }
  };

  const restoreOne = async (id: string) => {
    if (!canDelete) return;
    if (!window.confirm('确认恢复这条记忆？恢复后会重新参与 AI 上下文。')) {
      return;
    }
    try {
      await aiOpsApi.restoreMemory(id);
      await refresh();
    } catch (err) {
      window.alert(errorMessage(err) || '恢复失败');
    }
  };

  const deleteAll = async () => {
    if (!selectedUserId || !canDelete) return;

    const reason = window.prompt('请输入删除全部记忆的原因（必填）：');
    if (reason === null) return;
    if (!reason.trim()) {
      window.alert('删除原因不能为空，已取消');
      return;
    }

    const typed = window.prompt(
      `此操作不可撤销。请输入 DELETE 确认删除用户 ${selectedUserId} 的全部记忆：`,
    );
    if (typed === null) return;
    if (typed.trim() !== 'DELETE') {
      window.alert('确认文本不匹配，已取消');
      return;
    }

    try {
      const result = await aiOpsApi.deleteUserMemories(selectedUserId);
      window.alert(
        `已删除 memories=${result?.memories ?? 0}, summaries=${result?.summaries ?? 0}`,
      );
      await refresh();
    } catch (err) {
      window.alert(errorMessage(err) || '删除失败');
    }
  };

  if (!allowed) {
    return (
      <div className="space-y-5 p-4">
        <PageHeader
          title="客户记忆"
          description="按用户查看长期记忆；只展示蒸馏值，不展示原始对话"
        />
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
          当前角色为 {role || 'viewer'}，无权查看客户记忆。请联系管理员开通
          Memory 读取权限。
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5 p-4">
      <PageHeader
        title="客户记忆"
        description="按用户查看长期记忆；只展示蒸馏值，不展示原始对话"
      />

      {/* 主入口：按手机号 / userId 找用户 */}
      <section className={cardClass}>
        <h2 className="text-sm font-semibold">查找用户</h2>
        <p className="mt-1 text-xs text-gray-500">
          按手机号或用户 ID 搜索，选中后可查看该用户的长期记忆。
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <select
            aria-label="搜索方式"
            className="rounded-lg border px-3 py-2 text-sm dark:border-white/10 dark:bg-gray-800"
            value={searchMode}
            onChange={(e) =>
              setSearchMode(e.target.value === 'userId' ? 'userId' : 'phone')
            }
          >
            <option value="phone">手机号</option>
            <option value="userId">用户 ID</option>
          </select>
          <input
            className="min-w-[220px] rounded-lg border px-3 py-2 text-sm dark:border-white/10 dark:bg-gray-800"
            placeholder={searchMode === 'phone' ? '手机号' : '用户 ID'}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void runSearch();
            }}
          />
          <Button onClick={() => void runSearch()} disabled={searching}>
            {searching ? '搜索中...' : '搜索用户'}
          </Button>
        </div>

        {searchError ? (
          <div className="mt-3 text-sm text-red-600 dark:text-red-400">
            {searchError}
          </div>
        ) : null}

        {searching ? (
          <div className="mt-3 text-sm text-gray-400">正在搜索用户...</div>
        ) : searchResults ? (
          searchResults.length === 0 ? (
            <div className="mt-3 text-sm text-gray-400">未找到匹配用户</div>
          ) : (
            <ul className="mt-3 space-y-2">
              {searchResults.map((user) => (
                <li
                  key={user.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm dark:border-white/10"
                >
                  <div className="min-w-0">
                    <div className="font-medium">
                      {user.nickname || '未设置昵称'}
                    </div>
                    <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-gray-500">
                      <span>
                        {user.phone ? maskPhone(user.phone) : '无手机号'}
                      </span>
                      <span className="font-mono">ID {user.id}</span>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => selectUser(user)}
                  >
                    查看记忆
                  </Button>
                </li>
              ))}
            </ul>
          )
        ) : null}

        <details className="mt-4">
          <summary className="cursor-pointer text-xs text-gray-500">
            高级：直接输入 userId
          </summary>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input
              className="min-w-[220px] rounded-lg border px-3 py-2 text-sm dark:border-white/10 dark:bg-gray-800"
              placeholder="userId（高级）"
              value={directUserId}
              onChange={(e) => setDirectUserId(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void openByUserId();
              }}
            />
            <Button variant="outline" onClick={() => void openByUserId()}>
              查看记忆
            </Button>
          </div>
        </details>
      </section>

      {!selectedUserId ? (
        <div className="py-6 text-center text-sm text-gray-400">
          先搜索并选择用户，或使用高级入口直接输入 userId。
        </div>
      ) : (
        <>
          {/* 用户摘要头 */}
          <section className={cardClass}>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <h2 className="text-lg font-semibold">
                  {selectedUser?.nickname || '未命名用户'}
                </h2>
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
                  <span>
                    手机号{' '}
                    {selectedUser?.phone ? maskPhone(selectedUser.phone) : '—'}
                  </span>
                  <span className="font-mono">ID {selectedUserId}</span>
                </div>
              </div>
              <div className="flex gap-5 text-sm">
                <div>
                  <div className="text-xs text-gray-500">记忆</div>
                  <div className="text-lg font-semibold">
                    {activeData ? memories.length : '—'}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-gray-500">摘要</div>
                  <div className="text-lg font-semibold">
                    {activeData ? summaries.length : '—'}
                  </div>
                </div>
              </div>
            </div>
          </section>

          {fetchingMemories ? (
            <div className="py-6 text-center text-sm text-gray-400">
              正在加载该用户的记忆...
            </div>
          ) : error ? (
            <AiErrorBanner
              message={errorMessage(error) || '读取客户记忆失败，请稍后重试。'}
              onRetry={() => {
                void refresh();
              }}
            />
          ) : !activeData ? (
            <div className="rounded-xl border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-700 dark:border-orange-500/30 dark:bg-orange-500/10 dark:text-orange-300">
              未读取到该用户的记忆数据，请重新查询或稍后重试。
            </div>
          ) : (
            <>
              {memories.length === 0 ? (
                <div className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-gray-400 dark:border-white/10">
                  该用户暂无长期记忆
                </div>
              ) : (
                <div className="space-y-4">
                  {grouped.map((group) => (
                    <section key={group.category} className={cardClass}>
                      <h3 className="mb-3 text-sm font-semibold">
                        {group.category}
                        <span className="ml-2 text-xs font-normal text-gray-400">
                          {group.items.length} 条
                        </span>
                      </h3>
                      <div className="space-y-2">
                        {group.items.map((memory) => (
                          <article
                            key={memory.id}
                            className="rounded-lg border p-3 dark:border-white/10"
                          >
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div className="min-w-0">
                                <h4
                                  className="text-sm font-medium"
                                  title={`${memoryLabel(memory)}（${memory.key}）`}
                                >
                                  {memoryLabel(memory)}
                                  <span className="ml-2 font-mono text-[11px] font-normal text-gray-400">
                                    {memory.key}
                                  </span>
                                </h4>
                                <p className="mt-1 break-words text-sm">
                                  {memory.value || '（空值）'}
                                </p>
                              </div>
                              {canDelete ? (
                                memory.status === 'DELETED' ? (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => void restoreOne(memory.id)}
                                  >
                                    恢复
                                  </Button>
                                ) : (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => void deleteOne(memory.id)}
                                  >
                                    删除
                                  </Button>
                                )
                              ) : null}
                            </div>

                            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
                              <span>
                                置信度 {formatConfidence(memory.confidence)}
                              </span>
                              <span className={statusClass(memory.status)}>
                                状态 {statusLabel(memory.status)}
                              </span>
                              <span>过期 {formatTime(memory.expiresAt)}</span>
                              <span>
                                最近使用{' '}
                                {memory.lastUsedAt
                                  ? formatTime(memory.lastUsedAt)
                                  : '—'}
                              </span>
                              {memory.sourceConversationId ? (
                                <Link
                                  className="text-blue-600 hover:underline dark:text-blue-400"
                                  href={`/ai-ops/context?conversationId=${encodeURIComponent(
                                    memory.sourceConversationId,
                                  )}`}
                                  title={memory.sourceConversationId}
                                >
                                  查看来源会话
                                </Link>
                              ) : null}
                            </div>
                          </article>
                        ))}
                      </div>
                    </section>
                  ))}
                </div>
              )}

              <p className="text-xs text-gray-500">
                单条删除为软删除（需后台恢复），不会立即物理清除。
              </p>

              <section className={cardClass}>
                <h3 className="mb-3 text-sm font-semibold">
                  会话摘要（{summaries.length}）
                </h3>
                <p className="mb-3 text-xs text-gray-500">
                  摘要按会话记录；为空属预期。清理全部记忆会同时清空摘要。
                </p>
                <div className="space-y-2">
                  {summaries.length === 0 ? (
                    <div className="py-4 text-center text-sm text-gray-400">
                      暂无会话摘要
                    </div>
                  ) : (
                    summaries.map((summary) => (
                      <div
                        key={summary.id}
                        className="rounded-lg border p-3 text-sm dark:border-white/10"
                      >
                        <div className="text-xs text-gray-500">
                          thread={summary.threadId ?? '-'} · conversation=
                          {summary.conversationId ?? '-'} · seq≤
                          {summary.coveredToSeqId}
                        </div>
                        <div className="mt-1">{summary.summary}</div>
                      </div>
                    ))
                  )}
                </div>
              </section>

              {canDelete ? (
                <section className="rounded-xl border border-red-200 bg-red-50/60 p-4 dark:border-red-500/30 dark:bg-red-500/10">
                  <h3 className="text-sm font-semibold text-red-700 dark:text-red-300">
                    危险操作
                  </h3>
                  <p className="mt-1 text-xs text-red-600/80 dark:text-red-300/80">
                    删除该用户的全部长期记忆与会话摘要，操作不可撤销。执行前需要填写原因并输入
                    DELETE 确认。
                  </p>
                  <div className="mt-3">
                    <Button variant="danger" onClick={() => void deleteAll()}>
                      删除全部记忆
                    </Button>
                  </div>
                </section>
              ) : null}
            </>
          )}
        </>
      )}
    </div>
  );
}
