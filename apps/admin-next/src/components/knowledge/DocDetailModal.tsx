'use client';

import React, { useState } from 'react';
import { X } from 'lucide-react';
import { knowledgeApi } from '@/api';
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
                  PRIORITY_BADGE[doc.priority] ??
                  'bg-gray-100 text-gray-500'
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
            <span>
              {t('knowledgeBase.version', { version: doc.version })}
            </span>
            <span>·</span>
            <span>{new Date(doc.createdAt).toLocaleString()}</span>
            {doc.updatedAt !== doc.createdAt && (
              <>
                <span>·</span>
                <span>
                  updated {new Date(doc.updatedAt).toLocaleString()}
                </span>
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
