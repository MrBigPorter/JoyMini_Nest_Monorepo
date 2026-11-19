'use client';

import React, { useMemo, useState } from 'react';
import { useRequest } from 'ahooks';
import { Button } from '@repo/ui';
import { AiFeedbackItem, QueryAiFeedbackParams } from '@/type/types';
import { chatApi } from '@/api';
import { PageHeader } from '@/components/scaffold/PageHeader';
import { useTranslation } from '@/hooks/useTranslation';

const PAGE_SIZE = 20;
const ERROR_TYPES = ['irrelevant', 'outdated', 'overreach', 'format'];
const SIGNALS = ['transferred', 'repeated_question', 'abandoned'];

export function AiFeedbackClient() {
  const { t } = useTranslation();
  const [source, setSource] = useState<'' | 'explicit' | 'implicit'>('');
  const [signal, setSignal] = useState('');
  const [errorType, setErrorType] = useState('');
  const [page, setPage] = useState(1);

  const enabled = process.env.NEXT_PUBLIC_AI_FEEDBACK_UI_ENABLED === 'true';

  const params: QueryAiFeedbackParams = useMemo(
    () => ({
      page,
      pageSize: PAGE_SIZE,
      ...(source ? { source } : {}),
      ...(signal ? { signal } : {}),
      ...(errorType ? { errorType } : {}),
    }),
    [page, source, signal, errorType],
  );

  const { data, loading } = useRequest(
    () =>
      enabled
        ? chatApi.getFeedbackList(params)
        : Promise.resolve({ list: [], total: 0 }),
    { refreshDeps: [params, enabled] },
  );

  const list = data?.list ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const exportJsonl = () => {
    const lines = list.map((item: AiFeedbackItem) =>
      JSON.stringify({
        id: item.id,
        input: '',
        // 回放要求 expect 非空；待人工补标
        expect: null,
        tags: [
          item.source,
          item.signal ?? item.errorType ?? item.verdict ?? 'unknown',
        ].filter(Boolean),
        note: item.note ?? '',
        source: item.source,
        errorType: item.errorType,
        conversationId: item.conversationId,
        messageId: item.messageId,
      }),
    );
    const blob = new Blob([`${lines.join('\n')}\n`], {
      type: 'application/jsonl',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ai-feedback-${new Date().toISOString().slice(0, 10)}.jsonl`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!enabled) {
    return (
      <div className="p-6">
        <PageHeader title={t('translations.aiFeedback')} />
        <p className="mt-4 text-sm text-gray-500">
          AI feedback UI is disabled (NEXT_PUBLIC_AI_FEEDBACK_UI_ENABLED !=
          true).
        </p>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      <PageHeader
        title={t('translations.aiFeedback')}
        description={t('customerService.feedbackTitle')}
        action={
          <Button
            variant="outline"
            onClick={exportJsonl}
            disabled={list.length === 0}
          >
            Export JSONL
          </Button>
        }
      />

      <div className="flex flex-wrap gap-2">
        <select
          className="border rounded-lg px-3 py-2 text-sm dark:bg-gray-800 dark:border-white/10"
          value={source}
          onChange={(e) => {
            setSource(e.target.value as typeof source);
            setPage(1);
          }}
        >
          <option value="">All sources</option>
          <option value="explicit">Explicit</option>
          <option value="implicit">Implicit</option>
        </select>
        <select
          className="border rounded-lg px-3 py-2 text-sm dark:bg-gray-800 dark:border-white/10"
          value={signal}
          onChange={(e) => {
            setSignal(e.target.value);
            setPage(1);
          }}
        >
          <option value="">All signals</option>
          {SIGNALS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select
          className="border rounded-lg px-3 py-2 text-sm dark:bg-gray-800 dark:border-white/10"
          value={errorType}
          onChange={(e) => {
            setErrorType(e.target.value);
            setPage(1);
          }}
        >
          <option value="">All error types</option>
          {ERROR_TYPES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      <div className="overflow-x-auto rounded-xl border border-gray-100 dark:border-white/10">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 dark:bg-white/5 text-left">
            <tr>
              <th className="px-3 py-2">Time</th>
              <th className="px-3 py-2">Source</th>
              <th className="px-3 py-2">Verdict / Signal</th>
              <th className="px-3 py-2">Error type</th>
              <th className="px-3 py-2">Conversation</th>
              <th className="px-3 py-2">Note</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-gray-400">
                  Loading...
                </td>
              </tr>
            )}
            {!loading && list.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-gray-400">
                  No feedback
                </td>
              </tr>
            )}
            {list.map((item: AiFeedbackItem) => (
              <tr
                key={item.id}
                className="border-t border-gray-100 dark:border-white/5"
              >
                <td className="px-3 py-2 whitespace-nowrap">
                  {new Date(item.createdAt).toLocaleString()}
                </td>
                <td className="px-3 py-2">{item.source}</td>
                <td className="px-3 py-2">
                  {item.verdict ?? item.signal ?? '-'}
                </td>
                <td className="px-3 py-2">{item.errorType ?? '-'}</td>
                <td className="px-3 py-2 font-mono text-xs">
                  {item.conversationId}
                </td>
                <td className="px-3 py-2 max-w-[240px] truncate">
                  {item.note ?? '-'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-end gap-2 text-sm">
        <Button
          variant="ghost"
          disabled={page <= 1}
          onClick={() => setPage((p) => Math.max(1, p - 1))}
        >
          Previous
        </Button>
        <span className="text-gray-500">
          {page} / {totalPages} ({total})
        </span>
        <Button
          variant="ghost"
          disabled={page >= totalPages}
          onClick={() => setPage((p) => p + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
