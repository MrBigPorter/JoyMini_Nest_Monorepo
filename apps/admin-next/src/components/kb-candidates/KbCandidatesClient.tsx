'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRequest } from 'ahooks';
import { Button } from '@repo/ui';
import {
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  Search,
  Shuffle,
  Undo2,
  XCircle,
} from 'lucide-react';
import { intentExamplesApi, kbCandidatesApi } from '@/api';
import { PageHeader } from '@/components/scaffold/PageHeader';
import {
  canManageIntentDomains,
  canReviewKbCandidates,
  useAiOpsRole,
} from '@/lib/ai-ops-permissions';
import type { KbCandidateKind, KbCandidateStatus } from '@/type/types';

const cardClass =
  'rounded-xl border border-gray-100 bg-white p-4 dark:border-white/10 dark:bg-gray-900';

const STATUS_TABS = [
  { value: 'PENDING', label: '待审' },
  { value: 'APPLIED', label: '已生效' },
  { value: 'REJECTED', label: '已驳回' },
  { value: 'ALL', label: '全部' },
] as const;

const KIND_LABEL: Record<KbCandidateKind, string> = {
  INTENT_EXAMPLE: '意图示例',
  KEYWORD: '关键词',
  GOLDEN_QUERY: '评测问句',
  DOMAIN_DESCRIPTION: '域描述',
};

const STATUS_STYLE: Record<KbCandidateStatus, string> = {
  PENDING:
    'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  APPROVED: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  APPLIED:
    'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  AUTO_APPLIED:
    'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300',
  REJECTED: 'bg-gray-100 text-gray-500 dark:bg-white/10 dark:text-gray-400',
  SUPERSEDED: 'bg-gray-100 text-gray-400 dark:bg-white/10 dark:text-gray-500',
  FAILED: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  ROLLED_BACK:
    'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
};

function fmtTime(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString();
}

export function KbCandidatesClient() {
  const role = useAiOpsRole();
  const canReview = canReviewKbCandidates(role);
  const canManageDomains = canManageIntentDomains(role);

  const [statusTab, setStatusTab] =
    useState<(typeof STATUS_TABS)[number]['value']>('PENDING');
  const [kind, setKind] = useState<'' | KbCandidateKind>('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [editedText, setEditedText] = useState('');
  const [targetDomain, setTargetDomain] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [batchReason, setBatchReason] = useState('');
  const [pendingBatch, setPendingBatch] = useState<'approve' | 'reject' | null>(
    null,
  );
  const [confirmRollback, setConfirmRollback] = useState(false);
  const [allowGrowth, setAllowGrowth] = useState(false);
  const [includeNeedsReview, setIncludeNeedsReview] = useState(false);
  /** 上次批量被「单域增长 >10%」挡住，显示一键重试 */
  const [growthBlocked, setGrowthBlocked] = useState(false);
  /** 上次批量因候选全是「重点复核」被全部跳过，显示一键重试 */
  const [reviewBlocked, setReviewBlocked] = useState(false);
  const [acting, setActing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const { data: domainGroups } = useRequest(() => intentExamplesApi.getAll(), {
    onError: () => {},
  });
  const domainOptions = useMemo(
    () => (domainGroups ?? []).map((group) => group.name),
    [domainGroups],
  );

  const { data, loading, refresh } = useRequest(
    () =>
      kbCandidatesApi.list({
        page,
        pageSize: 50,
        status: statusTab === 'ALL' ? undefined : statusTab,
        kind: kind || undefined,
        search: search.trim() || undefined,
      }),
    { refreshDeps: [page, statusTab, kind, search] },
  );

  const items = useMemo(() => data?.items ?? [], [data?.items]);
  const total = data?.total ?? 0;
  const pageSize = data?.pageSize ?? 50;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const stats = data?.stats;

  const { data: detail, refresh: refreshDetail } = useRequest(
    () =>
      selectedId ? kbCandidatesApi.getById(selectedId) : Promise.resolve(null),
    { refreshDeps: [selectedId] },
  );

  useEffect(() => {
    if (!detail) return;
    setEditedText(detail.text);
    setTargetDomain(detail.targetDomain);
    setRejectReason('');
    setActionError(null);
    setConfirmRollback(false);
  }, [detail]);

  const selectedFromList = useMemo(
    () => items.find((item) => item.id === selectedId) ?? null,
    [items, selectedId],
  );
  const selected = detail ?? selectedFromList;

  const checkedItems = useMemo(
    () => items.filter((item) => checked.has(item.id)),
    [items, checked],
  );
  const checkedKinds = new Set(checkedItems.map((item) => item.kind));

  function resetFilters(next: () => void) {
    next();
    setPage(1);
    setSelectedId(null);
    setChecked(new Set());
    setActionError(null);
    setNotice(null);
  }

  function toggleChecked(id: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /** 全选/取消全选当前页（只影响本页，跨页仍逐页处理） */
  function toggleAllOnPage(select: boolean) {
    setChecked((prev) => {
      const next = new Set(prev);
      for (const item of items) {
        if (select) next.add(item.id);
        else next.delete(item.id);
      }
      return next;
    });
  }

  function selectNext() {
    const currentIndex = items.findIndex((item) => item.id === selectedId);
    const next =
      items.slice(currentIndex + 1).find((item) => !checked.has(item.id)) ??
      items.find((item) => item.id !== selectedId);
    setSelectedId(next?.id ?? null);
  }

  async function runAction(
    action: () => Promise<void>,
    successMessage: string,
  ) {
    setActing(true);
    setActionError(null);
    setNotice(null);
    try {
      await action();
      setNotice(successMessage);
      await Promise.all([refresh(), refreshDetail()]);
    } catch (error: any) {
      setActionError(error?.message ?? '操作失败，请重试');
    } finally {
      setActing(false);
    }
  }

  function handleApprove() {
    if (!selected) return;
    const text = editedText.trim();
    if (text.length < 2) {
      setActionError('候选文本太短，至少 2 个字符');
      return;
    }
    const payload: { text?: string; targetDomain?: string } = {};
    if (text !== selected.text) payload.text = text;
    if (
      selected.kind === 'INTENT_EXAMPLE' &&
      targetDomain &&
      targetDomain !== selected.targetDomain
    ) {
      payload.targetDomain = targetDomain;
    }
    void runAction(
      () => kbCandidatesApi.approve(selected.id, payload).then(() => undefined),
      '已批准并生效',
    );
  }

  function handleReject() {
    if (!selected) return;
    if (!rejectReason.trim()) {
      setActionError('驳回必须填写原因');
      return;
    }
    void runAction(
      () =>
        kbCandidatesApi
          .reject(selected.id, rejectReason.trim())
          .then(() => undefined),
      '已驳回',
    );
  }

  function handleRetarget() {
    if (!selected || selected.kind !== 'INTENT_EXAMPLE') return;
    if (!targetDomain || targetDomain === selected.targetDomain) {
      setActionError('请选择一个新的目标意图域');
      return;
    }
    void runAction(
      () =>
        kbCandidatesApi
          .retarget(selected.id, targetDomain)
          .then(() => undefined),
      `已改派到 ${targetDomain}`,
    );
  }

  function handleRollback() {
    if (!selected) return;
    setConfirmRollback(true);
  }

  async function executeRollback() {
    if (!selected) return;
    setConfirmRollback(false);
    await runAction(
      () => kbCandidatesApi.rollbackKeyword(selected.id).then(() => undefined),
      '已回滚该关键词',
    );
  }

  function handleBatch(action: 'approve' | 'reject') {
    if (checkedItems.length === 0) return;
    if (checkedKinds.size > 1) {
      setActionError('批量操作不能混合候选类型，请按类型分批处理');
      return;
    }
    if (action === 'reject' && !batchReason.trim()) {
      setActionError('批量驳回必须填写原因');
      return;
    }
    setActionError(null);
    setPendingBatch(action);
  }

  async function executeBatch(
    action: 'approve' | 'reject',
    overrideGrowth = false,
    overrideReview = false,
  ) {
    if (checkedItems.length === 0) return;
    const ids = checkedItems.map((item) => item.id);
    setActing(true);
    setActionError(null);
    setNotice(null);
    setGrowthBlocked(false);
    setReviewBlocked(false);
    try {
      const result = await kbCandidatesApi.batch({
        ids,
        action,
        confirm: true,
        reason: action === 'reject' ? batchReason.trim() : undefined,
        allowDomainGrowth: overrideGrowth || allowGrowth,
        includeNeedsReview: overrideReview || includeNeedsReview,
      });
      setChecked(new Set());
      setBatchReason('');
      const nothingDone =
        result.applied === 0 &&
        result.rejected === 0 &&
        result.skipped > 0 &&
        result.failed.length === 0;
      const message =
        `批量完成：生效 ${result.applied}，驳回 ${result.rejected}，跳过 ${result.skipped}` +
        (result.failed.length
          ? `，失败 ${result.failed.length}（${result.failed[0]?.error ?? ''}）`
          : '');
      if (nothingDone) {
        // 一条都没处理时不能只显示绿色的「完成」，否则看起来像没刷新。
        setActionError(
          `${message}。跳过的是「重点复核」候选（与已有示例近乎同义），` +
            '批量默认不动它们，避免重复计入同一主题。',
        );
        setReviewBlocked(true);
        setNotice(null);
      } else {
        setNotice(message);
        setActionError(null);
      }
      await Promise.all([refresh(), refreshDetail()]);
    } catch (error: any) {
      const message: string = error?.message ?? '批量操作失败，请重试';
      setActionError(message);
      // 增长护栏是唯一「换个参数就能过」的错误，直接给一键重试，
      // 不用让人回头找那个复选框。
      if (/allowDomainGrowth|grow "|by more than/i.test(message)) {
        setGrowthBlocked(true);
      }
    } finally {
      setActing(false);
      setPendingBatch(null);
    }
  }

  return (
    <div className="space-y-5 p-4">
      <PageHeader
        title="候选审核台"
        description="知识库发布后自动生成的关键词、意图示例与评测问句；关键词默认自动生效且可回滚，示例与评测问句必须人工批准"
        showBackButton
        backButtonLabel="返回知识库"
        action={
          <Link
            href="/knowledge"
            className="text-sm text-teal-600 underline hover:text-teal-500"
          >
            返回知识库
          </Link>
        }
      />

      {!canReview ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
          当前角色为 {role || 'viewer'}，只能查看候选，无法批准或驳回。
        </div>
      ) : null}

      {/* 统计 */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {[
          ['待审', stats?.byStatus.PENDING ?? 0, 'text-amber-600'],
          ['自动生效', stats?.byStatus.AUTO_APPLIED ?? 0, 'text-teal-600'],
          ['已批准', stats?.byStatus.APPLIED ?? 0, 'text-emerald-600'],
          ['已驳回', stats?.byStatus.REJECTED ?? 0, 'text-gray-500'],
          ['失败', stats?.byStatus.FAILED ?? 0, 'text-red-600'],
        ].map(([label, value, color]) => (
          <div key={label as string} className={cardClass}>
            <p className="text-xs text-gray-500">{label}</p>
            <p className={`mt-1 text-2xl font-semibold ${color}`}>
              {value as number}
            </p>
          </div>
        ))}
      </div>

      {/* 筛选 */}
      <div className="flex flex-wrap items-center gap-2">
        {STATUS_TABS.map((tab) => (
          <Button
            key={tab.value}
            size="sm"
            variant={statusTab === tab.value ? 'primary' : 'outline'}
            onClick={() => resetFilters(() => setStatusTab(tab.value))}
          >
            {tab.label}
          </Button>
        ))}
        <select
          value={kind}
          onChange={(event) =>
            resetFilters(() =>
              setKind(event.target.value as '' | KbCandidateKind),
            )
          }
          className="rounded-lg border px-2 py-1.5 text-sm dark:border-white/10 dark:bg-gray-800"
        >
          <option value="">全部类型</option>
          {(Object.keys(KIND_LABEL) as KbCandidateKind[]).map((value) => (
            <option key={value} value={value}>
              {KIND_LABEL[value]}
            </option>
          ))}
        </select>
        <label className="relative">
          <Search
            size={14}
            className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-gray-400"
          />
          <input
            value={search}
            onChange={(event) =>
              resetFilters(() => setSearch(event.target.value))
            }
            placeholder="搜索候选文本…"
            className="w-56 rounded-lg border py-1.5 pl-7 pr-2 text-sm dark:border-white/10 dark:bg-gray-800"
          />
        </label>
        <button
          type="button"
          onClick={() => void refresh()}
          className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-white/5"
          title="刷新"
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
        </button>
        <span className="ml-auto text-sm text-gray-500">
          共 {total} 条 · 第 {page}/{totalPages} 页
        </span>
      </div>

      {actionError ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
          {actionError}
        </div>
      ) : null}
      {notice ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300">
          {notice}
        </div>
      ) : null}

      {/* 批量操作条 */}
      {checkedItems.length > 0 ? (
        <div className={`${cardClass} flex flex-wrap items-center gap-3`}>
          <span className="text-sm font-medium">
            已选 {checkedItems.length} 条
          </span>
          {checkedKinds.size > 1 ? (
            <span className="text-xs text-red-600">
              混合了多种候选类型，请按类型分批
            </span>
          ) : (
            <span className="text-xs text-gray-500">
              类型：{KIND_LABEL[checkedItems[0]?.kind ?? 'KEYWORD']}
            </span>
          )}
          <input
            value={batchReason}
            onChange={(event) => setBatchReason(event.target.value)}
            placeholder="驳回原因（驳回时必填）"
            className="w-56 rounded-lg border px-2 py-1.5 text-sm dark:border-white/10 dark:bg-gray-800"
          />
          <label className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300">
            <input
              type="checkbox"
              checked={allowGrowth}
              onChange={(event) => setAllowGrowth(event.target.checked)}
            />
            允许单域增长 &gt;10%
          </label>
          <label className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300">
            <input
              type="checkbox"
              checked={includeNeedsReview}
              onChange={(event) => setIncludeNeedsReview(event.target.checked)}
            />
            包含需重点复核项
          </label>
          <div className="ml-auto flex gap-2">
            <Button
              size="sm"
              onClick={() => handleBatch('approve')}
              disabled={!canReview || acting || checkedKinds.size > 1}
            >
              批准所选
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => handleBatch('reject')}
              disabled={!canReview || acting || checkedKinds.size > 1}
            >
              驳回所选
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setChecked(new Set());
                setPendingBatch(null);
              }}
            >
              清空
            </Button>
          </div>
          {reviewBlocked && !pendingBatch ? (
            <div className="flex w-full flex-wrap items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200">
              <AlertTriangle size={14} />
              选中的候选都被标为「重点复核」（与已有示例近乎同义），建议先逐条看一眼。
              <div className="ml-auto flex gap-2">
                <Button
                  size="sm"
                  onClick={() => {
                    setIncludeNeedsReview(true);
                    void executeBatch('approve', false, true);
                  }}
                  disabled={acting}
                >
                  仍然批准
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setReviewBlocked(false)}
                  disabled={acting}
                >
                  取消
                </Button>
              </div>
            </div>
          ) : null}
          {growthBlocked && !pendingBatch ? (
            <div className="flex w-full flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
              <AlertTriangle size={14} />
              这批会让目标域的示例数增长超过 10%（护栏），确认要放行吗？
              <div className="ml-auto flex gap-2">
                <Button
                  size="sm"
                  onClick={() => {
                    setAllowGrowth(true);
                    void executeBatch('approve', true);
                  }}
                  disabled={acting}
                >
                  允许增长并重试
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setGrowthBlocked(false)}
                  disabled={acting}
                >
                  取消
                </Button>
              </div>
            </div>
          ) : null}
          {pendingBatch ? (
            <div className="flex w-full flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
              <AlertTriangle size={14} />
              确认{pendingBatch === 'approve' ? '批准' : '驳回'}{' '}
              {checkedItems.length} 条候选？此操作会立即生效。
              <div className="ml-auto flex gap-2">
                <Button
                  size="sm"
                  onClick={() => void executeBatch(pendingBatch)}
                  disabled={acting}
                >
                  {acting ? '执行中…' : '确认执行'}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setPendingBatch(null)}
                  disabled={acting}
                >
                  取消
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {loading && items.length === 0 ? (
        <div className="py-10 text-center text-sm text-gray-400">加载中…</div>
      ) : items.length === 0 ? (
        <div className={`${cardClass} py-10 text-center text-sm text-gray-500`}>
          当前筛选下没有候选。
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1.05fr_1fr]">
          {/* 队列 */}
          <section className={cardClass}>
            <h2 className="text-sm font-semibold">
              队列（{items.length}）
              {stats?.pendingTotal ? (
                <span className="ml-2 text-xs font-normal text-amber-600">
                  待审 {stats.pendingTotal}
                </span>
              ) : null}
            </h2>
            <div className="mt-3 flex items-center justify-between border-b border-gray-100 pb-2 dark:border-white/10">
              <label className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300">
                <input
                  type="checkbox"
                  checked={
                    items.length > 0 &&
                    items.every((item) => checked.has(item.id))
                  }
                  onChange={(event) => toggleAllOnPage(event.target.checked)}
                  aria-label="全选本页"
                />
                全选本页
              </label>
              <span className="text-xs text-gray-400">
                本页 {items.length} 条
              </span>
            </div>
            <div className="mt-3 max-h-[62vh] space-y-2 overflow-y-auto pr-1">
              {items.map((item) => {
                const active = item.id === selectedId;
                return (
                  <div
                    key={item.id}
                    className={`flex w-full items-start gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                      active
                        ? 'border-blue-400 bg-blue-50 dark:border-blue-500/50 dark:bg-blue-500/10'
                        : 'border-gray-100 hover:bg-gray-50 dark:border-white/10 dark:hover:bg-white/5'
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={checked.has(item.id)}
                      onChange={() => toggleChecked(item.id)}
                      aria-label="选择该候选"
                    />
                    <button
                      type="button"
                      className="min-w-0 flex-1 text-left"
                      onClick={() => setSelectedId(item.id)}
                    >
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] dark:bg-white/10">
                          {KIND_LABEL[item.kind] ?? item.kind}
                        </span>
                        <span className="text-[11px] text-gray-500">
                          → {item.targetDomain}
                        </span>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[11px] ${STATUS_STYLE[item.status] ?? ''}`}
                        >
                          {item.status}
                        </span>
                        {item.needsReview ? (
                          <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[11px] text-rose-600 dark:bg-rose-900/30 dark:text-rose-300">
                            重点复核
                          </span>
                        ) : null}
                        {item.autoApplied ? (
                          <span className="text-[11px] text-teal-600">
                            自动
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-1 line-clamp-2 text-gray-700 dark:text-gray-300">
                        {item.text}
                      </div>
                    </button>
                  </div>
                );
              })}
            </div>
            {totalPages > 1 ? (
              <div className="mt-3 flex items-center justify-end gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={page <= 1}
                  onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                >
                  上一页
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={page >= totalPages}
                  onClick={() =>
                    setPage((prev) => Math.min(totalPages, prev + 1))
                  }
                >
                  下一页
                </Button>
              </div>
            ) : null}
          </section>

          {/* 详情 */}
          <section className={cardClass}>
            {!selected ? (
              <p className="py-10 text-center text-sm text-gray-500">
                从左侧选择一条候选开始审核。
              </p>
            ) : (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-sm font-semibold">候选详情</h2>
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] dark:bg-white/10">
                    {KIND_LABEL[selected.kind] ?? selected.kind}
                  </span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] ${STATUS_STYLE[selected.status] ?? ''}`}
                  >
                    {selected.status}
                  </span>
                  <span className="ml-auto font-mono text-[11px] text-gray-400">
                    {selected.id}
                  </span>
                </div>

                <div className="grid gap-2 rounded-lg bg-gray-50 p-3 text-xs dark:bg-white/5 sm:grid-cols-2">
                  <div>
                    <span className="text-gray-500">目标域：</span>
                    {selected.targetDomain}
                  </div>
                  <div>
                    <span className="text-gray-500">语言：</span>
                    {selected.locale}
                  </div>
                  <div>
                    <span className="text-gray-500">来源文档版本：</span>v
                    {selected.documentVersion}
                  </div>
                  <div>
                    <span className="text-gray-500">置信度：</span>
                    {selected.confidence != null
                      ? selected.confidence.toFixed(2)
                      : '—'}
                  </div>
                  <div>
                    <span className="text-gray-500">最近邻相似度：</span>
                    {selected.nearestScore != null
                      ? selected.nearestScore.toFixed(3)
                      : '—'}
                  </div>
                  <div>
                    <span className="text-gray-500">生成模型：</span>
                    {selected.generatorModel ?? '—'}
                  </div>
                  <div className="sm:col-span-2">
                    <span className="text-gray-500">生成时间：</span>
                    {fmtTime(selected.createdAt)}
                  </div>
                  {detail?.document ? (
                    <div className="sm:col-span-2">
                      <span className="text-gray-500">来源文档：</span>
                      <Link
                        href={`/knowledge/documents/${detail.document.id}/review`}
                        className="text-teal-600 underline hover:text-teal-500"
                      >
                        {detail.document.title}
                      </Link>
                      <span className="ml-2 font-mono text-gray-400">
                        {detail.document.docId}
                      </span>
                    </div>
                  ) : null}
                </div>

                <div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">候选文本</span>
                    {selected.status === 'PENDING' ? (
                      <span className="text-[11px] text-gray-400">
                        可直接修改后批准（≤200 字）
                      </span>
                    ) : null}
                  </div>
                  <textarea
                    className="mt-1 w-full rounded-lg border px-2 py-2 text-sm dark:border-white/10 dark:bg-gray-800"
                    rows={4}
                    maxLength={200}
                    readOnly={selected.status !== 'PENDING'}
                    value={editedText}
                    onChange={(event) => setEditedText(event.target.value)}
                  />
                </div>

                {selected.kind === 'INTENT_EXAMPLE' &&
                selected.status === 'PENDING' ? (
                  <label className="block text-sm">
                    <span className="text-xs text-gray-500">
                      目标意图域（改派后仍需批准）
                    </span>
                    <div className="mt-1 flex gap-2">
                      <select
                        className="flex-1 rounded-lg border px-2 py-2 text-sm dark:border-white/10 dark:bg-gray-800"
                        value={targetDomain}
                        onChange={(event) =>
                          setTargetDomain(event.target.value)
                        }
                      >
                        {targetDomain &&
                        !domainOptions.includes(targetDomain) ? (
                          <option value={targetDomain}>{targetDomain}</option>
                        ) : null}
                        {domainOptions.map((domain) => (
                          <option key={domain} value={domain}>
                            {domain}
                          </option>
                        ))}
                      </select>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={handleRetarget}
                        disabled={
                          !canReview ||
                          acting ||
                          !targetDomain ||
                          targetDomain === selected.targetDomain
                        }
                      >
                        <Shuffle size={14} className="mr-1" />
                        改派
                      </Button>
                    </div>
                  </label>
                ) : null}

                {selected.status === 'PENDING' ? (
                  <>
                    <label className="block text-sm">
                      <span className="text-xs text-gray-500">
                        驳回原因（驳回必填）
                      </span>
                      <input
                        className="mt-1 w-full rounded-lg border px-2 py-2 text-sm dark:border-white/10 dark:bg-gray-800"
                        maxLength={200}
                        value={rejectReason}
                        onChange={(event) =>
                          setRejectReason(event.target.value)
                        }
                        placeholder="例如：与存量示例重复 / 不是信息型问句"
                      />
                    </label>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        onClick={handleApprove}
                        disabled={!canReview || acting}
                      >
                        <CheckCircle2 size={14} className="mr-1" />
                        {acting ? '处理中…' : '批准并生效'}
                      </Button>
                      <Button
                        variant="outline"
                        onClick={handleReject}
                        disabled={!canReview || acting || !rejectReason.trim()}
                      >
                        <XCircle size={14} className="mr-1" />
                        驳回
                      </Button>
                      <Button
                        variant="outline"
                        onClick={selectNext}
                        disabled={acting}
                      >
                        跳过
                      </Button>
                    </div>
                  </>
                ) : null}

                {selected.status === 'AUTO_APPLIED' &&
                selected.rollbackableUntil &&
                new Date(selected.rollbackableUntil).getTime() > Date.now() ? (
                  <div className="rounded-lg border border-teal-200 bg-teal-50 p-3 text-sm dark:border-teal-500/30 dark:bg-teal-500/10">
                    <p className="flex items-center gap-1.5 text-teal-800 dark:text-teal-200">
                      <AlertTriangle size={14} />
                      该关键词于 {fmtTime(selected.appliedAt)} 自动生效，
                      可回滚至 {fmtTime(selected.rollbackableUntil)}。
                    </p>
                    <Button
                      size="sm"
                      variant="outline"
                      className="mt-2"
                      onClick={handleRollback}
                      disabled={!canReview || acting}
                    >
                      <Undo2 size={14} className="mr-1" />
                      回滚这个关键词
                    </Button>
                    {confirmRollback ? (
                      <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
                        <AlertTriangle size={14} />
                        确认回滚「{selected.text}」？只移除这条候选添加的词。
                        <div className="ml-auto flex gap-2">
                          <Button
                            size="sm"
                            onClick={() => void executeRollback()}
                            disabled={acting}
                          >
                            确认回滚
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setConfirmRollback(false)}
                            disabled={acting}
                          >
                            取消
                          </Button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {selected.rejectReason ? (
                  <p className="text-xs text-gray-500">
                    审核备注：{selected.rejectReason}
                  </p>
                ) : null}

                {selected.kind === 'DOMAIN_DESCRIPTION' && !canManageDomains ? (
                  <p className="text-xs text-amber-600">
                    域描述类候选仅 SUPER_ADMIN 可以批准。
                  </p>
                ) : null}

                {detail?.payload ? (
                  <details className="text-xs text-gray-500">
                    <summary className="cursor-pointer">生成上下文</summary>
                    <pre className="mt-2 max-h-48 overflow-auto rounded-lg bg-gray-50 p-2 dark:bg-white/5">
                      {JSON.stringify(detail.payload, null, 2)}
                    </pre>
                  </details>
                ) : null}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
