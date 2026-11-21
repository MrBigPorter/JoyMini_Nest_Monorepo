'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRequest } from 'ahooks';
import { Button } from '@repo/ui';
import { aiOpsApi } from '@/api';
import { PageHeader } from '@/components/scaffold/PageHeader';
import { AiErrorBanner } from '@/components/ai-ops/AiErrorBanner';
import { canAnnotate, useAiOpsRole } from '@/lib/ai-ops-permissions';
import type { AiAnnotationLabels, AiAnnotationRow } from '@/type/types';

const cardClass =
  'rounded-xl border border-gray-100 bg-white p-4 dark:border-white/10 dark:bg-gray-900';

const CORRECTNESS_OPTIONS = [
  { value: 'solved', label: '✅ 解决了' },
  { value: 'partial', label: '🟡 部分解决' },
  { value: 'unsolved', label: '❌ 没解决' },
  { value: 'unsafe', label: '⚠️ 有风险' },
  { value: 'abstain', label: '🤔 看不懂' },
] as const;

const HELPFULNESS_OPTIONS = [
  { value: 5, label: '5 · 看完就能用' },
  { value: 4, label: '4 · 基本能用' },
  { value: 3, label: '3 · 还要再问一句' },
  { value: 2, label: '2 · 几乎没用' },
  { value: 1, label: '1 · 帮倒忙' },
] as const;

const TONE_OPTIONS = [
  { value: 5, label: '5 · 正常' },
  { value: 4, label: '4 · 有点啰嗦/生硬' },
  { value: 3, label: '3 · 推诿/冷淡' },
  { value: 2, label: '2 · 误导' },
  { value: 1, label: '1 · 冒犯/不安全' },
] as const;

const EMPTY_LABELS: AiAnnotationLabels = {
  correctness: null,
  helpfulness: null,
  tone_safety: null,
  comment: '',
};

function keyOf(row: AiAnnotationRow): string {
  return `${row.caseId}#${row.turn}`;
}

export default function AiAnnotationsPage() {
  const role = useAiOpsRole();
  const allowed = canAnnotate(role);
  const [filter, setFilter] = useState<'pending' | 'done' | 'all'>('pending');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [form, setForm] = useState<AiAnnotationLabels>(EMPTY_LABELS);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const { data, loading, error, refresh } = useRequest(
    () => aiOpsApi.getAnnotationQueue(filter),
    { ready: allowed, refreshDeps: [filter, allowed] },
  );

  const rows = data?.rows ?? [];
  const selected = useMemo(
    () => rows.find((row) => keyOf(row) === selectedKey) ?? null,
    [rows, selectedKey],
  );

  useEffect(() => {
    if (!selected) {
      setForm(EMPTY_LABELS);
      return;
    }
    setForm({ ...selected.labels });
    setSaveError(null);
  }, [selectedKey, selected]);

  function selectNext() {
    const currentIndex = rows.findIndex((row) => keyOf(row) === selectedKey);
    const next =
      rows.slice(currentIndex + 1).find((row) => row.status === 'pending') ??
      rows.find((row) => row.status === 'pending');
    setSelectedKey(next ? keyOf(next) : null);
  }

  async function save() {
    if (!selected || !form.correctness) return;
    setSaving(true);
    setSaveError(null);
    try {
      await aiOpsApi.saveAnnotation(selected.caseId, selected.turn, form);
      await refresh();
      selectNext();
    } catch (err: any) {
      setSaveError(err?.message ?? '保存失败，请重试');
    } finally {
      setSaving(false);
    }
  }

  if (!allowed) {
    return (
      <div className="space-y-5 p-4">
        <PageHeader title="人工标注" description="按运营口径标注评测样本" />
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
          当前角色为 {role || 'viewer'}，无权标注。请联系管理员开通权限。
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5 p-4">
      <PageHeader
        title="人工标注"
        description="按运营口径标注评测样本；完成进度按当前管理员统计"
      />

      {error ? (
        <AiErrorBanner
          message="读取标注队列失败，请稍后重试。"
          onRetry={() => void refresh()}
        />
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {(
          [
            ['pending', '待标注'],
            ['done', '已完成'],
            ['all', '全部'],
          ] as const
        ).map(([value, label]) => (
          <Button
            key={value}
            size="sm"
            variant={filter === value ? 'primary' : 'outline'}
            onClick={() => {
              setFilter(value);
              setSelectedKey(null);
            }}
          >
            {label}
          </Button>
        ))}
        <span className="ml-auto text-sm text-gray-500">
          已完成 {data?.done ?? 0} / {data?.total ?? 0}
        </span>
      </div>

      {loading ? (
        <div className="py-6 text-center text-sm text-gray-400">加载中…</div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-gray-100 bg-white px-4 py-6 text-center text-sm text-gray-500 dark:border-white/10 dark:bg-gray-900">
          当前筛选下没有样本。
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1.1fr_1fr]">
          <section className={cardClass}>
            <h2 className="text-sm font-semibold">队列（{rows.length}）</h2>
            <div className="mt-3 max-h-[60vh] space-y-2 overflow-y-auto pr-1">
              {rows.map((row) => {
                const active = keyOf(row) === selectedKey;
                return (
                  <button
                    key={keyOf(row)}
                    type="button"
                    onClick={() => setSelectedKey(keyOf(row))}
                    className={`w-full rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                      active
                        ? 'border-blue-400 bg-blue-50 dark:border-blue-500/50 dark:bg-blue-500/10'
                        : 'border-gray-100 hover:bg-gray-50 dark:border-white/10 dark:hover:bg-white/5'
                    }`}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs text-gray-500">
                        {row.caseId}#{row.turn}
                      </span>
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] dark:bg-white/10">
                        {row.intent ?? 'unknown'}
                      </span>
                      <span
                        className={`ml-auto text-xs ${
                          row.status === 'done'
                            ? 'text-emerald-600 dark:text-emerald-300'
                            : 'text-amber-600 dark:text-amber-300'
                        }`}
                      >
                        {row.status === 'done' ? '已完成' : '待标注'}
                      </span>
                    </div>
                    <div className="mt-1 line-clamp-2 text-gray-700 dark:text-gray-300">
                      {row.question}
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          <section className={cardClass}>
            {!selected ? (
              <p className="py-10 text-center text-sm text-gray-500">
                从左侧选择一条样本开始标注。
              </p>
            ) : (
              <div className="space-y-4">
                <div>
                  <h2 className="text-sm font-semibold">样本</h2>
                  <p className="mt-1 font-mono text-xs text-gray-500">
                    {selected.caseId}#{selected.turn} · {selected.intent}
                  </p>
                </div>

                <div className="rounded-lg bg-gray-50 p-3 text-sm dark:bg-white/5">
                  <div className="text-xs text-gray-500">用户问题</div>
                  <div className="mt-1 whitespace-pre-wrap">
                    {selected.question}
                  </div>
                </div>

                <div className="rounded-lg bg-gray-50 p-3 text-sm dark:bg-white/5">
                  <div className="text-xs text-gray-500">AI 回答</div>
                  <div className="mt-1 max-h-64 overflow-y-auto whitespace-pre-wrap">
                    {selected.answer}
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                  <label className="text-sm sm:col-span-3">
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
                      这条回答解决用户问题了吗？
                    </span>
                    <select
                      className="mt-1 w-full rounded-lg border px-2 py-2 dark:border-white/10 dark:bg-gray-800"
                      value={form.correctness ?? ''}
                      onChange={(event) =>
                        setForm({
                          ...form,
                          correctness:
                            (event.target.value as AiAnnotationLabels['correctness']) ||
                            null,
                        })
                      }
                    >
                      <option value="">请选择</option>
                      {CORRECTNESS_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="text-sm">
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
                      对用户有多大帮助？
                    </span>
                    <select
                      className="mt-1 w-full rounded-lg border px-2 py-2 dark:border-white/10 dark:bg-gray-800"
                      value={form.helpfulness ?? ''}
                      onChange={(event) =>
                        setForm({
                          ...form,
                          helpfulness: event.target.value
                            ? Number(event.target.value)
                            : null,
                        })
                      }
                    >
                      <option value="">请选择</option>
                      {HELPFULNESS_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="text-sm">
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
                      语气和安全有没有问题？
                    </span>
                    <select
                      className="mt-1 w-full rounded-lg border px-2 py-2 dark:border-white/10 dark:bg-gray-800"
                      value={form.tone_safety ?? ''}
                      onChange={(event) =>
                        setForm({
                          ...form,
                          tone_safety: event.target.value
                            ? Number(event.target.value)
                            : null,
                        })
                      }
                    >
                      <option value="">请选择</option>
                      {TONE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <label className="block text-sm">
                  <span className="text-xs text-gray-500">备注</span>
                  <textarea
                    className="mt-1 w-full rounded-lg border px-2 py-2 dark:border-white/10 dark:bg-gray-800"
                    rows={3}
                    maxLength={500}
                    value={form.comment}
                    onChange={(event) =>
                      setForm({ ...form, comment: event.target.value })
                    }
                    placeholder="为什么这样判？"
                  />
                </label>

                {saveError ? (
                  <p className="text-sm text-red-600 dark:text-red-300">
                    {saveError}
                  </p>
                ) : null}

                <div className="flex flex-wrap gap-2">
                  <Button
                    onClick={() => void save()}
                    disabled={saving || !form.correctness}
                  >
                    {saving ? '保存中…' : '保存并下一条'}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={selectNext}
                    disabled={saving}
                  >
                    跳过
                  </Button>
                </div>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
