'use client';

import React, { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { knowledgeApi } from '@/api';
import { QualityReviewPanel } from '@/components/knowledge/QualityReviewPanel';
import type { KnowledgeDocument } from '@/type/types';

export default function DocumentReviewPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [doc, setDoc] = useState<KnowledgeDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    knowledgeApi
      .getById(id)
      .then((data) => {
        setDoc(data as any);
        setLoading(false);
      })
      .catch((err: any) => {
        setError(err?.message || 'Failed to load document');
        setLoading(false);
      });
  }, [id]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[80vh] text-gray-400">
        <Loader2 size={24} className="mr-2 animate-spin" />
        Loading document...
      </div>
    );
  }

  if (error || !doc) {
    return (
      <div className="flex flex-col items-center justify-center h-[80vh] gap-4 text-gray-400">
        <p className="text-red-500">{error || 'Document not found'}</p>
        <button
          onClick={() => router.back()}
          className="rounded-xl border border-gray-200 px-4 py-2 text-sm hover:bg-gray-50 dark:border-white/10"
        >
          Go back
        </button>
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-4rem)] flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-gray-100 px-6 py-3 dark:border-white/10">
        <button
          onClick={() => router.back()}
          className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-white/5"
        >
          <ArrowLeft size={18} />
        </button>
        <div className="flex items-center gap-2 min-w-0">
          <h1 className="truncate text-base font-semibold text-gray-900 dark:text-white">
            Quality Review
          </h1>
          <span className="text-sm text-gray-400">·</span>
          <p className="truncate text-sm text-gray-500">{doc.title}</p>
        </div>
      </div>

      {/* Full-page Quality Review Panel (non-modal) */}
      <div className="flex-1 overflow-hidden">
        <QualityReviewPanelFull document={doc} />
      </div>
    </div>
  );
}

/**
 * Full-page version of quality review — same diff logic as QualityReviewPanel
 * but without the modal overlay, using full available height.
 */
function QualityReviewPanelFull({ document }: { document: KnowledgeDocument }) {
  const [diff, setDiff] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!document.id) return;
    setLoading(true);
    knowledgeApi
      .getDiff(document.id)
      .then((data: any) => {
        setDiff(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [document.id]);

  return (
    <div className="flex h-full flex-col">
      {/* Stats bar */}
      {diff && (
        <div className="flex items-center gap-4 border-b border-gray-100 px-6 py-2 text-xs dark:border-white/10">
          <span className="font-medium text-gray-500">
            Similarity: <span className="font-semibold text-gray-700 dark:text-gray-300">{diff.wer?.toFixed(1)}%</span>
          </span>
          <span className="text-red-500">🔴 {diff.diffRanges?.filter((r: any) => r.severity === 'critical').length || 0} critical</span>
          <span className="text-amber-500">🟡 {diff.diffRanges?.filter((r: any) => r.severity === 'minor').length || 0} minor</span>
          <span className="text-green-500">🟢 {diff.diffRanges?.filter((r: any) => r.severity === 'ignore').length || 0} ignored</span>
          {diff.numberErrors?.length > 0 && (
            <span className="text-purple-500">🔢 {diff.numberErrors.length} number mismatches</span>
          )}
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => setEditing(!editing)}
              className="rounded-lg border border-gray-200 px-3 py-1 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50 dark:border-white/10 dark:text-gray-400"
            >
              {editing ? 'View Diff' : 'Edit Content'}
            </button>
          </div>
        </div>
      )}

      {/* Dual-pane content */}
      <div className="flex flex-1 gap-0 overflow-hidden">
        {/* Left: pdf-parse */}
        <div className="flex w-1/2 flex-col border-r border-gray-100 dark:border-white/10">
          <div className="border-b border-gray-50 px-4 py-1.5 text-[11px] font-medium text-gray-400 dark:border-white/5">
            📄 pdf-parse (Baseline)
          </div>
          <div className="flex-1 overflow-auto p-4">
            <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-gray-700 dark:text-gray-300">
              {document.rawContent ?? 'No baseline content'}
            </pre>
          </div>
        </div>

        {/* Right: Unstructured */}
        <div className="flex w-1/2 flex-col">
          <div className="border-b border-gray-50 px-4 py-1.5 text-[11px] font-medium text-gray-400 dark:border-white/5">
            ✏️ Unstructured (AI Parsed)
          </div>
          <div className="flex-1 overflow-auto p-4">
            {editing ? (
              <textarea
                className="h-full w-full resize-none bg-transparent font-mono text-xs leading-relaxed text-gray-700 outline-none dark:text-gray-300"
                defaultValue={document.content}
              />
            ) : (
              <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-gray-700 dark:text-gray-300">
                {document.content}
              </pre>
            )}
          </div>
        </div>
      </div>

      {/* Diff results */}
      {loading && (
        <div className="flex items-center justify-center py-8 text-gray-400">
          <Loader2 size={16} className="mr-2 animate-spin" />
          Computing diff...
        </div>
      )}
    </div>
  );
}
