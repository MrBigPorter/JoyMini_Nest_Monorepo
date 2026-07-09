'use client';

import React, { useState } from 'react';
import { knowledgeApi } from '@/api';
import { useTranslation } from '@/hooks/useTranslation';

const STEPS = [
  { key: 'uploaded', label: 'Upload', icon: '📤' },
  { key: 'parsed', label: 'Parse', icon: '📄' },
  { key: 'chunked', label: 'Chunk', icon: '✂️' },
  { key: 'embedded', label: 'Embed', icon: '🔢' },
  { key: 'indexed', label: 'Index', icon: '📑' },
];

const STEP_ORDER = ['uploaded', 'parsed', 'chunked', 'embedded', 'indexed'];

interface ProcessPipelineProps {
  documentId: string;
  processStatus: string;
  onRefresh: () => void;
}

export function ProcessPipeline({
  documentId,
  processStatus,
  onRefresh,
}: ProcessPipelineProps) {
  const { t } = useTranslation();
  const [processing, setProcessing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const currentIdx = STEP_ORDER.indexOf(processStatus);

  const handleStep = async (step: string) => {
    setProcessing(step);
    setError(null);
    try {
      if (step === 'chunk') {
        await knowledgeApi.processChunk(documentId);
      } else if (step === 'embed') {
        await knowledgeApi.processEmbed(documentId);
      }
      onRefresh();
    } catch (err: any) {
      setError(err?.message || '处理失败');
    } finally {
      setProcessing(null);
    }
  };

  const needsService = (step: string): string | null => {
    if (step === 'embed') return 'Ollama';
    if (step === 'index') return 'Meilisearch';
    return null;
  };

  return (
    <div className="space-y-4">
      {/* 步骤条 */}
      <div className="flex items-center gap-1">
        {STEPS.map((step, idx) => {
          const stepIdx = STEP_ORDER.indexOf(step.key);
          const isDone = stepIdx < currentIdx;
          const isCurrent = stepIdx === currentIdx;
          const isPending = stepIdx > currentIdx;

          return (
            <React.Fragment key={step.key}>
              {idx > 0 && (
                <div
                  className={`flex-1 h-0.5 ${
                    isDone ? 'bg-teal-500' : 'bg-gray-200 dark:bg-gray-700'
                  }`}
                />
              )}
              <div className="flex flex-col items-center gap-1">
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                    isDone
                      ? 'bg-teal-500 text-white'
                      : isCurrent
                        ? 'bg-blue-500 text-white ring-2 ring-blue-300'
                        : 'bg-gray-100 text-gray-400 dark:bg-gray-800'
                  }`}
                >
                  {isDone ? '✓' : step.icon}
                </div>
                <span
                  className={`text-[10px] ${
                    isCurrent
                      ? 'font-medium text-blue-600'
                      : 'text-gray-400'
                  }`}
                >
                  {step.label}
                </span>
              </div>
            </React.Fragment>
          );
        })}
      </div>

      {/* 操作按钮 */}
      <div className="space-y-2">
        {processStatus === 'uploaded' && (
          <div className="rounded-lg bg-blue-50 p-3 text-sm text-blue-700 dark:bg-blue-900/20 dark:text-blue-300">
            Uploaded. Next: Chunk (no extra services needed)
            <button
              onClick={() => handleStep('chunk')}
              disabled={processing === 'chunk'}
              className="ml-2 rounded-md bg-blue-600 px-3 py-1 text-xs text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {processing === 'chunk' ? 'Processing...' : 'Run Chunk'}
            </button>
          </div>
        )}

        {processStatus === 'parsed' && (
          <div className="rounded-lg bg-blue-50 p-3 text-sm text-blue-700 dark:bg-blue-900/20 dark:text-blue-300">
            Parsed. Next: Chunk (no extra services needed)
            <button
              onClick={() => handleStep('chunk')}
              disabled={processing === 'chunk'}
              className="ml-2 rounded-md bg-blue-600 px-3 py-1 text-xs text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {processing === 'chunk' ? 'Processing...' : 'Run Chunk'}
            </button>
          </div>
        )}

        {processStatus === 'chunked' && (
          <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-700 dark:bg-amber-900/20 dark:text-amber-300">
            Needs: Ollama + Meilisearch running
            <button
              onClick={() => handleStep('embed')}
              disabled={processing === 'embed'}
              className="ml-2 rounded-md bg-amber-600 px-3 py-1 text-xs text-white hover:bg-amber-700 disabled:opacity-50"
            >
              {processing === 'embed' ? 'Processing...' : 'Run Embed'}
            </button>
          </div>
        )}

        {processStatus === 'embedded' && (
          <div className="rounded-lg bg-green-50 p-3 text-sm text-green-700 dark:bg-green-900/20 dark:text-green-300">
            Embedding complete. Index will complete automatically.
          </div>
        )}

        {processStatus === 'indexed' && (
          <div className="rounded-lg bg-green-50 p-3 text-sm text-green-700 dark:bg-green-900/20 dark:text-green-300">
            ✅ All steps complete
          </div>
        )}
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 p-3 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">
          ❌ {error}
        </div>
      )}
    </div>
  );
}
