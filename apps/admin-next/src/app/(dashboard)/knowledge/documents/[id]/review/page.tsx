'use client';

import React, { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { knowledgeApi } from '@/api';
import { DiffReviewFull } from '@/components/knowledge/DiffReviewFull';
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

      {/* Full-page Diff Review — inline diff highlighting + click-to-edit */}
      <div className="flex-1 overflow-hidden">
        <DiffReviewFull document={doc} />
      </div>
    </div>
  );
}
