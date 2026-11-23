'use client';

import React, { useState } from 'react';
import { useRequest } from 'ahooks';
import { X, Sparkles, RefreshCw } from 'lucide-react';
import { ModalManager } from '@repo/ui';
import { kbCandidatesApi, knowledgeApi } from '@/api';
import { canReviewKbCandidates, useAiOpsRole } from '@/lib/ai-ops-permissions';
import { useToastStore } from '@/store/useToastStore';
import { ProcessPipeline } from './ProcessPipeline';
import type { TFunc } from '@/hooks/useTranslation';
import type { KnowledgeDocument } from '@/type/types';

const CONTENT_TYPE_BADGE: Record<string, string> = {
  markdown: 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400',
  pdf: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
};

const PRIORITY_BADGE: Record<string, string> = {
  P0: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  P1: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  P2: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  P3: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400',
};

export function DocDetailModal({
  document: initialDoc,
  onClose,
  t,
}: {
  document: KnowledgeDocument;
  onClose: () => void;
  t: TFunc;
}) {
  const [doc, setDoc] = useState(initialDoc);
  const role = useAiOpsRole();
  const canRegenerate = canReviewKbCandidates(role);

  const { data: runs, refresh: refreshRuns } = useRequest(() =>
    kbCandidatesApi.runs(doc.id).catch(() => []),
  );
  const { data: candidatesData, refresh: refreshCandidates } = useRequest(() =>
    kbCandidatesApi
      .list({ documentId: doc.id, page: 1, pageSize: 10 })
      .catch(() => null),
  );
  const latestRun = runs?.[0];
  const candidates = candidatesData?.items ?? [];

  const handleRegenerate = () => {
    ModalManager.open({
      title:
        '重新生成候选？会新建一次生成运行，尚未审核的旧候选会被新运行取代。',
      confirmText: '重新生成',
      onConfirm: async () => {
        try {
          const result = await kbCandidatesApi.regenerate(doc.id);
          if (result.enqueued) {
            useToastStore
              .getState()
              .addToast('info', '已加入生成队列，稍后刷新查看候选。');
          } else {
            useToastStore
              .getState()
              .addToast(
                'error',
                `未入队：${result.reason ?? 'unknown'}（检查 KB_GENERATION_ENABLED 与文档发布状态）`,
              );
          }
          await Promise.all([refreshRuns(), refreshCandidates()]);
        } catch (error: any) {
          useToastStore
            .getState()
            .addToast('error', `重新生成失败：${error?.message ?? '未知错误'}`);
        }
      },
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white p-6 shadow-xl dark:bg-gray-900">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            {t('knowledgeBase.docDetail')}
          </h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-white/5"
          >
            <X size={18} />
          </button>
        </div>

        <div className="space-y-3 text-sm">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <span className="text-xs text-gray-400">
                {t('knowledgeBase.title')}
              </span>
              <p className="font-medium text-gray-900 dark:text-white">
                {doc.title}
              </p>
            </div>
            <div>
              <span className="text-xs text-gray-400">
                {t('knowledgeBase.domain')}
              </span>
              <p className="font-medium text-gray-900 dark:text-white">
                {doc.domain}
              </p>
            </div>
            <div>
              <span className="text-xs text-gray-400">
                {t('knowledgeBase.docId')}
              </span>
              <p className="font-mono text-xs text-gray-900 dark:text-white">
                {doc.docId}
              </p>
            </div>
            <div>
              <span className="text-xs text-gray-400">
                {t('knowledgeBase.locale')}
              </span>
              <p className="font-medium text-gray-900 dark:text-white">
                {doc.locale}
              </p>
            </div>
            <div>
              <span className="text-xs text-gray-400">
                {t('knowledgeBase.contentType')}
              </span>
              <span
                className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${
                  CONTENT_TYPE_BADGE[doc.contentType] ??
                  'bg-gray-100 text-gray-500'
                }`}
              >
                {doc.contentType}
              </span>
            </div>
            <div>
              <span className="text-xs text-gray-400">
                {t('knowledgeBase.priority')}
              </span>
              <span
                className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${
                  PRIORITY_BADGE[doc.priority] ?? 'bg-gray-100 text-gray-500'
                }`}
              >
                {doc.priority}
              </span>
            </div>
          </div>

          {doc.keywords && doc.keywords.length > 0 && (
            <div>
              <span className="text-xs text-gray-400">
                {t('knowledgeBase.keywords')}
              </span>
              <div className="mt-1 flex flex-wrap gap-1">
                {doc.keywords.map((kw) => (
                  <span
                    key={kw}
                    className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] text-gray-600 dark:bg-white/10 dark:text-gray-400"
                  >
                    {kw}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div>
            <span className="text-xs text-gray-400">
              {t('knowledgeBase.content')}
            </span>
            <pre className="mt-1 max-h-60 overflow-auto whitespace-pre-wrap rounded-xl bg-gray-50 p-3 font-mono text-xs leading-relaxed text-gray-700 dark:bg-gray-800 dark:text-gray-300">
              {doc.content}
            </pre>
          </div>

          <div className="flex items-center gap-2 text-xs text-gray-400">
            <span>{t('knowledgeBase.version', { version: doc.version })}</span>
            <span>·</span>
            <span>{new Date(doc.createdAt).toLocaleString()}</span>
            {doc.updatedAt !== doc.createdAt && (
              <>
                <span>·</span>
                <span>updated {new Date(doc.updatedAt).toLocaleString()}</span>
              </>
            )}
          </div>
        </div>

        {/* Processing Pipeline */}
        <div className="border-t border-gray-100 pt-4 mt-4 dark:border-white/10">
          <h3 className="mb-3 text-sm font-medium text-gray-900 dark:text-white">
            Processing
          </h3>
          <ProcessPipeline
            documentId={doc.id}
            processStatus={doc.processStatus || 'uploaded'}
            onRefresh={async () => {
              try {
                const updated = await knowledgeApi.getById(doc.id);
                if (updated) setDoc(updated as any);
              } catch {}
            }}
          />
        </div>

        {/* AI 候选（知识库驱动的自动维护） */}
        <div className="border-t border-gray-100 pt-4 mt-4 dark:border-white/10">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="flex items-center gap-1.5 text-sm font-medium text-gray-900 dark:text-white">
              <Sparkles size={14} className="text-teal-500" />
              发布后生成的候选
              {latestRun ? (
                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-normal text-gray-600 dark:bg-white/10 dark:text-gray-300">
                  run: {latestRun.status}
                </span>
              ) : null}
            </h3>
            <button
              type="button"
              onClick={handleRegenerate}
              disabled={!canRegenerate}
              className="flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs text-gray-600 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:text-gray-300 dark:hover:bg-white/5"
              title={canRegenerate ? '重新生成' : '当前角色无权触发'}
            >
              <RefreshCw size={12} />
              重新生成
            </button>
          </div>

          {latestRun ? (
            <p className="text-xs text-gray-500">
              最近运行：v{latestRun.documentVersion} ·{' '}
              {latestRun.candidateCount} 条候选
              {latestRun.filteredCount > 0
                ? ` · 过滤 ${latestRun.filteredCount}`
                : ''}
              {latestRun.error
                ? ` · 错误：${latestRun.error.slice(0, 80)}`
                : ''}
            </p>
          ) : (
            <p className="text-xs text-gray-500">还没有生成运行记录。</p>
          )}

          {candidates.length > 0 ? (
            <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto">
              {candidates.map((candidate) => (
                <li
                  key={candidate.id}
                  className="flex items-start gap-2 rounded-lg bg-gray-50 px-2 py-1.5 text-xs dark:bg-white/5"
                >
                  <span className="shrink-0 rounded-full bg-white px-1.5 py-0.5 text-[10px] text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                    {candidate.kind}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-gray-700 dark:text-gray-300">
                    {candidate.text}
                  </span>
                  <span className="shrink-0 text-[10px] text-gray-400">
                    {candidate.status}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}

          <a
            href="/knowledge/candidates"
            className="mt-2 inline-block text-xs text-teal-600 underline hover:text-teal-500"
          >
            去候选审核台处理 →
          </a>
        </div>

        <div className="mt-5 flex justify-end">
          <button
            onClick={onClose}
            className="rounded-xl border border-gray-200 px-4 py-2 text-sm text-gray-600 transition-colors hover:bg-gray-50 dark:border-white/10 dark:text-gray-400 dark:hover:bg-white/5"
          >
            {t('knowledgeBase.cancel')}
          </button>
        </div>
      </div>
    </div>
  );
}
