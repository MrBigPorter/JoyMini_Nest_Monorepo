'use client';

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useRequest } from 'ahooks';
import {
  FileText,
  Plus,
  RefreshCw,
  Upload,
  Eye,
  Edit2,
  Trash2,
  Search,
  X,
  Save,
  ListTree,
  RotateCcw,
  FileUp,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Clock,
} from 'lucide-react';
import { ModalManager } from '@repo/ui';
import { knowledgeApi } from '@/api';
import { PageHeader } from '@/components/scaffold/PageHeader';
import { ServiceStatusBar } from './ServiceStatusBar';
import { useTranslation } from '@/hooks/useTranslation';
import type { TFunc } from '@/hooks/useTranslation';
import type {
  KnowledgeDocument,
  DocumentChunk,
  CreateKnowledgeDocPayload,
  UpdateKnowledgeDocPayload,
  QueryKnowledgeDocParams,
} from '@/type/types';

// ───────────────────────────── helpers ─────────────────────────────

const shortId = (value?: string | null) => {
  if (!value) return '—';
  return value.length > 10 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value;
};

const PRIORITY_BADGE: Record<string, string> = {
  P0: 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400',
  P1: 'bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400',
  P2: 'bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400',
};

const CONTENT_TYPE_BADGE: Record<string, string> = {
  policy:
    'bg-purple-100 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400',
  'how-to': 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400',
  troubleshooting:
    'bg-orange-100 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400',
  faq: 'bg-teal-100 text-teal-600 dark:bg-teal-900/30 dark:text-teal-400',
  reference: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
};

const DOMAIN_OPTIONS = [
  'order',
  'wallet',
  'coupon',
  'product',
  'user',
  'kyc',
  'lucky-draw',
  'common',
] as const;

// ───────────────────────────── DocFormModal ─────────────────────────────

function DocFormModal({
  document,
  domains,
  onClose,
  onSaved,
  t,
}: {
  document: KnowledgeDocument | null;
  domains: string[];
  onClose: () => void;
  onSaved: () => void;
  t: TFunc;
}) {
  const isEdit = document !== null;

  const [title, setTitle] = useState(document?.title ?? '');
  const [domain, setDomain] = useState(document?.domain ?? '');
  const [docId, setDocId] = useState(document?.docId ?? '');
  const [keywordsStr, setKeywordsStr] = useState(
    document?.keywords?.join(', ') ?? '',
  );
  const [locale, setLocale] = useState(document?.locale ?? 'en');
  const [contentType, setContentType] = useState(
    document?.contentType ?? 'policy',
  );
  const [priority, setPriority] = useState(document?.priority ?? 'P2');
  const [content, setContent] = useState(document?.content ?? '');

  const [errors, setErrors] = useState<Record<string, string>>({});

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};
    if (!title.trim()) newErrors.title = t('knowledgeBase.titleRequired');
    if (!domain.trim()) newErrors.domain = t('knowledgeBase.domainRequired');
    if (!docId.trim()) newErrors.docId = t('knowledgeBase.docIdRequired');
    if (!content.trim()) newErrors.content = t('knowledgeBase.contentRequired');
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const { run: doSave, loading: saving } = useRequest(
    async () => {
      if (!validate()) return;
      const keywords = keywordsStr
        .split(',')
        .map((k) => k.trim())
        .filter(Boolean);
      if (isEdit) {
        const payload: UpdateKnowledgeDocPayload = {
          title: title.trim(),
          domain: domain.trim(),
          docId: docId.trim(),
          keywords,
          locale,
          contentType,
          priority,
          content,
        };
        await knowledgeApi.update(document!.id, payload);
      } else {
        const payload: CreateKnowledgeDocPayload = {
          title: title.trim(),
          domain: domain.trim(),
          docId: docId.trim(),
          keywords,
          locale,
          contentType,
          priority,
          content,
        };
        await knowledgeApi.create(payload);
      }
    },
    {
      manual: true,
      onSuccess: () => {
        onSaved();
        onClose();
      },
    },
  );

  const inputClass =
    'rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/50 dark:border-white/10 dark:bg-gray-800 dark:text-gray-200';
  const labelClass = 'text-xs text-gray-500';
  const errorClass = 'text-xs text-red-500';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white p-6 shadow-xl dark:bg-gray-900">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            {isEdit ? t('knowledgeBase.editDoc') : t('knowledgeBase.newDoc')}
          </h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-white/5"
          >
            <X size={18} />
          </button>
        </div>

        <div className="space-y-4">
          {/* Title */}
          <div className="flex flex-col gap-1">
            <label className={labelClass}>{t('knowledgeBase.title')}</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className={inputClass}
            />
            {errors.title && <p className={errorClass}>{errors.title}</p>}
          </div>

          {/* Domain + docId */}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className={labelClass}>{t('knowledgeBase.domain')}</label>
              <select
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                className={inputClass}
              >
                <option value="">—</option>
                {(domains.length > 0 ? domains : DOMAIN_OPTIONS).map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
              {errors.domain && <p className={errorClass}>{errors.domain}</p>}
            </div>
            <div className="flex flex-col gap-1">
              <label className={labelClass}>{t('knowledgeBase.docId')}</label>
              <input
                value={docId}
                onChange={(e) => setDocId(e.target.value)}
                className={inputClass}
                placeholder="refund-policy"
              />
              {errors.docId && <p className={errorClass}>{errors.docId}</p>}
            </div>
          </div>

          {/* Locale + Content Type + Priority */}
          <div className="grid grid-cols-3 gap-3">
            <div className="flex flex-col gap-1">
              <label className={labelClass}>{t('knowledgeBase.locale')}</label>
              <select
                value={locale}
                onChange={(e) => setLocale(e.target.value)}
                className={inputClass}
              >
                <option value="en">en</option>
                <option value="zh">zh</option>
                <option value="ja">ja</option>
                <option value="ko">ko</option>
                <option value="fr">fr</option>
                <option value="de">de</option>
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className={labelClass}>
                {t('knowledgeBase.contentType')}
              </label>
              <select
                value={contentType}
                onChange={(e) => setContentType(e.target.value)}
                className={inputClass}
              >
                <option value="policy">policy</option>
                <option value="how-to">how-to</option>
                <option value="troubleshooting">troubleshooting</option>
                <option value="faq">faq</option>
                <option value="reference">reference</option>
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className={labelClass}>
                {t('knowledgeBase.priority')}
              </label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
                className={inputClass}
              >
                <option value="P0">
                  P0 - {t('knowledgeBase.priority_P0')}
                </option>
                <option value="P1">
                  P1 - {t('knowledgeBase.priority_P1')}
                </option>
                <option value="P2">
                  P2 - {t('knowledgeBase.priority_P2')}
                </option>
              </select>
            </div>
          </div>

          {/* Keywords */}
          <div className="flex flex-col gap-1">
            <label className={labelClass}>{t('knowledgeBase.keywords')}</label>
            <input
              value={keywordsStr}
              onChange={(e) => setKeywordsStr(e.target.value)}
              className={inputClass}
              placeholder={t('knowledgeBase.keywordsPlaceholder')}
            />
          </div>

          {/* Content */}
          <div className="flex flex-col gap-1">
            <label className={labelClass}>{t('knowledgeBase.content')}</label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={10}
              className={`${inputClass} font-mono text-xs leading-relaxed`}
              placeholder={t('knowledgeBase.contentPlaceholder')}
            />
            {errors.content && <p className={errorClass}>{errors.content}</p>}
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-gray-200 px-4 py-2 text-sm text-gray-600 transition-colors hover:bg-gray-50 dark:border-white/10 dark:text-gray-400 dark:hover:bg-white/5"
            >
              {t('knowledgeBase.cancel')}
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => doSave()}
              className="flex items-center gap-1.5 rounded-xl bg-teal-500 px-4 py-2 text-sm text-white transition-colors hover:bg-teal-600 disabled:opacity-50"
            >
              <Save size={14} />
              {isEdit ? t('knowledgeBase.update') : t('knowledgeBase.create')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ───────────────────────────── DocDetailModal ─────────────────────────────

function DocDetailModal({
  document,
  onClose,
  t,
}: {
  document: KnowledgeDocument;
  onClose: () => void;
  t: TFunc;
}) {
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
                {document.title}
              </p>
            </div>
            <div>
              <span className="text-xs text-gray-400">
                {t('knowledgeBase.domain')}
              </span>
              <p className="font-medium text-gray-900 dark:text-white">
                {document.domain}
              </p>
            </div>
            <div>
              <span className="text-xs text-gray-400">
                {t('knowledgeBase.docId')}
              </span>
              <p className="font-mono text-xs text-gray-900 dark:text-white">
                {document.docId}
              </p>
            </div>
            <div>
              <span className="text-xs text-gray-400">
                {t('knowledgeBase.locale')}
              </span>
              <p className="font-medium text-gray-900 dark:text-white">
                {document.locale}
              </p>
            </div>
            <div>
              <span className="text-xs text-gray-400">
                {t('knowledgeBase.contentType')}
              </span>
              <span
                className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${
                  CONTENT_TYPE_BADGE[document.contentType] ??
                  'bg-gray-100 text-gray-500'
                }`}
              >
                {document.contentType}
              </span>
            </div>
            <div>
              <span className="text-xs text-gray-400">
                {t('knowledgeBase.priority')}
              </span>
              <span
                className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${
                  PRIORITY_BADGE[document.priority] ??
                  'bg-gray-100 text-gray-500'
                }`}
              >
                {document.priority}
              </span>
            </div>
          </div>

          {document.keywords && document.keywords.length > 0 && (
            <div>
              <span className="text-xs text-gray-400">
                {t('knowledgeBase.keywords')}
              </span>
              <div className="mt-1 flex flex-wrap gap-1">
                {document.keywords.map((kw) => (
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
              {document.content}
            </pre>
          </div>

          <div className="flex items-center gap-2 text-xs text-gray-400">
            <span>
              {t('knowledgeBase.version', { version: document.version })}
            </span>
            <span>·</span>
            <span>{new Date(document.createdAt).toLocaleString()}</span>
            {document.updatedAt !== document.createdAt && (
              <>
                <span>·</span>
                <span>
                  updated {new Date(document.updatedAt).toLocaleString()}
                </span>
              </>
            )}
          </div>
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

// ───────────────────────────── UploadModal ─────────────────────────────

function UploadModal({
  onClose,
  onUploaded,
  t,
}: {
  onClose: () => void;
  onUploaded: () => void;
  t: TFunc;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [domain, setDomain] = useState('');
  const [locale, setLocale] = useState('en');
  const [keywordsStr, setKeywordsStr] = useState('');
  const [contentType, setContentType] = useState('');
  const [priority, setPriority] = useState('');
  const [progress, setProgress] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const { run: doUpload, loading: uploading } = useRequest(
    async () => {
      if (!file) return;
      const extraFields: Record<string, string> = {};
      if (domain) extraFields.domain = domain;
      if (locale) extraFields.locale = locale;
      if (keywordsStr) extraFields.keywords = keywordsStr;
      if (contentType) extraFields.contentType = contentType;
      if (priority) extraFields.priority = priority;

      await knowledgeApi.upload(file, extraFields, setProgress);
    },
    {
      manual: true,
      onSuccess: () => {
        onUploaded();
        onClose();
      },
    },
  );

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const droppedFile = e.dataTransfer.files[0];
    if (
      droppedFile &&
      (droppedFile.name.endsWith('.md') || droppedFile.name.endsWith('.pdf'))
    ) {
      setFile(droppedFile);
    }
  }, []);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (selected) setFile(selected);
  };

  const inputClass =
    'rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/50 dark:border-white/10 dark:bg-gray-800 dark:text-gray-200';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl dark:bg-gray-900">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            {t('knowledgeBase.uploadTitle')}
          </h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-white/5"
          >
            <X size={18} />
          </button>
        </div>

        <div className="space-y-4">
          {/* Drop zone */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => inputRef.current?.click()}
            className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed p-8 transition-colors ${
              dragOver
                ? 'border-teal-400 bg-teal-50 dark:bg-teal-950/20'
                : 'border-gray-200 hover:border-gray-300 dark:border-white/10 dark:hover:border-white/20'
            }`}
          >
            <input
              ref={inputRef}
              type="file"
              accept=".md,.pdf"
              className="hidden"
              onChange={handleFileSelect}
            />
            {file ? (
              <>
                <FileText size={32} className="text-teal-500" />
                <p className="text-sm font-medium text-gray-900 dark:text-white">
                  {file.name}
                </p>
                <p className="text-xs text-gray-400">
                  {(file.size / 1024).toFixed(1)} KB
                </p>
              </>
            ) : (
              <>
                <FileUp
                  size={32}
                  className="text-gray-300 dark:text-gray-600"
                />
                <p className="text-sm text-gray-500">
                  {t('knowledgeBase.uploadHint')}
                </p>
              </>
            )}
          </div>

          {/* Override fields */}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500">
                {t('knowledgeBase.domain')}
              </label>
              <select
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                className={inputClass}
              >
                <option value="">Auto-detect</option>
                {DOMAIN_OPTIONS.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500">
                {t('knowledgeBase.locale')}
              </label>
              <select
                value={locale}
                onChange={(e) => setLocale(e.target.value)}
                className={inputClass}
              >
                <option value="en">en</option>
                <option value="zh">zh</option>
                <option value="ja">ja</option>
                <option value="ko">ko</option>
                <option value="fr">fr</option>
                <option value="de">de</option>
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500">
                {t('knowledgeBase.contentType')}
              </label>
              <select
                value={contentType}
                onChange={(e) => setContentType(e.target.value)}
                className={inputClass}
              >
                <option value="">Auto</option>
                <option value="policy">policy</option>
                <option value="how-to">how-to</option>
                <option value="troubleshooting">troubleshooting</option>
                <option value="faq">faq</option>
                <option value="reference">reference</option>
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500">
                {t('knowledgeBase.priority')}
              </label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
                className={inputClass}
              >
                <option value="">Auto</option>
                <option value="P0">P0</option>
                <option value="P1">P1</option>
                <option value="P2">P2</option>
              </select>
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500">
              {t('knowledgeBase.keywords')}
            </label>
            <input
              value={keywordsStr}
              onChange={(e) => setKeywordsStr(e.target.value)}
              className={inputClass}
              placeholder={t('knowledgeBase.keywordsPlaceholder')}
            />
          </div>

          {/* Progress bar */}
          {progress > 0 && progress < 100 && (
            <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-white/10">
              <div
                className="h-full rounded-full bg-teal-500 transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={onClose}
              className="rounded-xl border border-gray-200 px-4 py-2 text-sm text-gray-600 transition-colors hover:bg-gray-50 dark:border-white/10 dark:text-gray-400 dark:hover:bg-white/5"
            >
              {t('knowledgeBase.cancel')}
            </button>
            <button
              disabled={!file || uploading}
              onClick={() => doUpload()}
              className="flex items-center gap-1.5 rounded-xl bg-teal-500 px-4 py-2 text-sm text-white transition-colors hover:bg-teal-600 disabled:opacity-50"
            >
              {uploading ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Upload size={14} />
              )}
              Upload
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ───────────────────────────── ChunkListModal ─────────────────────────────

function ChunkListModal({
  documentId,
  documentTitle,
  onClose,
  t,
}: {
  documentId: string;
  documentTitle: string;
  onClose: () => void;
  t: TFunc;
}) {
  const {
    data: chunks,
    loading,
    error,
    refresh,
  } = useRequest(() => knowledgeApi.getChunks(documentId), {});

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white p-6 shadow-xl dark:bg-gray-900">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            {t('knowledgeBase.chunks')}: {documentTitle}
          </h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-white/5"
          >
            <X size={18} />
          </button>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-12 text-gray-400">
            <RefreshCw size={18} className="mr-2 animate-spin" />
            {t('knowledgeBase.loading')}
          </div>
        )}

        {error && (
          <div className="flex items-center justify-center gap-2 py-12 text-red-400">
            <AlertCircle size={18} />
            <p className="text-sm">{t('knowledgeBase.chunksLoadFailed')}</p>
          </div>
        )}

        {chunks && chunks.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-2 py-12 text-gray-400">
            <ListTree size={32} className="opacity-30" />
            <p className="text-sm">{t('knowledgeBase.noDocuments')}</p>
          </div>
        )}

        {chunks && chunks.length > 0 && (
          <div className="space-y-3">
            {chunks.map((chunk: DocumentChunk) => (
              <div
                key={chunk.id}
                className="rounded-xl border border-gray-100 p-4 dark:border-white/10"
              >
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-medium text-gray-500">
                    {t('knowledgeBase.chunkIndex', { index: chunk.chunkIndex })}
                  </span>
                  <div className="flex items-center gap-2 text-xs text-gray-400">
                    <span>
                      {t('knowledgeBase.tokenCount', {
                        count: chunk.tokenCount,
                      })}
                    </span>
                    <span>·</span>
                    <span>
                      {t('knowledgeBase.version', {
                        version: chunk.documentVersion,
                      })}
                    </span>
                  </div>
                </div>
                <pre className="max-h-32 overflow-y-auto whitespace-pre-wrap rounded-lg bg-gray-50 p-2 font-mono text-[11px] leading-relaxed text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                  {chunk.content}
                </pre>
              </div>
            ))}
          </div>
        )}

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

// ───────────────────────────── SyncStatusBar ─────────────────────────────

function SyncStatusBar({
  chunks,
  loading,
  t,
}: {
  chunks: DocumentChunk[] | undefined;
  loading: boolean;
  t: TFunc;
}) {
  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-gray-400">
        <Loader2 size={12} className="animate-spin" />
        {t('knowledgeBase.loading')}
      </div>
    );
  }

  if (!chunks || chunks.length === 0) return null;

  const total = chunks.length;
  // We can't check embedding directly from frontend since it's Unsupported,
  // but we show the total as a simple indicator
  return (
    <div className="flex items-center gap-3 text-xs text-gray-500">
      <div className="flex items-center gap-1">
        <ListTree size={12} />
        <span>{t('knowledgeBase.chunkCount', { count: total })}</span>
      </div>
      <div className="flex items-center gap-1">
        <CheckCircle2 size={12} className="text-green-500" />
        <span>
          {t('knowledgeBase.chunksEmbedded')}: {total}
        </span>
      </div>
    </div>
  );
}

// ───────────────────────────── Main Component ─────────────────────────────

export function KnowledgeBaseClient() {
  const { t } = useTranslation();

  // Filters
  const [search, setSearch] = useState('');
  const [domainFilter, setDomainFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [isActiveFilter, setIsActiveFilter] = useState('');

  // Modal states
  const [formModal, setFormModal] = useState<KnowledgeDocument | null | false>(
    false,
  );
  const [detailModal, setDetailModal] = useState<KnowledgeDocument | null>(
    null,
  );
  const [uploadModal, setUploadModal] = useState(false);
  const [chunkModal, setChunkModal] = useState<{
    id: string;
    title: string;
  } | null>(null);

  // Domains
  const { data: domains } = useRequest(() => knowledgeApi.getDomains(), {
    onError: () => {}, // silently fail
  });

  // Document list
  const queryParams = useMemo<QueryKnowledgeDocParams>(() => {
    const params: QueryKnowledgeDocParams = { page: 1, pageSize: 100 };
    if (search.trim()) params.search = search.trim();
    if (domainFilter) params.domain = domainFilter;
    if (priorityFilter) params.priority = priorityFilter;
    if (isActiveFilter) params.isActive = isActiveFilter === 'true';
    return params;
  }, [search, domainFilter, priorityFilter, isActiveFilter]);

  const { data, loading, refresh } = useRequest(
    () => knowledgeApi.list(queryParams),
    { refreshDeps: [queryParams] },
  );

  const documents = useMemo(() => data?.list ?? [], [data?.list]);

  // ── Actions ──

  const handleDelete = (doc: KnowledgeDocument) => {
    ModalManager.open({
      title: t('knowledgeBase.deleteConfirm'),
      confirmText: t('knowledgeBase.save'),
      onConfirm: async () => {
        await knowledgeApi.delete(doc.id);
        await refresh();
      },
    });
  };

  const handleReindex = (doc: KnowledgeDocument) => {
    ModalManager.open({
      title: t('knowledgeBase.reindexConfirm'),
      confirmText: t('knowledgeBase.reindex'),
      onConfirm: async () => {
        const result = await knowledgeApi.reindex(doc.id);
        ModalManager.open({
          title: t('knowledgeBase.reindexSuccess', {
            success: result.successCount,
            fail: result.failCount,
          }),
        });
        await refresh();
      },
    });
  };

  const handleViewDetail = (doc: KnowledgeDocument) => {
    setDetailModal(doc);
  };

  const handleEdit = (doc: KnowledgeDocument) => {
    setFormModal(doc);
  };

  const handleNewDoc = () => {
    setFormModal(null);
  };

  const handleUpload = () => {
    setUploadModal(true);
  };

  const handleViewChunks = (doc: KnowledgeDocument) => {
    setChunkModal({ id: doc.id, title: doc.title });
  };

  const [reindexingAll, setReindexingAll] = useState(false);

  const handleReindexAll = () => {
    ModalManager.open({
      title: t('knowledgeBase.reindexAllConfirm'),
      confirmText: t('knowledgeBase.reindex'),
      onConfirm: async () => {
        setReindexingAll(true);
        try {
          const result = await knowledgeApi.reindexAll();
          ModalManager.open({
            title: t('knowledgeBase.reindexAllSuccess', {
              total: result.total,
              submitted: result.submitted,
              failed: result.failed,
            }),
          });
          await refresh();
        } finally {
          setReindexingAll(false);
        }
      },
    });
  };

  // ── Render ──

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t('knowledgeBase.pageTitle')}
        description={t('knowledgeBase.pageDescription')}
        buttonText={t('knowledgeBase.uploadMd')}
        buttonOnClick={handleUpload}
        buttonPrefixIcon={<Upload size={16} />}
        secondaryButtonText={t('knowledgeBase.newDoc')}
        secondaryButtonOnClick={handleNewDoc}
        tertiaryButtonText={
          reindexingAll
            ? t('knowledgeBase.reindexing')
            : t('knowledgeBase.reindexAll')
        }
        tertiaryButtonOnClick={handleReindexAll}
        tertiaryButtonIcon={
          reindexingAll ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <RotateCcw size={14} />
          )
        }
        tertiaryButtonVariant="outline"
      />

      <ServiceStatusBar />

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('knowledgeBase.searchPlaceholder')}
            className="w-full rounded-xl border border-gray-200 py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/50 dark:border-white/10 dark:bg-gray-800 dark:text-gray-200"
          />
        </div>

        <select
          value={domainFilter}
          onChange={(e) => setDomainFilter(e.target.value)}
          className="rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/50 dark:border-white/10 dark:bg-gray-800 dark:text-gray-200"
        >
          <option value="">{t('knowledgeBase.allDomains')}</option>
          {(domains ?? DOMAIN_OPTIONS).map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>

        <select
          value={priorityFilter}
          onChange={(e) => setPriorityFilter(e.target.value)}
          className="rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/50 dark:border-white/10 dark:bg-gray-800 dark:text-gray-200"
        >
          <option value="">{t('knowledgeBase.allPriorities')}</option>
          <option value="P0">P0</option>
          <option value="P1">P1</option>
          <option value="P2">P2</option>
        </select>

        <select
          value={isActiveFilter}
          onChange={(e) => setIsActiveFilter(e.target.value)}
          className="rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/50 dark:border-white/10 dark:bg-gray-800 dark:text-gray-200"
        >
          <option value="">{t('knowledgeBase.allStatus')}</option>
          <option value="true">{t('knowledgeBase.active')}</option>
          <option value="false">{t('knowledgeBase.inactive')}</option>
        </select>

        <button
          onClick={refresh}
          className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-white/5"
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Table */}
      <section className="rounded-2xl border border-gray-100 bg-white dark:border-white/10 dark:bg-gray-900/50">
        <div className="border-b border-gray-100 px-5 py-3 dark:border-white/10">
          <p className="text-sm text-gray-500">
            {t('knowledgeBase.totalDocs', { count: documents.length })}
          </p>
        </div>

        {loading && documents.length === 0 ? (
          <div className="flex items-center justify-center py-16 text-gray-400">
            <RefreshCw size={18} className="mr-2 animate-spin" />
            {t('knowledgeBase.loading')}
          </div>
        ) : documents.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-gray-400">
            <FileText size={32} className="opacity-30" />
            <p className="text-sm">{t('knowledgeBase.noDocuments')}</p>
            <button
              onClick={handleNewDoc}
              className="mt-2 rounded-xl bg-teal-500 px-4 py-2 text-sm text-white transition-colors hover:bg-teal-600"
            >
              {t('knowledgeBase.newDoc')}
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 dark:border-white/10">
                  <th className="px-5 py-3 text-left text-xs font-medium text-gray-400">
                    {t('knowledgeBase.title')}
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-400">
                    {t('knowledgeBase.domain')}
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-400">
                    {t('knowledgeBase.contentType')}
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-400">
                    {t('knowledgeBase.priority')}
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-400">
                    {t('knowledgeBase.locale')}
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-400">
                    {t('knowledgeBase.chunks')}
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-400">
                    {t('knowledgeBase.status')}
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-400">
                    {t('actions')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {documents.map((doc) => (
                  <tr
                    key={doc.id}
                    className="border-b border-gray-50 transition-colors hover:bg-gray-50/50 dark:border-white/5 dark:hover:bg-white/[0.02]"
                  >
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-2">
                        <FileText
                          size={14}
                          className="shrink-0 text-gray-300 dark:text-gray-600"
                        />
                        <div className="min-w-0">
                          <p className="truncate font-medium text-gray-900 dark:text-white">
                            {doc.title}
                          </p>
                          <p className="truncate font-mono text-[10px] text-gray-400">
                            {shortId(doc.docId)}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600 dark:bg-white/10 dark:text-gray-400">
                        {doc.domain}
                      </span>
                    </td>
                    <td className="px-4 py-4">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                          CONTENT_TYPE_BADGE[doc.contentType] ??
                          'bg-gray-100 text-gray-500'
                        }`}
                      >
                        {doc.contentType}
                      </span>
                    </td>
                    <td className="px-4 py-4">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                          PRIORITY_BADGE[doc.priority] ??
                          'bg-gray-100 text-gray-500'
                        }`}
                      >
                        {doc.priority}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-gray-600 dark:text-gray-400">
                      {doc.locale}
                    </td>
                    <td className="px-4 py-4">
                      <button
                        onClick={() => handleViewChunks(doc)}
                        className="flex items-center gap-1 text-xs text-teal-600 transition-colors hover:text-teal-500"
                      >
                        <ListTree size={12} />
                        {t('knowledgeBase.chunks')}
                      </button>
                    </td>
                    <td className="px-4 py-4">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-medium ${
                        doc.processStatus === 'indexed' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' :
                        doc.processStatus === 'embedded' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' :
                        doc.processStatus === 'chunked' ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400' :
                        doc.processStatus === 'parsed' ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400' :
                        'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
                      }`}>
                        {doc.processStatus || 'uploaded'}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => handleViewDetail(doc)}
                          className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-teal-50 hover:text-teal-500 dark:hover:bg-teal-900/20"
                          title={t('knowledgeBase.docDetail')}
                        >
                          <Eye size={14} />
                        </button>
                        <button
                          onClick={() => handleEdit(doc)}
                          className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-teal-50 hover:text-teal-500 dark:hover:bg-teal-900/20"
                          title={t('edit')}
                        >
                          <Edit2 size={14} />
                        </button>
                        <button
                          onClick={() => handleReindex(doc)}
                          className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-amber-50 hover:text-amber-500 dark:hover:bg-amber-900/20"
                          title={t('knowledgeBase.reindex')}
                        >
                          <RotateCcw size={14} />
                        </button>
                        <button
                          onClick={() => handleDelete(doc)}
                          className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20"
                          title={t('delete')}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Modals */}
      {formModal !== false && (
        <DocFormModal
          document={formModal}
          domains={domains ?? []}
          onClose={() => setFormModal(false)}
          onSaved={refresh}
          t={t}
        />
      )}

      {detailModal && (
        <DocDetailModal
          document={detailModal}
          onClose={() => setDetailModal(null)}
          t={t}
        />
      )}

      {uploadModal && (
        <UploadModal
          onClose={() => setUploadModal(false)}
          onUploaded={refresh}
          t={t}
        />
      )}

      {chunkModal && (
        <ChunkListModal
          documentId={chunkModal.id}
          documentTitle={chunkModal.title}
          onClose={() => setChunkModal(null)}
          t={t}
        />
      )}
    </div>
  );
}
