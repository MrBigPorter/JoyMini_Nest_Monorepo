'use client';

import React, { useMemo } from 'react';
import { X, Download, CheckCircle, RotateCcw, SkipForward } from 'lucide-react';
import { QualityBadge } from './QualityBadge';
import type { KnowledgeDocument } from '@/type/types';

interface QualityReviewPanelProps {
  document: KnowledgeDocument;
  onClose: () => void;
  onApprove?: () => void;
  onReupload?: () => void;
  onIgnore?: () => void;
}

/**
 * QualityReviewPanel — 双栏对比审核面板
 *
 * 左侧显示原文（文档 content），右侧显示提取文本（也是 content）。
 * 对于 PDF 上传的文档，content 是解析后的文本。
 * 双栏并排让操作员一目了然对比差异。
 *
 * UI 状态:
 * - 正常: 双栏显示，操作按钮可用
 * - 加载中: Skeleton（目前 content 已加载，暂不涉及额外 API 调用）
 * - 有差异: 未来可做差异行高亮（需要 L2 LLM Diff 结果）
 */
export function QualityReviewPanel({
  document,
  onClose,
  onApprove,
  onReupload,
  onIgnore,
}: QualityReviewPanelProps) {
  const flags = useMemo(() => {
    if (!document.qualityFlags) return [];
    return document.qualityFlags.split(',').map((f) => f.trim());
  }, [document.qualityFlags]);

  const flagLabels: Record<string, { label: string; description: string }> = {
    truncation: {
      label: 'Truncation',
      description: 'Content may be truncated (incomplete ending)',
    },
    low_retention: {
      label: 'Low Retention',
      description: 'Extracted text is very small compared to file size',
    },
    encoding_issue: {
      label: 'Encoding Issue',
      description: 'Contains garbled or replacement characters',
    },
    empty_content: {
      label: 'Empty Content',
      description: 'No content was extracted from the file',
    },
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-5xl max-h-[90vh] flex flex-col rounded-2xl bg-white shadow-xl dark:bg-gray-900">
        {/* ── Header ── */}
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4 dark:border-white/10">
          <div className="flex items-center gap-3 min-w-0">
            <h2 className="truncate text-lg font-semibold text-gray-900 dark:text-white">
              Quality Review
            </h2>
            <span className="shrink-0 text-sm text-gray-400">·</span>
            <p className="truncate text-sm text-gray-500">{document.title}</p>
            <QualityBadge score={document.qualityScore} />
          </div>
          <button
            onClick={onClose}
            className="shrink-0 rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-white/5"
          >
            <X size={18} />
          </button>
        </div>

        {/* ── Dual-pane content ── */}
        <div className="flex flex-1 gap-0 overflow-hidden min-h-0">
          {/* Original (left) — raw content from file buffer */}
          <div className="flex w-1/2 flex-col border-r border-gray-100 dark:border-white/10">
            <div className="border-b border-gray-50 px-4 py-2 text-xs font-medium text-gray-400 dark:border-white/5">
              📄 Original Content
            </div>
            <div className="flex-1 overflow-auto p-4">
              {document.rawContent?.startsWith('http') ? (
                <embed
                  src={document.rawContent}
                  type="application/pdf"
                  className="h-full w-full border-0"
                />
              ) : (
                <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-gray-700 dark:text-gray-300">
                  {document.rawContent ?? 'Original content not available'}
                </pre>
              )}
            </div>
          </div>

          {/* Extracted (right) — parsed/extracted text */}
          <div className="flex w-1/2 flex-col">
            <div className="border-b border-gray-50 px-4 py-2 text-xs font-medium text-gray-400 dark:border-white/5">
              ✏️ Extracted Text
            </div>
            <div className="flex-1 overflow-auto p-4">
              <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-gray-700 dark:text-gray-300">
                {document.content}
              </pre>
            </div>
          </div>
        </div>

        {/* ── Footer: Flags + Actions ── */}
        <div className="border-t border-gray-100 px-6 py-4 dark:border-white/10">
          {/* Quality flags */}
          {flags.length > 0 && (
            <div className="mb-3 space-y-1">
              <p className="text-xs font-medium text-red-600 dark:text-red-400">
                ⚠️ Quality Issues:
              </p>
              {flags.map((flag) => (
                <div key={flag} className="flex items-start gap-2">
                  <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-red-400" />
                  <div>
                    <p className="text-xs font-medium text-gray-700 dark:text-gray-300">
                      {flagLabels[flag]?.label ?? flag}
                    </p>
                    <p className="text-[10px] text-gray-400">
                      {flagLabels[flag]?.description ?? 'Unknown issue'}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {flags.length === 0 && document.qualityScore !== null && (
            <div className="mb-3">
              <p className="text-xs font-medium text-green-600 dark:text-green-400">
                ✅ No quality issues detected
              </p>
            </div>
          )}

          {document.qualityScore === null && (
            <div className="mb-3">
              <p className="text-xs text-gray-400">
                ⚪ Quality check not performed for this document
              </p>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex items-center justify-end gap-2">
            {onReupload && (
              <button
                onClick={onReupload}
                className="flex items-center gap-1.5 rounded-xl border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 transition-colors hover:bg-red-50 dark:border-red-900/30 dark:text-red-400 dark:hover:bg-red-900/20"
              >
                <RotateCcw size={12} />
                Re-upload
              </button>
            )}

            {onIgnore && (
              <button
                onClick={onIgnore}
                className="flex items-center gap-1.5 rounded-xl border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50 dark:border-white/10 dark:text-gray-400 dark:hover:bg-white/5"
              >
                <SkipForward size={12} />
                Ignore
              </button>
            )}

            {onApprove && (
              <button
                onClick={onApprove}
                className="flex items-center gap-1.5 rounded-xl bg-teal-500 px-4 py-1.5 text-xs font-medium text-white transition-colors hover:bg-teal-600"
              >
                <CheckCircle size={12} />
                Approve
              </button>
            )}

            <button
              onClick={onClose}
              className="rounded-xl border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50 dark:border-white/10 dark:text-gray-400 dark:hover:bg-white/5"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
