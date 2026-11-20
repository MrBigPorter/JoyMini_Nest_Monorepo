'use client';

import { useCallback, useRef, useState } from 'react';
import Link from 'next/link';
import { useRequest } from 'ahooks';
import { Button } from '@repo/ui';
import { aiOpsApi } from '@/api';
import { AiErrorBanner } from '@/components/ai-ops/AiErrorBanner';
import { PageHeader } from '@/components/scaffold/PageHeader';
import { useAiOpsRole } from '@/lib/ai-ops-permissions';
import type { AiSpanRow, AiTraceDetail, AiTraceRow } from '@/type/types';

const PAGE_SIZE = 20;

const STATUS_LABELS: Record<string, string> = {
  SUCCESS: '成功',
  TRANSFERRED: '转人工',
  CONFIRM: '待确认',
  ERROR: '失败',
};

const STATUS_STYLES: Record<string, string> = {
  SUCCESS:
    'bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-300',
  TRANSFERRED:
    'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  CONFIRM:
    'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300',
  ERROR: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300',
};

const cardClass =
  'rounded-xl border border-gray-100 bg-white p-4 dark:border-white/10 dark:bg-gray-900';

function formatTime(value?: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function totalTokens(row: AiTraceRow): string {
  const prompt = row.promptTokens ?? 0;
  const completion = row.completionTokens ?? 0;
  if (row.promptTokens == null && row.completionTokens == null) return '—';
  return (prompt + completion).toLocaleString();
}

function snippet(value?: string | null, max = 120): string {
  if (!value) return '—';
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function jsonBlock(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export default function AiTracesPage() {
  const role = useAiOpsRole();
  const rawTextPlaceholder =
    role === 'VIEWER' ? '只读账号不显示原文' : null;
  const [conversationInput, setConversationInput] = useState('');
  const [intentInput, setIntentInput] = useState('');
  const [filters, setFilters] = useState<{
    conversationId?: string;
    intent?: string;
  }>({});
  const [page, setPage] = useState(1);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AiTraceDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  // 防止快速切换行时，先发后到的旧详情覆盖当前选择。
  const detailRequestSeq = useRef(0);

  const { data, loading, error, refresh } = useRequest(
    () =>
      aiOpsApi.getTraces({
        ...(filters.conversationId
          ? { conversationId: filters.conversationId }
          : {}),
        ...(filters.intent ? { intent: filters.intent } : {}),
        page,
        pageSize: PAGE_SIZE,
      }),
    { refreshDeps: [filters, page] },
  );

  const list = (data?.list ?? []) as AiTraceRow[];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasFilters = Boolean(filters.conversationId || filters.intent);

  const applyFilters = () => {
    const next: { conversationId?: string; intent?: string } = {};
    const conversationId = conversationInput.trim();
    const intent = intentInput.trim();
    if (conversationId) next.conversationId = conversationId;
    if (intent) next.intent = intent;
    setFilters(next);
    setPage(1);
  };

  const resetFilters = () => {
    setConversationInput('');
    setIntentInput('');
    setFilters({});
    setPage(1);
  };

  const openDetail = useCallback(async (id: string) => {
    const seq = ++detailRequestSeq.current;
    setSelectedId(id);
    setDetail(null);
    setDetailError('');
    setDetailLoading(true);
    try {
      const result = await aiOpsApi.getTrace(id);
      if (seq === detailRequestSeq.current) setDetail(result);
    } catch {
      // 详情报错对运营只暴露可操作文案，原始错误留给浏览器网络面板。
      if (seq === detailRequestSeq.current) {
        setDetailError('链路详情加载失败，请重试。');
      }
    } finally {
      if (seq === detailRequestSeq.current) setDetailLoading(false);
    }
  }, []);

  const closeDetail = () => {
    detailRequestSeq.current += 1;
    setSelectedId(null);
    setDetail(null);
    setDetailError('');
    setDetailLoading(false);
  };

  return (
    <div className="space-y-5 p-4">
      <PageHeader
        title="链路追踪"
        description="一次 AI 回复的意图识别、RAG 检索与模型响应链路（只读）"
      />

      <div className="flex flex-wrap items-end gap-3 text-sm">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-gray-500">会话 ID</span>
          <input
            aria-label="conversationId"
            className="w-64 rounded-lg border px-3 py-1.5 dark:border-white/10 dark:bg-gray-800"
            placeholder="conversationId"
            value={conversationInput}
            onChange={(e) => setConversationInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') applyFilters();
            }}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-gray-500">意图</span>
          <input
            aria-label="intent"
            className="w-48 rounded-lg border px-3 py-1.5 dark:border-white/10 dark:bg-gray-800"
            placeholder="order / wallet …"
            value={intentInput}
            onChange={(e) => setIntentInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') applyFilters();
            }}
          />
        </label>
        <Button onClick={applyFilters}>查询</Button>
        <Button variant="outline" onClick={resetFilters}>
          重置
        </Button>
      </div>

      {error ? (
        <AiErrorBanner
          message="链路列表加载失败，请重试。"
          onRetry={() => {
            void refresh();
          }}
        />
      ) : null}

      <section className={cardClass}>
        {loading ? (
          <div className="py-8 text-center text-sm text-gray-400">
            Loading...
          </div>
        ) : list.length === 0 ? (
          <div className="py-8 text-center text-sm text-gray-500">
            {hasFilters ? '没有匹配的链路记录。' : '暂无链路记录。'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-left text-xs text-gray-500">
                <tr>
                  <th className="px-2 py-2">时间</th>
                  <th className="px-2 py-2">会话</th>
                  <th className="px-2 py-2">意图</th>
                  <th className="px-2 py-2">状态</th>
                  <th className="px-2 py-2">耗时</th>
                  <th className="px-2 py-2">Tokens</th>
                  <th className="px-2 py-2">输出摘要</th>
                  <th className="px-2 py-2" />
                </tr>
              </thead>
              <tbody>
                {list.map((row) => (
                  <tr
                    key={row.id}
                    className="border-t border-gray-100 align-top dark:border-white/5"
                  >
                    <td className="whitespace-nowrap px-2 py-2 text-gray-600 dark:text-gray-300">
                      {formatTime(row.createdAt)}
                    </td>
                    <td className="px-2 py-2">
                      <Link
                        href={`/ai-ops/context?conversationId=${encodeURIComponent(
                          row.conversationId,
                        )}`}
                        className="break-all font-mono text-xs text-primary-600 hover:underline dark:text-primary-400"
                        title={row.conversationId}
                      >
                        {row.conversationId}
                      </Link>
                    </td>
                    <td className="px-2 py-2">{row.intent || '—'}</td>
                    <td className="px-2 py-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          STATUS_STYLES[row.status] ??
                          'bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-gray-300'
                        }`}
                      >
                        {STATUS_LABELS[row.status] ?? row.status}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-2 py-2">
                      {row.latencyMs != null ? `${row.latencyMs} ms` : '—'}
                    </td>
                    <td className="whitespace-nowrap px-2 py-2">
                      {totalTokens(row)}
                    </td>
                    <td
                      className="max-w-xs truncate px-2 py-2 text-gray-600 dark:text-gray-300"
                      title={rawTextPlaceholder ?? row.output ?? undefined}
                    >
                      {rawTextPlaceholder ?? snippet(row.output)}
                    </td>
                    <td className="whitespace-nowrap px-2 py-2 text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          void openDetail(row.id);
                        }}
                      >
                        {selectedId === row.id && detailLoading
                          ? '加载中…'
                          : '详情'}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs text-gray-500">
          <span>
            共 {total} 条 · 第 {page} / {totalPages} 页
          </span>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              上一页
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              下一页
            </Button>
          </div>
        </div>
      </section>

      {selectedId ? (
        <section className={cardClass}>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold">链路详情</h2>
              <p className="mt-1 break-all font-mono text-xs text-gray-500">
                {selectedId}
              </p>
            </div>
            <Button size="sm" variant="ghost" onClick={closeDetail}>
              关闭
            </Button>
          </div>

          {detailLoading ? (
            <div className="py-6 text-center text-sm text-gray-400">
              Loading...
            </div>
          ) : detailError ? (
            <div className="mt-3">
              <AiErrorBanner
                message={detailError}
                onRetry={() => {
                  void openDetail(selectedId);
                }}
              />
            </div>
          ) : detail ? (
            <TraceDetailBody detail={detail} />
          ) : (
            <div className="py-6 text-center text-sm text-gray-400">
              未获取到链路详情。
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}

function TraceDetailBody({ detail }: { detail: AiTraceDetail }) {
  const role = useAiOpsRole();
  const rawTextPlaceholder =
    role === 'VIEWER' ? '只读账号不显示原文' : null;
  return (
    <>
      <dl className="mt-4 grid gap-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt className="text-gray-500">会话</dt>
          <dd className="mt-1 break-all font-mono">
            <Link
              href={`/ai-ops/context?conversationId=${encodeURIComponent(
                detail.conversationId,
              )}`}
              className="text-primary-600 hover:underline dark:text-primary-400"
            >
              {detail.conversationId}
            </Link>
          </dd>
        </div>
        <div>
          <dt className="text-gray-500">意图</dt>
          <dd className="mt-1">{detail.intent || '—'}</dd>
        </div>
        <div>
          <dt className="text-gray-500">状态</dt>
          <dd className="mt-1">
            {STATUS_LABELS[detail.status] ?? detail.status}
          </dd>
        </div>
        <div>
          <dt className="text-gray-500">耗时 / Tokens</dt>
          <dd className="mt-1">
            {detail.latencyMs != null ? `${detail.latencyMs} ms` : '—'}
            {' · '}
            {totalTokens(detail)}
          </dd>
        </div>
        <div>
          <dt className="text-gray-500">触发消息</dt>
          <dd className="mt-1 break-all font-mono">
            {detail.triggerMessageId || '—'}
          </dd>
        </div>
        <div>
          <dt className="text-gray-500">AI 消息</dt>
          <dd className="mt-1 break-all font-mono">
            {detail.aiMessageId || '—'}
          </dd>
        </div>
        <div>
          <dt className="text-gray-500">创建时间</dt>
          <dd className="mt-1">{formatTime(detail.createdAt)}</dd>
        </div>
        <div>
          <dt className="text-gray-500">来源</dt>
          <dd className="mt-1">{detail.source}</dd>
        </div>
      </dl>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div>
          <div className="text-xs text-gray-500">用户输入（截断）</div>
          <div className="mt-1 whitespace-pre-wrap break-words rounded-lg bg-gray-50 p-3 text-sm dark:bg-gray-950/40">
            {rawTextPlaceholder ?? detail.input ?? '—'}
          </div>
        </div>
        <div>
          <div className="text-xs text-gray-500">AI 输出（截断）</div>
          <div className="mt-1 whitespace-pre-wrap break-words rounded-lg bg-gray-50 p-3 text-sm dark:bg-gray-950/40">
            {rawTextPlaceholder ?? detail.output ?? '—'}
          </div>
        </div>
      </div>

      <div className="mt-5">
        <h3 className="text-sm font-semibold">
          评分（{detail.scores?.length ?? 0}）
        </h3>
        {detail.scores?.length ? (
          <div className="mt-2 space-y-2">
            {detail.scores.map((score) => (
              <div
                key={score.id}
                className="rounded-lg border p-2 text-xs dark:border-white/10"
              >
                <span className="font-mono">{score.source}</span>
                <span className="mx-2">·</span>
                <span>{score.stringValue ?? '-'}</span>
                <span className="mx-2">·</span>
                <span>{score.value ?? '-'}</span>
                {score.comment ? (
                  <div className="mt-1 text-gray-500">{score.comment}</div>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-sm text-gray-500">该链路没有评分记录。</p>
        )}
      </div>

      <div className="mt-5">
        <h3 className="text-sm font-semibold">
          Spans（{detail.spans?.length ?? 0}）
        </h3>
        {detail.spans?.length ? (
          <div className="mt-2 space-y-2">
            {detail.spans.map((span) => (
              <SpanRow key={span.id} span={span} />
            ))}
          </div>
        ) : (
          <p className="mt-2 text-sm text-gray-500">该链路没有 span 记录。</p>
        )}
      </div>

      <details className="mt-4 rounded-lg border border-gray-100 dark:border-white/10">
        <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-gray-600 dark:text-gray-300">
          原始 spans JSON（工程师）
        </summary>
        <pre className="max-h-96 overflow-auto border-t border-gray-100 p-3 text-xs dark:border-white/10">
          {jsonBlock(detail.spans)}
        </pre>
      </details>
    </>
  );
}

function SpanRow({ span }: { span: AiSpanRow }) {
  const role = useAiOpsRole();
  const rawTextPlaceholder =
    role === 'VIEWER' ? '只读账号不显示原文' : null;
  const isError = span.status === 'ERROR';
  return (
    <div
      className={`rounded-lg border p-3 dark:border-white/10 ${
        isError
          ? 'border-red-200 bg-red-50/50 dark:border-red-500/30 dark:bg-red-500/5'
          : ''
      }`}
    >
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded bg-gray-100 px-2 py-0.5 font-mono text-gray-600 dark:bg-white/10 dark:text-gray-300">
          {span.type}
        </span>
        <span className="font-medium">{span.name}</span>
        <span className={isError ? 'text-red-600' : 'text-gray-500'}>
          {span.status}
        </span>
        <span className="ml-auto text-gray-400">
          {span.durationMs != null ? `${span.durationMs} ms` : '—'}
        </span>
      </div>
      <div className="mt-1 text-[11px] text-gray-400">
        {formatTime(span.startedAt)}
        {span.endedAt ? ` → ${formatTime(span.endedAt)}` : ''}
      </div>
      {span.error ? (
        <div className="mt-2 whitespace-pre-wrap break-words text-xs text-red-600 dark:text-red-300">
          {span.error}
        </div>
      ) : null}
      <details className="mt-2 text-xs">
        <summary className="cursor-pointer text-gray-500">
          input / output
        </summary>
        <div className="mt-1 grid gap-2 lg:grid-cols-2">
          <div>
            <div className="text-[11px] text-gray-400">input</div>
            <pre className="mt-1 max-h-48 overflow-auto rounded bg-gray-50 p-2 dark:bg-gray-950/40">
              {rawTextPlaceholder ?? jsonBlock(span.input)}
            </pre>
          </div>
          <div>
            <div className="text-[11px] text-gray-400">output</div>
            <pre className="mt-1 max-h-48 overflow-auto rounded bg-gray-50 p-2 dark:bg-gray-950/40">
              {rawTextPlaceholder ?? jsonBlock(span.output)}
            </pre>
          </div>
        </div>
      </details>
    </div>
  );
}
