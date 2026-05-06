'use client';

import React, { useState, useCallback } from 'react';
import { Card, Button, Skeleton } from '@/components/UIComponents';
import { useToastStore } from '@/store/useToastStore';
import { blogApi } from '@/api';
import { useTranslation } from '@/hooks/useTranslation';
import { useSse } from '@/hooks/useSSE';
import LocalizedText from '@/components/blog/LocalizedText';
import {
  Search,
  CheckCircle,
  AlertTriangle,
  Languages,
  BarChart3,
  RotateCcw,
  Trash2,
  XCircle,
  Loader2,
} from 'lucide-react';

// ─── Quality Score Bar ────────────────────────────────────────────────
const ScoreBar = ({ score }: { score: number }) => {
  const color =
    score >= 85
      ? 'bg-emerald-500'
      : score >= 60
        ? 'bg-amber-500'
        : 'bg-red-500';
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 bg-gray-200 dark:bg-white/10 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${color}`}
          style={{ width: `${Math.min(score, 100)}%` }}
        />
      </div>
      <span
        className={`text-xs font-semibold w-8 text-right ${
          score >= 85
            ? 'text-emerald-600'
            : score >= 60
              ? 'text-amber-600'
              : 'text-red-600'
        }`}
      >
        {score}
      </span>
    </div>
  );
};

// ─── Language Tab ────────────────────────────────────────────────────
const LangTab = ({
  code,
  label,
  active,
  onClick,
}: {
  code: string;
  label: string;
  active: boolean;
  onClick: () => void;
}) => (
  <button
    type="button"
    onClick={onClick}
    className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
      active
        ? 'bg-primary-500 text-white shadow-sm'
        : 'bg-gray-100 dark:bg-white/5 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-white/10'
    }`}
  >
    {label}
    <span className="ml-1 text-xs opacity-70">({code})</span>
  </button>
);

// ─── Stat Card ────────────────────────────────────────────────────────
const StatItem = ({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string | number;
  highlight?: 'green' | 'red' | 'yellow';
}) => {
  const colorMap = {
    green: 'text-emerald-600',
    red: 'text-red-600',
    yellow: 'text-amber-600',
  };
  return (
    <div className="text-center">
      <div
        className={`text-2xl font-bold ${highlight ? colorMap[highlight] : 'text-gray-800 dark:text-white'}`}
      >
        {value}
      </div>
      <div className="text-xs text-gray-500 mt-1">{label}</div>
    </div>
  );
};

// ─── Default language list (fallback when API not available) ─────────
const DEFAULT_LANGUAGES = [
  { code: 'en', name: 'English', nativeName: 'English' },
  { code: 'ja', name: 'Japanese', nativeName: '日本語' },
  { code: 'ko', name: 'Korean', nativeName: '한국어' },
  { code: 'fr', name: 'French', nativeName: 'Français' },
  { code: 'de', name: 'German', nativeName: 'Deutsch' },
];

export default function BlogTranslationQualityDetectionStream() {
  const { t: globalT } = useTranslation();
  const { addToast } = useToastStore();

  const t = (key: string, params?: Record<string, string | number>) =>
    globalT(`blog_tq_${key}`, params);

  const [selectedLang, setSelectedLang] = useState<string>('en');
  const [retranslatingIds, setRetranslatingIds] = useState<
    Record<string, boolean>
  >({});
  const [batchRetranslating, setBatchRetranslating] = useState(false);
  const [clearingIds, setClearingIds] = useState<Record<string, boolean>>({});
  const [batchClearing, setBatchClearing] = useState(false);

  // SSE endpoint URL (append auth token since EventSource cannot set headers)
  const sseUrl = React.useMemo(() => {
    const token =
      typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
    const params = new URLSearchParams({ lang: selectedLang });
    if (token) params.set('token', token);
    return `/api/v1/admin/blog/translation/detect-incomplete/stream?${params.toString()}`;
  }, [selectedLang]);

  // SSE hook
  const {
    connect,
    disconnect,
    isConnecting,
    error: sseError,
    progress,
    result,
    progressPercent,
  } = useSse(sseUrl);

  // Detect handler: start SSE connection
  const handleDetect = useCallback(() => {
    connect();
  }, [connect]);

  // Cancel handler: abort SSE connection
  const handleCancel = useCallback(() => {
    disconnect();
  }, [disconnect]);

  // 批量重新翻译不完整文章
  const handleBatchRetranslate = async () => {
    if (batchRetranslating) return;
    setBatchRetranslating(true);
    try {
      const res =
        await blogApi.translation.retranslateIncompleteArticles(selectedLang);
      const queued = (res as any)?.queued ?? 0;
      addToast('success', t('batchRetranslateSuccess', { count: queued }));
    } catch {
      addToast('error', t('batchRetranslateFailed'));
    } finally {
      setBatchRetranslating(false);
    }
  };

  // 重新翻译单篇文章
  const handleRetranslateArticle = async (articleId: string) => {
    setRetranslatingIds((prev) => ({ ...prev, [articleId]: true }));
    try {
      await blogApi.translation.translateArticle(articleId, selectedLang);
      addToast('success', t('singleRetranslateSuccess'));
    } catch {
      addToast('error', t('singleRetranslateFailed'));
    } finally {
      setRetranslatingIds((prev) => ({ ...prev, [articleId]: false }));
    }
  };

  // 清空单篇文章翻译并重新翻译
  const handleClearArticle = async (articleId: string) => {
    setClearingIds((prev) => ({ ...prev, [articleId]: true }));
    try {
      await blogApi.translation.clearArticleTranslations(
        [articleId],
        selectedLang,
      );
      addToast('success', t('clearSuccess'));
    } catch {
      addToast('error', t('clearFailed'));
    } finally {
      setClearingIds((prev) => ({ ...prev, [articleId]: false }));
    }
  };

  // 批量清空所有不完整文章的翻译并重新翻译
  const handleBatchClear = async () => {
    if (batchClearing || !result || result.incompleteArticles.length === 0) {
      return;
    }
    setBatchClearing(true);
    try {
      const ids = result.incompleteArticles.map((a: any) => a.id);
      const res = await blogApi.translation.clearArticleTranslations(
        ids,
        selectedLang,
      );
      const cleared = (res as any)?.cleared ?? 0;
      addToast('success', t('batchClearSuccess', { count: cleared }));
    } catch {
      addToast('error', t('batchClearFailed'));
    } finally {
      setBatchClearing(false);
    }
  };

  const incompleteArticles: any[] = result?.incompleteArticles ?? [];
  const total: number = result?.total ?? 0;
  const incompleteCount: number = result?.incompleteCount ?? 0;
  const completionRate: string = result?.completionRate ?? '0.00';

  return (
    <div className="space-y-6">
      {/* 语言选择标签栏（扫描中禁用切换） */}
      <Card>
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Languages className="w-4 h-4 text-gray-500" />
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('selectLanguage')}
            </span>
          </div>

          <div className="flex flex-wrap gap-2">
            {DEFAULT_LANGUAGES.map((lang) => (
              <LangTab
                key={lang.code}
                code={lang.code}
                label={lang.nativeName || lang.name}
                active={selectedLang === lang.code}
                onClick={() => {
                  if (!isConnecting) setSelectedLang(lang.code);
                }}
              />
            ))}
          </div>

          {/* 操作按钮行 */}
          <div className="flex items-center justify-between pt-2 border-t border-gray-100 dark:border-white/5">
            <div className="flex items-center gap-2">
              {!isConnecting ? (
                <Button variant="outline" size="sm" onClick={handleDetect}>
                  <Search className="w-4 h-4 mr-2" />
                  {t('detectButton')}
                </Button>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleCancel}
                  className="border-red-300 text-red-600 hover:bg-red-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-900/20"
                >
                  <XCircle className="w-4 h-4 mr-2" />
                  {globalT('cancel')}
                </Button>
              )}
            </div>

            {result && incompleteCount > 0 && (
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleBatchClear}
                  isLoading={batchClearing}
                  disabled={batchClearing || incompleteCount === 0}
                >
                  <Trash2 className="w-4 h-4 mr-2" />
                  {t('batchClearButton')}
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleBatchRetranslate}
                  isLoading={batchRetranslating}
                  disabled={batchRetranslating || incompleteCount === 0}
                >
                  <RotateCcw className="w-4 h-4 mr-2" />
                  {t('batchRetranslateButton', { count: incompleteCount })}
                </Button>
              </div>
            )}
          </div>
        </div>
      </Card>

      {/* SSE 扫描进度条 */}
      {isConnecting && (
        <Card>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Loader2 className="w-4 h-4 text-primary-500 animate-spin" />
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  {t('scanningProgress', { percent: progressPercent })}
                </span>
              </div>
              {progress && (
                <span className="text-xs text-gray-400">
                  {progress.processed} / {progress.total}
                </span>
              )}
            </div>
            {/* Progress bar */}
            <div className="w-full h-2 bg-gray-200 dark:bg-white/10 rounded-full overflow-hidden">
              <div
                className="h-full bg-primary-500 rounded-full transition-all duration-300 ease-out"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            {progress && (
              <div className="text-xs text-gray-500">
                {t('scanningFoundSoFar', {
                  count: progress.incompleteSoFar,
                })}
              </div>
            )}
          </div>
        </Card>
      )}

      {/* 错误提示 */}
      {sseError && !isConnecting && (
        <Card>
          <div className="flex items-center gap-3 text-red-600">
            <AlertTriangle className="w-5 h-5" />
            <span className="text-sm">{t('scanError')}</span>
            <Button variant="outline" size="sm" onClick={handleDetect}>
              {t('retryButton')}
            </Button>
          </div>
        </Card>
      )}

      {/* 检测结果摘要 */}
      {!isConnecting && result && (
        <>
          {/* 健康度摘要卡片 */}
          <Card
            title={t('summaryTitle', {
              lang: selectedLang.toUpperCase(),
            })}
          >
            <div className="grid grid-cols-2 md:grid-cols-4 gap-6 py-2">
              <StatItem label={t('statTotal')} value={total} />
              <StatItem
                label={t('statIncomplete')}
                value={incompleteCount}
                highlight={incompleteCount > 0 ? 'red' : 'green'}
              />
              <StatItem
                label={t('statCompletionRate')}
                value={`${Number(completionRate).toFixed(1)}%`}
                highlight={
                  Number(completionRate) >= 90
                    ? 'green'
                    : Number(completionRate) >= 70
                      ? 'yellow'
                      : 'red'
                }
              />
              <StatItem
                label={t('statHealthy')}
                value={total - incompleteCount}
                highlight="green"
              />
            </div>
          </Card>

          {/* 不完整文章明细 */}
          {incompleteArticles.length > 0 ? (
            <Card
              title={t('incompleteListTitle', {
                count: incompleteArticles.length,
              })}
            >
              <div className="space-y-3">
                <div className="text-sm text-gray-500">
                  {t('incompleteListDesc', {
                    lang: selectedLang.toUpperCase(),
                  })}
                </div>

                <div className="overflow-x-auto rounded-lg">
                  <table className="w-full">
                    <thead className="bg-gray-50 dark:bg-white/5">
                      <tr>
                        <th className="px-4 py-3 text-left text-sm font-medium text-gray-700 dark:text-gray-300">
                          {t('colTitle')}
                        </th>
                        <th className="px-4 py-3 text-left text-sm font-medium text-gray-700 dark:text-gray-300 w-32">
                          {t('colTitleScore')}
                        </th>
                        <th className="px-4 py-3 text-left text-sm font-medium text-gray-700 dark:text-gray-300 w-40">
                          {t('colContentScore')}
                        </th>
                        <th className="px-4 py-3 text-left text-sm font-medium text-gray-700 dark:text-gray-300">
                          {t('colIssues')}
                        </th>
                        <th className="px-4 py-3 text-left text-sm font-medium text-gray-700 dark:text-gray-300 w-24">
                          {t('colActions')}
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-white/5">
                      {incompleteArticles.map((article: any) => {
                        const isRetranslating =
                          retranslatingIds[article.id] || false;
                        const isClearing = clearingIds[article.id] || false;
                        const titleScore = article.titleCompletion ?? 100;
                        const contentScore = article.contentCompletion ?? 0;
                        return (
                          <tr
                            key={article.id}
                            className="hover:bg-gray-50 dark:hover:bg-white/3"
                          >
                            <td className="px-4 py-3">
                              <div className="font-medium text-gray-900 dark:text-white text-sm">
                                <LocalizedText value={article.title} />
                              </div>
                              <div className="text-xs text-gray-400 mt-0.5">
                                {article.slug}
                              </div>
                            </td>
                            <td className="px-4 py-3">
                              <ScoreBar score={titleScore} />
                            </td>
                            <td className="px-4 py-3">
                              <ScoreBar score={contentScore} />
                            </td>
                            <td className="px-4 py-3">
                              <div className="space-y-1">
                                {(article.issues ?? []).map(
                                  (issue: any, idx: number) => {
                                    const issueType = issue?.issueType;
                                    const issueParams = issue?.params;
                                    const issueDesc =
                                      issue?.description ?? issue;
                                    const localizedDesc =
                                      issueType &&
                                      globalT(
                                        `blog_tq_issue_${issueType.toLowerCase()}`,
                                        issueParams,
                                      );
                                    return (
                                      <div
                                        key={idx}
                                        className="flex items-start gap-1"
                                      >
                                        <AlertTriangle className="w-3 h-3 text-amber-500 mt-0.5 shrink-0" />
                                        <span className="text-xs text-gray-600 dark:text-gray-400">
                                          {localizedDesc || issueDesc}
                                        </span>
                                      </div>
                                    );
                                  },
                                )}
                              </div>
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-1">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  isLoading={isRetranslating}
                                  disabled={isRetranslating || isClearing}
                                  onClick={() =>
                                    handleRetranslateArticle(article.id)
                                  }
                                >
                                  <RotateCcw className="w-3 h-3 mr-1" />
                                  {t('retranslateButton')}
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  isLoading={isClearing}
                                  disabled={isClearing || isRetranslating}
                                  onClick={() => handleClearArticle(article.id)}
                                >
                                  <Trash2 className="w-3 h-3 mr-1" />
                                  {t('clearButton')}
                                </Button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </Card>
          ) : (
            <Card>
              <div className="text-center py-12 text-gray-500">
                <CheckCircle className="w-14 h-14 mx-auto text-emerald-400 mb-3" />
                <p className="font-medium text-gray-700 dark:text-gray-300">
                  {t('allComplete')}
                </p>
                <p className="text-sm mt-1">
                  {t('allCompleteDesc', {
                    lang: selectedLang.toUpperCase(),
                  })}
                </p>
              </div>
            </Card>
          )}
        </>
      )}

      {/* 初始状态提示 */}
      {!isConnecting && !result && !sseError && (
        <Card>
          <div className="text-center py-12 text-gray-400">
            <BarChart3 className="w-14 h-14 mx-auto mb-3 opacity-40" />
            <p className="font-medium">{t('initialHint')}</p>
            <p className="text-sm mt-1">{t('initialHintDesc')}</p>
            <Button
              variant="primary"
              size="sm"
              className="mt-4"
              onClick={handleDetect}
            >
              <Search className="w-4 h-4 mr-2" />
              {t('detectButton')}
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
