'use client';

import React, { useState } from 'react';
import { useRequest } from 'ahooks';
import { Card, Button, Skeleton } from '@/components/UIComponents';
import { useToastStore } from '@/store/useToastStore';
import { blogApi, systemConfigApi } from '@/api';
import { useTranslation } from '@/hooks/useTranslation';
import LocalizedText from '@/components/blog/LocalizedText';
import {
  Search,
  CheckCircle,
  AlertTriangle,
  Languages,
  BarChart3,
  RotateCcw,
  Trash2,
  Globe,
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

export default function BlogTranslationQualityDetection() {
  const { t: globalT, lang } = useTranslation();
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
  const [allLocalesRetranslating, setAllLocalesRetranslating] = useState(false);

  // 获取启用的语言列表（使用 getBlogLocales，返回格式已知）
  const { data: localesRaw, loading: languagesLoading } = useRequest(
    () => systemConfigApi.getBlogLocales(),
    { manual: false },
  );

  // 标准化语言列表：过滤出已启用的语言，兼容多种返回格式
  const enabledLanguages = React.useMemo(() => {
    const raw = localesRaw as any;
    // getBlogLocales 返回 { list: [...] }
    const list: any[] = raw?.list ?? raw?.languages ?? raw ?? [];
    const arr = Array.isArray(list) ? list : [];
    if (arr.length === 0) return DEFAULT_LANGUAGES;
    // 过滤 enabled，并标准化字段
    const normalized = arr
      .filter((l: any) => l.enabled !== false)
      .map((l: any) => ({
        code: l.code || l.locale || l.id || '',
        name: l.name || l.code || '',
        nativeName: l.nativeName || l.native_name || l.name || l.code || '',
      }))
      .filter((l) => !!l.code);
    return normalized.length > 0 ? normalized : DEFAULT_LANGUAGES;
  }, [localesRaw]);

  // 检测不完整翻译
  const {
    data: detectResult,
    loading: detecting,
    run: runDetect,
  } = useRequest(
    () => blogApi.translation.detectIncompleteTranslations(selectedLang),
    { manual: true },
  );

  // 语言切换时自动重新检测（如果之前已有结果）
  React.useEffect(() => {
    if (detectResult !== undefined) {
      runDetect();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLang]);

  // 批量重新翻译不完整文章
  const handleBatchRetranslate = async () => {
    if (batchRetranslating) return;
    setBatchRetranslating(true);
    try {
      const res =
        await blogApi.translation.retranslateIncompleteArticles(selectedLang);
      const queued = (res as any)?.queued ?? 0;
      addToast('success', t('batchRetranslateSuccess', { count: queued }));
      setTimeout(() => runDetect(), 1500);
    } catch (err: any) {
      addToast('error', t('batchRetranslateFailed'));
    } finally {
      setBatchRetranslating(false);
    }
  };

  // 一键修复所有语言
  const handleRetranslateAllLocales = async () => {
    if (allLocalesRetranslating) return;
    setAllLocalesRetranslating(true);
    try {
      const res = await blogApi.translation.retranslateAllLocales();
      const totalQueued = (res as any)?.totalQueued ?? 0;
      addToast('success', `一键修复完成，共投递 ${totalQueued} 个翻译任务`);
      setTimeout(() => runDetect(), 1500);
    } catch (err: any) {
      addToast('error', '一键修复失败');
    } finally {
      setAllLocalesRetranslating(false);
    }
  };

  // 重新翻译单篇文章
  const handleRetranslateArticle = async (articleId: string) => {
    setRetranslatingIds((prev) => ({ ...prev, [articleId]: true }));
    try {
      await blogApi.translation.translateArticle(articleId, selectedLang);
      addToast('success', t('singleRetranslateSuccess'));
      setTimeout(() => runDetect(), 1500);
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
      setTimeout(() => runDetect(), 1500);
    } catch {
      addToast('error', t('clearFailed'));
    } finally {
      setClearingIds((prev) => ({ ...prev, [articleId]: false }));
    }
  };

  // 批量清空所有不完整文章的翻译并重新翻译
  const handleBatchClear = async () => {
    if (batchClearing || incompleteArticles.length === 0) return;
    setBatchClearing(true);
    try {
      const ids = incompleteArticles.map((a: any) => a.id);
      const res = await blogApi.translation.clearArticleTranslations(
        ids,
        selectedLang,
      );
      const cleared = (res as any)?.cleared ?? 0;
      addToast('success', t('batchClearSuccess', { count: cleared }));
      setTimeout(() => runDetect(), 1500);
    } catch {
      addToast('error', t('batchClearFailed'));
    } finally {
      setBatchClearing(false);
    }
  };

  const result = detectResult as any;
  const incompleteArticles: any[] = result?.incompleteArticles ?? [];
  const total: number = result?.total ?? 0;
  const incompleteCount: number = result?.incompleteCount ?? 0;
  const completionRate: string = result?.completionRate ?? '0.00';

  return (
    <div className="space-y-6">
      {/* 语言选择标签栏 */}
      <Card>
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Languages className="w-4 h-4 text-gray-500" />
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('selectLanguage')}
            </span>
          </div>
          {languagesLoading ? (
            <div className="flex gap-2">
              {[1, 2, 3, 4, 5].map((i) => (
                <Skeleton key={i} className="h-9 w-24 rounded-lg" />
              ))}
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {enabledLanguages.map((lang) => (
                <LangTab
                  key={lang.code}
                  code={lang.code}
                  label={lang.nativeName || lang.name}
                  active={selectedLang === lang.code}
                  onClick={() => setSelectedLang(lang.code)}
                />
              ))}
            </div>
          )}

          {/* 操作按钮行 */}
          <div className="flex items-center justify-between pt-2 border-t border-gray-100 dark:border-white/5">
            <Button
              variant="outline"
              size="sm"
              onClick={() => runDetect()}
              isLoading={detecting}
            >
              <Search className="w-4 h-4 mr-2" />
              {t('detectButton')}
            </Button>

            {!detecting && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleRetranslateAllLocales}
                isLoading={allLocalesRetranslating}
                disabled={allLocalesRetranslating}
                className="border-red-300 text-red-600 hover:bg-red-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-900/20"
              >
                <Globe className="w-4 h-4 mr-2" />
                一键修复所有语言
              </Button>
            )}

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

      {/* 检测结果摘要 */}
      {detecting && (
        <Card>
          <div className="space-y-3">
            <Skeleton className="h-8 w-48" />
            <div className="grid grid-cols-3 gap-4">
              <Skeleton className="h-16" />
              <Skeleton className="h-16" />
              <Skeleton className="h-16" />
            </div>
          </div>
        </Card>
      )}

      {!detecting && result && (
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
                                    // 解析 issueType 并尝试从 i18n 查找对应翻译
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
      {!detecting && !result && (
        <Card>
          <div className="text-center py-12 text-gray-400">
            <BarChart3 className="w-14 h-14 mx-auto mb-3 opacity-40" />
            <p className="font-medium">{t('initialHint')}</p>
            <p className="text-sm mt-1">{t('initialHintDesc')}</p>
            <Button
              variant="primary"
              size="sm"
              className="mt-4"
              onClick={() => runDetect()}
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
