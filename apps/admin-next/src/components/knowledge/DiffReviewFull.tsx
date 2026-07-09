'use client';

import React, { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import {
  ArrowLeft,
  Loader2,
  Save,
  Check,
  X,
  Pencil,
  ChevronRight,
  ChevronDown,
  AlertTriangle,
  Hash,
} from 'lucide-react';
import { knowledgeApi } from '@/api';
import type { KnowledgeDocument, DiffResponse, DiffRange } from '@/type/types';

// ═══════════════════════════════════════════════════════════════════════════════
// Color config — each severity gets a distinct visual treatment
// ═══════════════════════════════════════════════════════════════════════════════

const SEVERITY_STYLES: Record<
  string,
  { bg: string; text: string; border: string; tag: string; tagBg: string }
> = {
  critical: {
    bg: 'bg-red-50 dark:bg-red-950/30',
    text: 'text-red-800 dark:text-red-200',
    border: 'border-l-2 border-red-400 dark:border-red-600',
    tag: 'bg-red-500',
    tagBg: 'bg-red-100 dark:bg-red-900/40',
  },
  minor: {
    bg: 'bg-yellow-50 dark:bg-yellow-950/30',
    text: 'text-yellow-800 dark:text-yellow-200',
    border: 'border-l-2 border-yellow-400 dark:border-yellow-600',
    tag: 'bg-yellow-500',
    tagBg: 'bg-yellow-100 dark:bg-yellow-900/40',
  },
  ignore: {
    bg: 'bg-green-50 dark:bg-green-950/30',
    text: 'text-green-700 dark:text-green-300',
    border: 'border-l-2 border-green-300 dark:border-green-700',
    tag: 'bg-green-400',
    tagBg: 'bg-green-100 dark:bg-green-900/40',
  },
  equal: {
    bg: 'bg-transparent',
    text: 'text-gray-700 dark:text-gray-300',
    border: '',
    tag: 'bg-gray-300',
    tagBg: 'bg-transparent',
  },
};

const TYPE_LABELS: Record<string, string> = {
  added: '+ Added',
  removed: '− Missing',
  equal: '',
};

// ═══════════════════════════════════════════════════════════════════════════════
// DiffSegment — one atomic diff chunk, inline in the text
// ═══════════════════════════════════════════════════════════════════════════════

function DiffSegment({
  range,
  index,
  isEditing,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
}: {
  range: DiffRange;
  index: number;
  isEditing: boolean;
  onStartEdit: () => void;
  onSaveEdit: (newValue: string) => void;
  onCancelEdit: () => void;
}) {
  const [editValue, setEditValue] = useState(range.value);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Reset edit value when range changes
  useEffect(() => {
    setEditValue(range.value);
  }, [range.value]);

  // Auto-focus when entering edit mode
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  // Equal → plain inline text, no interaction
  if (range.type === 'equal') {
    return (
      <span className="text-gray-700 dark:text-gray-300 whitespace-pre-wrap break-words">
        {range.value}
      </span>
    );
  }

  const style = SEVERITY_STYLES[range.severity ?? 'minor'] ?? SEVERITY_STYLES.minor;

  // Editing mode → textarea
  if (isEditing) {
    return (
      <span className="inline-block align-top w-full my-1">
        <div className="flex items-center gap-1 mb-1">
          <span className={`text-[9px] font-bold uppercase tracking-wider ${style.text}`}>
            {TYPE_LABELS[range.type]} — Edit this segment
          </span>
          <span className="text-[9px] text-gray-400">({range.value.length} chars)</span>
        </div>
        <textarea
          ref={inputRef}
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          className="w-full resize-y rounded-lg border border-gray-200 bg-white p-2 font-mono text-xs leading-relaxed text-gray-800 outline-none ring-1 ring-inset ring-blue-200 focus:ring-2 focus:ring-blue-400 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:ring-blue-800 dark:focus:ring-blue-600"
          rows={Math.max(2, Math.ceil(editValue.length / 60))}
          spellCheck={false}
        />
        <div className="flex items-center gap-1.5 mt-1">
          <button
            onClick={() => onSaveEdit(editValue)}
            className="flex items-center gap-1 rounded-md bg-blue-500 px-2 py-0.5 text-[10px] font-medium text-white hover:bg-blue-600 transition-colors"
          >
            <Check size={10} />
            Confirm
          </button>
          <button
            onClick={onCancelEdit}
            className="flex items-center gap-1 rounded-md border border-gray-200 px-2 py-0.5 text-[10px] font-medium text-gray-500 hover:bg-gray-50 dark:border-white/10 dark:text-gray-400 dark:hover:bg-white/5 transition-colors"
          >
            <X size={10} />
            Cancel
          </button>
        </div>
      </span>
    );
  }

  // Display mode → colored clickable segment
  return (
    <span
      onClick={onStartEdit}
      className={`inline cursor-pointer rounded-sm px-0.5 py-0 transition-colors hover:shadow-sm ${style.bg}`}
      title={`${TYPE_LABELS[range.type]}${range.severity ? ` (${range.severity})` : ''} — Click to edit`}
    >
      {/* Severity dot indicator */}
      <span className={`inline-block w-1 h-3 rounded-full align-middle mr-0.5 ${style.tag}`} />
      <span
        className={`${style.text} border-b border-dashed ${
          range.type === 'removed'
            ? 'border-red-300 line-through decoration-red-400 decoration-1'
            : range.severity === 'critical'
              ? 'border-red-300'
              : range.severity === 'minor'
                ? 'border-yellow-300'
                : 'border-green-300'
        }`}
      >
        {range.value}
      </span>
      <Pencil
        size={10}
        className="inline-block ml-0.5 -mt-0.5 opacity-30 group-hover:opacity-100 transition-opacity"
      />
    </span>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// NumberErrorMarker — inline annotation for number mismatches
// ═══════════════════════════════════════════════════════════════════════════════

function NumberErrorMarker({
  error,
  index,
  onFix,
}: {
  error: { raw: string; parsed: string; index: number };
  index: number;
  onFix?: (idx: number, correctValue: string) => void;
}) {
  const [showFix, setShowFix] = useState(false);
  const [fixValue, setFixValue] = useState(error.raw);

  return (
    <span className="inline-flex items-center gap-1 align-middle mx-0.5">
      <span
        onClick={() => setShowFix(!showFix)}
        className="inline-flex items-center gap-1 rounded-md bg-red-50 border border-red-200 px-1.5 py-0.5 cursor-pointer hover:bg-red-100 transition-colors dark:bg-red-950/30 dark:border-red-800 dark:hover:bg-red-900/30"
        title="Number mismatch — click to fix"
      >
        <Hash size={10} className="text-red-400" />
        <span className="text-[10px] font-mono text-red-500 line-through">
          {error.parsed ?? '∅'}
        </span>
        <span className="text-[9px] text-red-300">→</span>
        <span className="text-[10px] font-mono font-semibold text-green-600 dark:text-green-400">
          {error.raw}
        </span>
      </span>
      {showFix && onFix && (
        <span className="inline-flex items-center gap-1">
          <input
            value={fixValue}
            onChange={(e) => setFixValue(e.target.value)}
            className="w-20 rounded border border-blue-200 px-1 py-0.5 text-[10px] font-mono outline-none ring-1 ring-blue-200 dark:border-blue-800 dark:bg-gray-800 dark:ring-blue-800"
          />
          <button
            onClick={() => {
              onFix(index, fixValue);
              setShowFix(false);
            }}
            className="rounded bg-blue-500 px-1.5 py-0.5 text-[9px] font-medium text-white hover:bg-blue-600"
          >
            Fix
          </button>
        </span>
      )}
    </span>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// DiffSidebar — mini scrollbar showing diff density overview
// ═══════════════════════════════════════════════════════════════════════════════

function DiffSidebar({
  diffRanges,
  onSegmentClick,
}: {
  diffRanges: DiffRange[];
  onSegmentClick: (index: number) => void;
}) {
  // Create a compact visual overview: each row = ~10 chars
  const blocks = useMemo(() => {
    const result: { type: string; severity?: string; idx: number }[] = [];
    let cursor = 0;
    for (let i = 0; i < diffRanges.length; i++) {
      const r = diffRanges[i];
      const len = Math.max(1, Math.ceil((r.value.length || 1) / 15));
      for (let j = 0; j < len; j++) {
        result.push({ type: r.type, severity: r.severity, idx: i });
      }
      cursor += len;
    }
    return result;
  }, [diffRanges]);

  return (
    <div className="flex flex-col gap-[1px] py-1">
      {blocks.map((b, i) => (
        <div
          key={i}
          onClick={() => onSegmentClick(b.idx)}
          className={`h-[3px] w-full rounded-sm cursor-pointer hover:scale-y-150 transition-transform ${
            b.type === 'equal'
              ? 'bg-gray-100 dark:bg-white/5'
              : b.severity === 'critical'
                ? 'bg-red-400 dark:bg-red-600'
                : b.severity === 'minor'
                  ? 'bg-yellow-400 dark:bg-yellow-600'
                  : 'bg-green-400 dark:bg-green-600'
          }`}
          title={`Segment ${b.idx + 1}: ${b.type}${b.severity ? ` (${b.severity})` : ''}`}
        />
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SyncScrollContainer — two panes with synchronized scrolling
// ═══════════════════════════════════════════════════════════════════════════════

function SyncScrollContainer({
  left,
  right,
  leftHeader,
  rightHeader,
  diffRanges,
  onSegmentClick,
  numberErrors,
  onNumberFix,
  editingIndex,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
}: {
  left: React.ReactNode;
  right: React.ReactNode;
  leftHeader: React.ReactNode;
  rightHeader: React.ReactNode;
  diffRanges: DiffRange[];
  onSegmentClick: (index: number) => void;
  numberErrors: { raw: string; parsed: string; index: number }[];
  onNumberFix?: (idx: number, value: string) => void;
  editingIndex: number | null;
  onStartEdit: (idx: number) => void;
  onSaveEdit: (idx: number, value: string) => void;
  onCancelEdit: () => void;
}) {
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const isSyncing = useRef(false);

  const syncScroll = useCallback((source: HTMLDivElement, target: HTMLDivElement) => {
    if (isSyncing.current) return;
    isSyncing.current = true;
    const ratio = source.scrollTop / (source.scrollHeight - source.clientHeight);
    target.scrollTop = ratio * (target.scrollHeight - target.clientHeight);
    requestAnimationFrame(() => {
      isSyncing.current = false;
    });
  }, []);

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Diff overview sidebar (left edge) */}
      <div
        ref={sidebarRef}
        className="w-6 shrink-0 border-r border-gray-100 overflow-hidden bg-gray-50/50 dark:border-white/5 dark:bg-white/[0.02]"
      >
        <DiffSidebar diffRanges={diffRanges} onSegmentClick={onSegmentClick} />
      </div>

      {/* Left pane — baseline */}
      <div className="flex w-1/2 flex-col border-r border-gray-100 dark:border-white/10">
        <div className="shrink-0 border-b border-gray-50 px-4 py-2 dark:border-white/5">
          {leftHeader}
        </div>
        <div
          ref={leftRef}
          onScroll={() => leftRef.current && rightRef.current && syncScroll(leftRef.current, rightRef.current)}
          className="flex-1 overflow-auto p-4 scroll-smooth"
        >
          {left}
        </div>
      </div>

      {/* Right pane — parsed with inline diff */}
      <div className="flex w-1/2 flex-col">
        <div className="shrink-0 border-b border-gray-50 px-4 py-2 dark:border-white/5">
          {rightHeader}
        </div>
        <div
          ref={rightRef}
          onScroll={() => rightRef.current && leftRef.current && syncScroll(rightRef.current, leftRef.current)}
          className="flex-1 overflow-auto p-4 scroll-smooth"
        >
          {right}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// NumberErrorsPanel — collapsible section listing all number mismatches
// ═══════════════════════════════════════════════════════════════════════════════

function NumberErrorsPanel({
  errors,
  onFix,
}: {
  errors: { raw: string; parsed: string; index: number }[];
  onFix?: (idx: number, value: string) => void;
}) {
  const [open, setOpen] = useState(false);

  if (errors.length === 0) return null;

  return (
    <div className="border-t border-gray-100 dark:border-white/10">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 px-4 py-2 text-[10px] font-medium text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors bg-gray-50/50 dark:bg-white/[0.02]"
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <Hash size={11} className="text-purple-400" />
        <span>{errors.length} Number Mismatch{errors.length !== 1 ? 'es' : ''}</span>
        <span className="text-gray-300 dark:text-gray-600">·</span>
        <span className="text-gray-400">Click to review</span>
      </button>
      {open && (
        <div className="px-4 py-3 space-y-2 max-h-48 overflow-auto">
          {errors.map((err, i) => (
            <NumberErrorInline key={i} error={err} index={i} onFix={onFix} />
          ))}
        </div>
      )}
    </div>
  );
}

function NumberErrorInline({
  error,
  index,
  onFix,
}: {
  error: { raw: string; parsed: string; index: number };
  index: number;
  onFix?: (idx: number, value: string) => void;
}) {
  const [fixing, setFixing] = useState(false);
  const [fixValue, setFixValue] = useState(error.raw);

  return (
    <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50/50 px-3 py-2 dark:border-red-800 dark:bg-red-950/20">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 text-[11px]">
          <span className="font-mono text-red-600 dark:text-red-400 line-through">
            {error.parsed ?? '(empty)'}
          </span>
          <span className="text-red-300">→</span>
          <span className="font-mono font-semibold text-green-700 dark:text-green-300">
            {error.raw}
          </span>
        </div>
      </div>
      {!fixing ? (
        <button
          onClick={() => setFixing(true)}
          className="shrink-0 rounded-md border border-gray-200 px-2 py-0.5 text-[9px] font-medium text-gray-500 hover:bg-gray-100 dark:border-white/10 dark:text-gray-400 dark:hover:bg-white/5"
        >
          Fix
        </button>
      ) : (
        <span className="flex items-center gap-1 shrink-0">
          <input
            value={fixValue}
            onChange={(e) => setFixValue(e.target.value)}
            className="w-20 rounded border border-blue-200 px-1.5 py-0.5 text-[10px] font-mono outline-none dark:border-blue-800 dark:bg-gray-800"
            autoFocus
          />
          <button
            onClick={() => {
              onFix?.(index, fixValue);
              setFixing(false);
            }}
            className="rounded bg-blue-500 px-1.5 py-0.5 text-[9px] font-medium text-white hover:bg-blue-600"
          >
            ✓
          </button>
          <button
            onClick={() => setFixing(false)}
            className="rounded border border-gray-200 px-1.5 py-0.5 text-[9px] font-medium text-gray-500 hover:bg-gray-100 dark:border-white/10 dark:hover:bg-white/5"
          >
            ✗
          </button>
        </span>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// QualityFlagsBanner — shows heuristic quality flags at top
// ═══════════════════════════════════════════════════════════════════════════════

function QualityFlagsBanner({ flags }: { flags: string[] }) {
  if (flags.length === 0) return null;

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
    <div className="flex items-center gap-3 px-6 py-2 bg-red-50/50 border-b border-red-100 dark:bg-red-950/20 dark:border-red-900/30">
      <AlertTriangle size={14} className="text-red-500 shrink-0" />
      <div className="flex items-center gap-3 text-[11px]">
        {flags.map((flag) => (
          <span key={flag} className="flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-red-400 shrink-0" />
            <span className="font-medium text-red-700 dark:text-red-300">
              {flagLabels[flag]?.label ?? flag}
            </span>
            <span className="text-red-400 hidden sm:inline">
              — {flagLabels[flag]?.description}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Main: DiffReviewFull — replaces QualityReviewPanelFull
// ═══════════════════════════════════════════════════════════════════════════════

export function DiffReviewFull({ document }: { document: KnowledgeDocument }) {
  const [diffData, setDiffData] = useState<DiffResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editableSegments, setEditableSegments] = useState<DiffRange[] | null>(null);
  const [showOnlyDiff, setShowOnlyDiff] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // ── Load diff data ──────────────────────────────────────────────────────

  useEffect(() => {
    if (!document.rawContent) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    knowledgeApi
      .getDiff(document.id)
      .then((data) => {
        if (!cancelled) {
          setDiffData(data);
          setEditableSegments(data.diffRanges);
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

  // ── Visible ranges (filter by diff-only toggle) ─────────────────────────

  const visibleRanges = useMemo(() => {
    const source = editableSegments ?? diffData?.diffRanges ?? [];
    if (showOnlyDiff) {
      return source.filter((r) => r.type !== 'equal');
    }
    return source;
  }, [diffData, editableSegments, showOnlyDiff]);

  // ── Stats ───────────────────────────────────────────────────────────────

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

  // ── Flags ───────────────────────────────────────────────────────────────

  const flags = useMemo(() => {
    if (!document.qualityFlags) return [];
    return document.qualityFlags.split(',').map((f) => f.trim()).filter(Boolean);
  }, [document.qualityFlags]);

  // ── Reconstruct full content from segments ──────────────────────────────
  //
  // diffWords(A, B) 的输出结构：
  //   equal  + added  = B (Unstructured content)
  //   equal  + removed = A (pdf-parse rawContent)
  //
  // 保存时要排除 'removed' 段，因为它们的内容来自 pdf-parse 而不是 Unstructured。
  // 用户编辑过的段 type 变为 'equal'，会被正确包含。

  const fullContent = useMemo(() => {
    const segments = editableSegments ?? diffData?.diffRanges;
    if (!segments) return document.content;
    // 只拼接 equal + added（B 的内容），排除 removed（A 的内容）
    return segments
      .filter((s) => s.type !== 'removed')
      .map((s) => s.value)
      .join('');
  }, [editableSegments, diffData, document.content]);

  // ── Handle segment edit ─────────────────────────────────────────────────
  //
  // 用户编辑一个 diff 段后，把 type 改成 'equal' 让红色/黄色消失。
  // 编辑后的段会被包含在保存内容中。

  const handleStartEdit = useCallback((idx: number) => {
    setEditingIndex(idx);
  }, []);

  const handleSaveEdit = useCallback((idx: number, newValue: string) => {
    setEditableSegments((prev) => {
      if (!prev) return prev;
      const updated = [...prev];
      updated[idx] = {
        ...updated[idx],
        value: newValue,
        type: 'equal',       // ← 标记为已修复，红色会消失
        severity: 'ignore',  // ← 不再计入 diff 统计
      };
      return updated;
    });
    setEditingIndex(null);
  }, []);

  const handleCancelEdit = useCallback(() => {
    setEditingIndex(null);
  }, []);

  // ── Handle number fix ───────────────────────────────────────────────────

  const handleNumberFix = useCallback(
    (errorIdx: number, correctValue: string) => {
      // Find the position in the parsed content where this number occurs
      const error = diffData?.numberErrors[errorIdx];
      if (!error || !diffData) return;

      // Replace the number in the full content at the approximate position
      // We search for the parsed value in the content and replace it
      setEditableSegments((prev) => {
        if (!prev) return prev;
        const content = prev.map((s) => s.value).join('');
        const parsedNum = error.parsed ?? '';
        if (!parsedNum) return prev;

        const idx = content.indexOf(parsedNum);
        if (idx === -1) return prev;

        // Find which segment contains this position
        let cursor = 0;
        for (let i = 0; i < prev.length; i++) {
          const seg = prev[i];
          const segEnd = cursor + seg.value.length;
          if (cursor <= idx && idx < segEnd) {
            // Found the segment — replace the number
            const updated = [...prev];
            const localIdx = idx - cursor;
            const before = seg.value.slice(0, localIdx);
            const after = seg.value.slice(localIdx + parsedNum.length);
            updated[i] = {
              ...seg,
              value: before + correctValue + after,
            };
            return updated;
          }
          cursor = segEnd;
        }
        return prev;
      });
    },
    [diffData],
  );

  // ── Save all changes ────────────────────────────────────────────────────

  const handleSaveAll = useCallback(async () => {
    if (fullContent.trim() === document.content.trim()) return;

    setSaving(true);
    setSaveSuccess(false);
    try {
      await knowledgeApi.updateContent(document.id, fullContent);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save content');
    } finally {
      setSaving(false);
    }
  }, [document.id, document.content, fullContent]);

  // ── Has unsaved changes? ────────────────────────────────────────────────

  const hasChanges = fullContent.trim() !== document.content.trim();

  // ═════════════════════════════════════════════════════════════════════════
  // Render
  // ═════════════════════════════════════════════════════════════════════════

  return (
    <div className="flex h-full flex-col">
      {/* ════════ Header ════════ */}
      <div className="flex items-center gap-3 border-b border-gray-100 px-6 py-3 dark:border-white/10">
        <div className="flex items-center gap-2 min-w-0">
          <h1 className="truncate text-base font-semibold text-gray-900 dark:text-white">
            Quality Review
          </h1>
          <span className="text-sm text-gray-400">·</span>
          <p className="truncate text-sm text-gray-500">{document.title}</p>
        </div>
      </div>

      {/* ════════ Stats Bar ════════ */}
      {diffData && (
        <div className="flex items-center gap-4 border-b border-gray-100 px-6 py-2 text-xs dark:border-white/10 bg-gray-50/50 dark:bg-white/[0.02]">
          {/* WER */}
          <span className="font-medium text-gray-500">
            Similarity:{' '}
            <span className="font-semibold text-gray-700 dark:text-gray-300">
              {(100 - (diffData.wer ?? 0)).toFixed(1)}%
            </span>
          </span>

          {/* Diff counts */}
          <span className="flex items-center gap-1 text-red-500">
            <span className="h-2 w-2 rounded-full bg-red-500" />
            {stats?.criticals ?? 0} critical
          </span>
          <span className="flex items-center gap-1 text-yellow-500">
            <span className="h-2 w-2 rounded-full bg-yellow-500" />
            {stats?.minors ?? 0} minor
          </span>
          <span className="flex items-center gap-1 text-green-500">
            <span className="h-2 w-2 rounded-full bg-green-500" />
            {stats?.ignored ?? 0} ignored
          </span>

          {/* Number errors */}
          {diffData.numberErrors.length > 0 && (
            <span className="flex items-center gap-1 text-purple-500">
              <Hash size={12} />
              {diffData.numberErrors.length} numbers
            </span>
          )}

          {/* Spacer */}
          <div className="ml-auto flex items-center gap-2">
            {/* Only diffs toggle */}
            <label className="flex items-center gap-1.5 text-[10px] text-gray-400 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={showOnlyDiff}
                onChange={(e) => setShowOnlyDiff(e.target.checked)}
                className="rounded"
              />
              ⚡ Only diffs
            </label>

            {/* Save button */}
            {hasChanges && (
              <button
                onClick={handleSaveAll}
                disabled={saving}
                className="flex items-center gap-1 rounded-lg bg-blue-500 px-3 py-1 text-[11px] font-medium text-white transition-colors hover:bg-blue-600 disabled:opacity-50"
              >
                <Save size={12} />
                {saving ? 'Saving...' : saveSuccess ? '✅ Saved!' : 'Save Changes'}
              </button>
            )}

            {/* Char count */}
            <span className="text-[10px] text-gray-300 font-mono">
              {fullContent.length} chars
            </span>
          </div>
        </div>
      )}

      {/* ════════ Quality Flags Banner ════════ */}
      <QualityFlagsBanner flags={flags} />

      {/* ════════ Main Content Area ════════ */}

      {/* Loading state */}
      {loading && (
        <div className="flex flex-1 items-center justify-center text-gray-400">
          <Loader2 size={16} className="mr-2 animate-spin" />
          Computing dual-source diff...
        </div>
      )}

      {/* Error state */}
      {error && (
        <div className="flex flex-1 items-center justify-center text-red-500 text-sm">
          {error}
        </div>
      )}

      {/* No rawContent (Markdown files) */}
      {!loading && !diffData && !document.rawContent && (
        <div className="flex flex-1 items-center justify-center text-gray-400 text-sm">
          ⚪ Diff not available — document has no pdf-parse baseline (Markdown files only)
        </div>
      )}

      {/* Content match (identical) */}
      {!loading && diffData?.contentMatch && (
        <div className="flex flex-1 items-center justify-center text-green-500 text-sm">
          <Check size={16} className="mr-2" />
          Content fully matches — pdf-parse and Unstructured agree
        </div>
      )}

      {/* Dual-pane with inline diff */}
      {!loading && diffData && !diffData.contentMatch && (
        <SyncScrollContainer
          left={
            <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-gray-700 dark:text-gray-300">
              {document.rawContent}
            </pre>
          }
          right={
            <div className="leading-relaxed text-xs">
              {visibleRanges.map((range, idx) => (
                <DiffSegment
                  key={`seg-${idx}`}
                  range={range}
                  index={idx}
                  isEditing={editingIndex === idx}
                  onStartEdit={() => handleStartEdit(idx)}
                  onSaveEdit={(val) => handleSaveEdit(idx, val)}
                  onCancelEdit={handleCancelEdit}
                />
              ))}
              {/* Show a small indicator when no ranges visible (only diffs filter) */}
              {visibleRanges.length === 0 && (
                <p className="text-gray-400 text-[11px] italic mt-4">
                  No differences found with current filter.
                </p>
              )}
            </div>
          }
          leftHeader={
            <span className="text-xs font-medium text-gray-400">
              📄 pdf-parse <span className="text-gray-300">(Baseline)</span>
            </span>
          }
          rightHeader={
            <span className="text-xs font-medium text-gray-400">
              ✏️ Unstructured{' '}
              <span className="text-gray-300">(AI Parsed)</span>
              <span className="ml-2 text-[10px] text-gray-300">
                — click colored text to edit
              </span>
            </span>
          }
          diffRanges={diffData.diffRanges}
          onSegmentClick={handleStartEdit}
          numberErrors={diffData.numberErrors}
          onNumberFix={handleNumberFix}
          editingIndex={editingIndex}
          onStartEdit={handleStartEdit}
          onSaveEdit={handleSaveEdit}
          onCancelEdit={handleCancelEdit}
        />
      )}

      {/* ════════ Number Errors Panel (bottom) ════════ */}
      {diffData && !diffData.contentMatch && diffData.numberErrors.length > 0 && (
        <NumberErrorsPanel errors={diffData.numberErrors} onFix={handleNumberFix} />
      )}
    </div>
  );
}
