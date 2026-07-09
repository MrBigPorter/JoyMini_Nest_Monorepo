'use client';

import React, { useMemo, useState, useEffect, useCallback } from 'react';
import {
  X,
  CheckCircle,
  RotateCcw,
  SkipForward,
  Save,
  ChevronRight,
  ChevronDown,
} from 'lucide-react';
import { QualityBadge } from './QualityBadge';
import { knowledgeApi } from '@/api';
import type { KnowledgeDocument, DiffResponse, DiffRange } from '@/type/types';

interface QualityReviewPanelProps {
  document: KnowledgeDocument;
  onClose: () => void;
  onApprove?: () => void;
  onReupload?: () => void;
  onIgnore?: () => void;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Severity-based color mapping
// ═══════════════════════════════════════════════════════════════════════════════

const SEVERITY_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  critical: {
    bg: 'bg-red-50 dark:bg-red-950/30',
    text: 'text-red-700 dark:text-red-300',
    border: 'border-red-200 dark:border-red-800',
  },
  minor: {
    bg: 'bg-yellow-50 dark:bg-yellow-950/30',
    text: 'text-yellow-700 dark:text-yellow-300',
    border: 'border-yellow-200 dark:border-yellow-800',
  },
  ignore: {
    bg: 'bg-green-50 dark:bg-green-950/30',
    text: 'text-green-700 dark:text-green-300',
    border: 'border-green-200 dark:border-green-800',
  },
};

const TYPE_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  added: {
    bg: 'bg-green-100 dark:bg-green-900/40',
    text: 'text-green-800 dark:text-green-200',
    label: 'Added in Unstructured',
  },
  removed: {
    bg: 'bg-red-100 dark:bg-red-900/40',
    text: 'text-red-800 dark:text-red-200',
    label: 'Missing from Unstructured',
  },
  equal: {
    bg: 'bg-transparent',
    text: 'text-gray-700 dark:text-gray-300',
    label: 'Identical',
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// CollapsibleSection — fold identical lines to reduce visual noise
// ═══════════════════════════════════════════════════════════════════════════════

function CollapsibleSection({
  text,
  defaultOpen = false,
}: {
  text: string;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const lineCount = text.split('\n').length;

  return (
    <div className="border border-gray-100 dark:border-white/5 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-1.5 px-3 py-1.5 text-[10px] font-medium text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors bg-gray-50 dark:bg-white/5"
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span>
          {lineCount} identical line{lineCount !== 1 ? 's' : ''}
        </span>
        <span className="text-gray-300 dark:text-gray-600">·</span>
        <span className="text-gray-300 dark:text-gray-600">Collapsed</span>
      </button>
      {open && (
        <pre className="px-3 py-2 text-[11px] font-mono leading-relaxed text-gray-500 dark:text-gray-400 whitespace-pre-wrap break-all max-h-32 overflow-auto">
          {text}
        </pre>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// DiffLine — render a single diff range with severity-based highlighting
// ═══════════════════════════════════════════════════════════════════════════════

function DiffLine({ range }: { range: DiffRange }) {
  const typeColor = TYPE_COLORS[range.type] || TYPE_COLORS.equal;
  const severityColor = range.severity
    ? SEVERITY_COLORS[range.severity]
    : null;

  const colorClass = range.type === 'equal'
    ? 'text-gray-500 dark:text-gray-400'
    : severityColor
      ? severityColor.text
      : typeColor.text;

  const bgClass = range.type === 'equal'
    ? ''
    : (severityColor ? severityColor.bg : typeColor.bg);

  return (
    <div
      className={`flex gap-3 px-3 py-1.5 text-[11px] font-mono leading-relaxed border-l-2 ${
        range.type === 'equal'
          ? 'border-gray-100 dark:border-white/5'
          : range.severity === 'critical'
            ? 'border-red-400 dark:border-red-600'
            : range.severity === 'minor'
              ? 'border-yellow-400 dark:border-yellow-600'
              : 'border-green-400 dark:border-green-600'
      } ${bgClass}`}
    >
      {/* Type badge */}
      <span className="shrink-0 w-14 text-[9px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 pt-0.5">
        {range.type === 'equal' ? '=' : range.type === 'added' ? '+ add' : '- del'}
      </span>
      {/* Content */}
      <span className={`${colorClass} whitespace-pre-wrap break-all min-w-0`}>
        {range.value}
      </span>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// NumberErrorBadge — highlight mismatched numbers
// ═══════════════════════════════════════════════════════════════════════════════

function NumberErrorBadge({
  raw,
  parsed,
}: {
  raw: string;
  parsed: string | undefined;
}) {
  return (
    <div className="flex items-center gap-2 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 px-3 py-1.5">
      <span className="text-[10px] font-bold text-red-600 dark:text-red-400 uppercase tracking-wider">
        Number Mismatch
      </span>
      <span className="text-[11px] font-mono text-red-700 dark:text-red-300 line-through">
        {parsed ?? '(missing)'}
      </span>
      <span className="text-[10px] text-red-400">→</span>
      <span className="text-[11px] font-mono font-semibold text-green-700 dark:text-green-300">
        {raw}
      </span>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Main: QualityReviewPanel
// ═══════════════════════════════════════════════════════════════════════════════

export function QualityReviewPanel({
  document,
  onClose,
  onApprove,
  onReupload,
  onIgnore,
}: QualityReviewPanelProps) {
  const [diffData, setDiffData] = useState<DiffResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editableContent, setEditableContent] = useState(document.content);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [showOnlyDiff, setShowOnlyDiff] = useState(false);

  // ── Load diff on mount ──────────────────────────────────────────────────

  useEffect(() => {
    // Only fetch diff for PDF documents (which have rawContent from pdf-parse)
    if (!document.rawContent) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    knowledgeApi
      .getDiff(document.id)
      .then((data) => {
        if (!cancelled) {
          setDiffData(data);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err?.message || 'Failed to load diff');
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [document.id, document.rawContent]);

  // ── Sync editable content when document changes ─────────────────────────

  useEffect(() => {
    setEditableContent(document.content);
    setSaveSuccess(false);
  }, [document.content]);

  // ── Save handler ────────────────────────────────────────────────────────

  const handleSave = useCallback(async () => {
    if (editableContent.trim() === document.content.trim()) return;

    setSaving(true);
    setSaveSuccess(false);
    try {
      await knowledgeApi.updateContent(document.id, editableContent);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : 'Failed to save content',
      );
    } finally {
      setSaving(false);
    }
  }, [document.id, document.content, editableContent]);

  // ── Compute summary stats ───────────────────────────────────────────────

  const stats = useMemo(() => {
    if (!diffData) return null;

    const criticals = diffData.diffRanges.filter(
      (r) => r.severity === 'critical' && r.type !== 'equal',
    ).length;
    const minors = diffData.diffRanges.filter(
      (r) => r.severity === 'minor' && r.type !== 'equal',
    ).length;
    const ignored = diffData.diffRanges.filter(
      (r) => r.severity === 'ignore' && r.type !== 'equal',
    ).length;

    return { criticals, minors, ignored, wer: diffData.wer };
  }, [diffData]);

  // ── Determine which diff ranges to show ─────────────────────────────────

  const visibleRanges = useMemo(() => {
    if (!diffData) return [];

    if (showOnlyDiff) {
      return diffData.diffRanges.filter((r) => r.type !== 'equal');
    }
    return diffData.diffRanges;
  }, [diffData, showOnlyDiff]);

  // ── Flags ───────────────────────────────────────────────────────────────

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

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-6xl max-h-[90vh] flex flex-col rounded-2xl bg-white shadow-xl dark:bg-gray-900">
        {/* ══════ Header ══════ */}
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4 dark:border-white/10">
          <div className="flex items-center gap-3 min-w-0">
            <h2 className="truncate text-lg font-semibold text-gray-900 dark:text-white">
              Quality Review
            </h2>
            <span className="shrink-0 text-sm text-gray-400">·</span>
            <p className="truncate text-sm text-gray-500">{document.title}</p>
            <QualityBadge score={document.qualityScore} />
            {stats && (
              <span className="shrink-0 text-[11px] text-gray-400 font-mono">
                WER: {stats.wer}%
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="shrink-0 rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-white/5"
          >
            <X size={18} />
          </button>
        </div>

        {/* ══════ Dual-pane content ══════ */}
        <div className="flex flex-1 gap-0 overflow-hidden min-h-0">
          {/* ══ Left pane: pdf-parse (rawContent) ══ */}
          <div className="flex w-1/2 flex-col border-r border-gray-100 dark:border-white/10">
            <div className="flex items-center justify-between border-b border-gray-50 px-4 py-2 dark:border-white/5">
              <span className="text-xs font-medium text-gray-400">
                📄 pdf-parse (Baseline)
              </span>
              {diffData && (
                <span className="text-[10px] text-gray-300 font-mono">
                  {diffData.rawContent.length} chars
                </span>
              )}
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
                  {document.rawContent ?? 'pdf-parse content not available'}
                </pre>
              )}
            </div>
          </div>

          {/* ══ Right pane: Unstructured content (editable) ══ */}
          <div className="flex w-1/2 flex-col">
            <div className="flex items-center justify-between border-b border-gray-50 px-4 py-2 dark:border-white/5">
              <span className="text-xs font-medium text-gray-400">
                ✏️ Unstructured (AI Parsed)
              </span>
              {diffData && (
                <span className="text-[10px] text-gray-300 font-mono">
                  {diffData.content.length} chars
                </span>
              )}
            </div>
            <div className="flex-1 overflow-auto p-4">
              <textarea
                value={editableContent}
                onChange={(e) => setEditableContent(e.target.value)}
                className="h-full w-full resize-none border-0 bg-transparent font-mono text-xs leading-relaxed text-gray-700 dark:text-gray-300 focus:outline-none"
                spellCheck={false}
              />
            </div>
          </div>
        </div>

        {/* ══════ Diff Results (collapsible section) ══════ */}
        {diffData && !diffData.contentMatch && (
          <div className="border-t border-gray-100 dark:border-white/10 max-h-64 overflow-auto">
            {/* Toolbar */}
            <div className="flex items-center justify-between px-4 py-2 bg-gray-50 dark:bg-white/5 sticky top-0">
              <div className="flex items-center gap-3">
                <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
                  Diff Results
                </span>
                {stats && (
                  <div className="flex items-center gap-2 text-[10px]">
                    <span className="text-red-500 font-medium">
                      🔴 {stats.criticals} critical
                    </span>
                    <span className="text-yellow-500 font-medium">
                      🟡 {stats.minors} minor
                    </span>
                    <span className="text-green-500 font-medium">
                      🟢 {stats.ignored} ignored
                    </span>
                  </div>
                )}
              </div>
              <label className="flex items-center gap-1.5 text-[10px] text-gray-400 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showOnlyDiff}
                  onChange={(e) => setShowOnlyDiff(e.target.checked)}
                  className="rounded"
                />
                ⚡ Only differences
              </label>
            </div>

            {/* Diff lines */}
            <div className="divide-y divide-gray-50 dark:divide-white/5">
              {visibleRanges.map((range, idx) => {
                // Collapse identical (equal) ranges that are long
                if (
                  range.type === 'equal' &&
                  (range.count || range.value.length) > 100
                ) {
                  return (
                    <CollapsibleSection
                      key={idx}
                      text={range.value}
                      defaultOpen={false}
                    />
                  );
                }
                return <DiffLine key={idx} range={range} />;
              })}
            </div>

            {/* Number errors */}
            {diffData.numberErrors.length > 0 && (
              <div className="border-t border-gray-100 dark:border-white/10 px-4 py-3 space-y-2">
                <p className="text-[10px] font-semibold text-red-600 dark:text-red-400 uppercase tracking-wider">
                  🔢 Number Mismatches ({diffData.numberErrors.length})
                </p>
                {diffData.numberErrors.map((ne, idx) => (
                  <NumberErrorBadge
                    key={idx}
                    raw={ne.raw}
                    parsed={ne.parsed}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* ══════ Loading / Error states ══════ */}
        {loading && (
          <div className="border-t border-gray-100 dark:border-white/10 px-6 py-3">
            <div className="flex items-center gap-2 text-xs text-gray-400">
              <div className="h-3 w-3 animate-spin rounded-full border-2 border-gray-300 border-t-teal-500" />
              Computing dual-source diff...
            </div>
          </div>
        )}

        {error && (
          <div className="border-t border-gray-100 dark:border-white/10 px-6 py-3">
            <p className="text-xs text-red-500">{error}</p>
          </div>
        )}

        {!document.rawContent && (
          <div className="border-t border-gray-100 dark:border-white/10 px-6 py-3">
            <p className="text-xs text-gray-400">
              ⚪ Diff not available — document has no pdf-parse baseline
              (Markdown files only)
            </p>
          </div>
        )}

        {/* ══════ Footer: Quality Flags + Actions ══════ */}
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

          {/* WER indicator */}
          {stats && !diffData?.contentMatch && (
            <div className="mb-3">
              <p className="text-xs text-gray-500">
                Content mismatch detected —{' '}
                <span className="font-mono font-semibold">
                  WER {stats.wer}%
                </span>
                .{' '}
                {stats.wer < 10
                  ? 'Minor formatting differences only.'
                  : 'Please review the diff below and edit the right panel if needed.'}
              </p>
            </div>
          )}

          {diffData?.contentMatch && (
            <div className="mb-3">
              <p className="text-xs font-medium text-green-600 dark:text-green-400">
                ✅ Content fully matches — pdf-parse and Unstructured agree
              </p>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex items-center justify-end gap-2">
            {/* Save content button */}
            {editableContent.trim() !== document.content.trim() && (
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-1.5 rounded-xl bg-blue-500 px-4 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-600 disabled:opacity-50"
              >
                <Save size={12} />
                {saving ? 'Saving...' : saveSuccess ? '✅ Saved!' : 'Save Changes'}
              </button>
            )}

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
