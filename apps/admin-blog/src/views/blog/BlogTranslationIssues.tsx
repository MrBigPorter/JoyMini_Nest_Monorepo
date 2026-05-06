'use client';

import React, { useState } from 'react';
import { useRequest } from 'ahooks';
import {
  Card,
  Badge,
  Button,
  Select,
  Skeleton,
} from '@/components/UIComponents';
import { useToastStore } from '@/store/useToastStore';
import { blogApi } from '@/api';
import { useTranslation } from '@/hooks/useTranslation';
import { Search, CheckCircle, Wrench, Languages } from 'lucide-react';

const Checkbox = ({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
}) => (
  <label
    className={`inline-flex items-center relative ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
  >
    <input
      type="checkbox"
      checked={checked}
      onChange={onChange}
      disabled={disabled}
      className="sr-only"
    />
    <div
      className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-colors ${
        checked
          ? 'bg-primary-500 border-primary-500'
          : 'border-gray-300 dark:border-white/20'
      }`}
    >
      {checked && (
        <svg
          className="w-3 h-3 text-white"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={3}
            d="M5 13l4 4L19 7"
          />
        </svg>
      )}
    </div>
  </label>
);

export default function BlogTranslationIssues() {
  const { t: globalT } = useTranslation();
  const { addToast } = useToastStore();

  const t = (key: string, params?: Record<string, string | number>) =>
    globalT(`blog_translation_${key}`, params);

  const [selectedLanguage, setSelectedLanguage] = useState<string>('en');
  const [selectedArticles, setSelectedArticles] = useState<string[]>([]);
  const [fixingInProgress, setFixingInProgress] = useState(false);

  // 分类/标签选择与翻译状态
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [translatingCategories, setTranslatingCategories] = useState<
    Record<string, boolean>
  >({});
  const [translatingTags, setTranslatingTags] = useState<
    Record<string, boolean>
  >({});
  const [batchTranslatingCategories, setBatchTranslatingCategories] =
    useState(false);
  const [batchTranslatingTags, setBatchTranslatingTags] = useState(false);

  // 问题检测
  const {
    data: translationIssues,
    loading: issuesLoading,
    run: runIssues,
  } = useRequest(
    () => blogApi.translation.getTranslationIssues(selectedLanguage),
    {
      manual: true,
    },
  );

  // 初始加载
  React.useEffect(() => {
    runIssues();
  }, [runIssues]);

  // 语言变化时重新检测
  React.useEffect(() => {
    runIssues();
  }, [selectedLanguage, runIssues]);

  // 处理批量修复
  const handleBatchFix = async () => {
    if (fixingInProgress) return;

    setFixingInProgress(true);
    try {
      const articleIds =
        selectedArticles.length > 0
          ? selectedArticles
          : translationIssues?.issues?.map((issue: any) => issue.articleId) ||
            [];

      const response = await blogApi.translation.fixTranslationIssuesBatch({
        articleIds: articleIds.length > 0 ? articleIds : undefined,
        languageCode: selectedLanguage,
      });

      if (!response) return;

      if (response.success) {
        addToast('success', t('batchFixStarted', { count: response.queued }));
        setTimeout(() => {
          runIssues();
        }, 1000);
      } else {
        addToast('error', t('batchFixFailed'));
      }
    } catch (error) {
      console.error(t('batchFixFailed'), error);
      addToast('error', t('batchFixNetworkError'));
    } finally {
      setFixingInProgress(false);
    }
  };

  // 处理文章选择
  const handleArticleSelect = (articleId: string) => {
    setSelectedArticles((prev) =>
      prev.includes(articleId)
        ? prev.filter((id) => id !== articleId)
        : [...prev, articleId],
    );
  };

  // 处理全选/取消全选
  const handleSelectAll = () => {
    if (!translationIssues?.issues) return;

    if (selectedArticles.length === translationIssues.issues.length) {
      setSelectedArticles([]);
    } else {
      setSelectedArticles(
        translationIssues.issues.map((issue: any) => issue.articleId),
      );
    }
  };

  // ─── 分类处理 ────────────────────────────────

  const handleCategorySelect = (categoryId: string) => {
    console.log(
      '[DEBUG] handleCategorySelect called with categoryId:',
      categoryId,
    );

    try {
      setSelectedCategories((prev) =>
        prev.includes(categoryId)
          ? prev.filter((id) => id !== categoryId)
          : [...prev, categoryId],
      );
    } catch (err) {
      console.error('[DEBUG] handleCategorySelect error:', err);
    }
  };

  const handleSelectAllCategories = () => {
    if (!translationIssues?.categories) return;
    if (selectedCategories.length === translationIssues.categories.length) {
      setSelectedCategories([]);
    } else {
      setSelectedCategories(
        translationIssues.categories.map((c: any) => c.categoryId),
      );
    }
  };

  const handleTranslateCategory = async (categoryId: string) => {
    setTranslatingCategories((prev) => ({ ...prev, [categoryId]: true }));
    try {
      const response = await blogApi.translation.translateCategory(
        categoryId,
        selectedLanguage,
      );
      if (response?.success !== false) {
        addToast('success', t('translationRequestSent'));
      } else {
        addToast('error', t('translationFailed'));
      }
    } catch (error) {
      console.error('Category translate error:', error);
      addToast('error', t('translationFailed'));
    } finally {
      setTranslatingCategories((prev) => ({ ...prev, [categoryId]: false }));
      setTimeout(() => {
        runIssues();
        setSelectedCategories([]);
      }, 1500);
    }
  };

  const handleBatchTranslateCategories = async () => {
    const ids =
      selectedCategories.length > 0
        ? selectedCategories
        : translationIssues?.categories?.map((c: any) => c.categoryId) || [];

    if (ids.length === 0) return;

    setBatchTranslatingCategories(true);
    const loadingMap: Record<string, boolean> = {};
    ids.forEach((id: string) => {
      loadingMap[id] = true;
    });
    setTranslatingCategories(loadingMap);

    try {
      const response = await blogApi.translation.batchTranslateCategories(
        ids,
        selectedLanguage,
      );
      if (response?.success) {
        addToast(
          'success',
          t('categoryTranslationSent', { count: response.queued }),
        );
      } else {
        addToast('error', t('translationFailed'));
      }
    } catch {
      addToast('error', t('translationFailed'));
    } finally {
      setBatchTranslatingCategories(false);
      setTranslatingCategories({});
      setSelectedCategories([]);
      setTimeout(() => runIssues(), 1500);
    }
  };

  // ─── 标签处理 ────────────────────────────────

  const handleTagSelect = (tagId: string) => {
    console.log('[DEBUG] handleTagSelect called with tagId:', tagId);
    try {
      setSelectedTags((prev) => {
        console.log('[DEBUG] setSelectedTags prev:', prev);
        const result = prev.includes(tagId)
          ? prev.filter((id) => id !== tagId)
          : [...prev, tagId];
        console.log('[DEBUG] setSelectedTags result:', result);
        return result;
      });
    } catch (err) {
      console.error('[DEBUG] handleTagSelect error:', err);
    }
  };

  const handleSelectAllTags = () => {
    if (!translationIssues?.tags) return;
    if (selectedTags.length === translationIssues.tags.length) {
      setSelectedTags([]);
    } else {
      setSelectedTags(translationIssues.tags.map((t: any) => t.tagId));
    }
  };

  const handleTranslateTag = async (tagId: string) => {
    setTranslatingTags((prev) => ({ ...prev, [tagId]: true }));
    try {
      const response = await blogApi.translation.translateTag(
        tagId,
        selectedLanguage,
      );
      if (response?.success !== false) {
        addToast('success', t('translationRequestSent'));
      } else {
        addToast('error', t('translationFailed'));
      }
    } catch (error) {
      console.error('Tag translate error:', error);
      addToast('error', t('translationFailed'));
    } finally {
      setTranslatingTags((prev) => ({ ...prev, [tagId]: false }));
      setTimeout(() => {
        runIssues();
        setSelectedTags([]);
      }, 1500);
    }
  };

  const handleBatchTranslateTags = async () => {
    const ids =
      selectedTags.length > 0
        ? selectedTags
        : translationIssues?.tags?.map((t: any) => t.tagId) || [];

    if (ids.length === 0) return;

    setBatchTranslatingTags(true);
    const loadingMap: Record<string, boolean> = {};
    ids.forEach((id: string) => {
      loadingMap[id] = true;
    });
    setTranslatingTags(loadingMap);

    try {
      const response = await blogApi.translation.batchTranslateTags(
        ids,
        selectedLanguage,
      );
      if (response?.success) {
        addToast(
          'success',
          t('tagTranslationSent', { count: response.queued }),
        );
      } else {
        addToast('error', t('translationFailed'));
      }
    } catch {
      addToast('error', t('translationFailed'));
    } finally {
      setBatchTranslatingTags(false);
      setTranslatingTags({});
      setSelectedTags([]);
      setTimeout(() => runIssues(), 1500);
    }
  };

  return (
    <div className="space-y-6">
      <Card title={t('issuesDetectionTitle')}>
        <div className="space-y-4">
          {/* 语言选择和批量操作控制 */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <Languages className="w-4 h-4 text-gray-500" />
                <span className="text-sm font-medium">
                  {t('targetLanguage')}:
                </span>
                <Select
                  value={selectedLanguage}
                  onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
                    setSelectedLanguage(e.target.value)
                  }
                  options={[
                    { value: 'en', label: '英语 (en)' },
                    { value: 'ja', label: '日语 (ja)' },
                    { value: 'ko', label: '韩语 (ko)' },
                    { value: 'fr', label: '法语 (fr)' },
                    { value: 'de', label: '德语 (de)' },
                  ]}
                  className="w-40"
                />
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => runIssues()}
                isLoading={issuesLoading}
              >
                <Search className="w-4 h-4 mr-2" />
                {t('recheck')}
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleSelectAll}
                disabled={!translationIssues?.issues?.length}
              >
                {selectedArticles.length === translationIssues?.issues?.length
                  ? t('deselectAll')
                  : t('selectAll')}
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={handleBatchFix}
                isLoading={fixingInProgress}
                disabled={!translationIssues?.issues?.length}
              >
                <Wrench className="w-4 h-4 mr-2" />
                {selectedArticles.length > 0
                  ? t('fixSelected', { count: selectedArticles.length })
                  : t('fixAll')}
              </Button>
            </div>
          </div>

          {/* 问题文章列表 */}
          {issuesLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-10" />
              <Skeleton className="h-10" />
              <Skeleton className="h-10" />
            </div>
          ) : translationIssues?.issues?.length > 0 ? (
            <div className="space-y-3">
              <div className="text-sm text-gray-500 mb-2">
                {t('issuesFound', {
                  count: translationIssues.problematicArticles,
                })}
              </div>
              <div className="rounded-lg overflow-hidden">
                <table className="w-full">
                  <thead className="bg-gray-50 dark:bg-white/5">
                    <tr>
                      <th className="px-4 py-3 text-left text-sm font-medium text-gray-700 dark:text-gray-300 w-12">
                        <Checkbox
                          checked={
                            translationIssues.issues.length > 0 &&
                            selectedArticles.length ===
                              translationIssues.issues.length
                          }
                          onChange={handleSelectAll}
                        />
                      </th>
                      <th className="px-4 py-3 text-left text-sm font-medium text-gray-700 dark:text-gray-300">
                        {t('articleTitle')}
                      </th>
                      <th className="px-4 py-3 text-left text-sm font-medium text-gray-700 dark:text-gray-300">
                        {t('issueType')}
                      </th>
                      <th className="px-4 py-3 text-left text-sm font-medium text-gray-700 dark:text-gray-300">
                        {t('severity')}
                      </th>
                      <th className="px-4 py-3 text-left text-sm font-medium text-gray-700 dark:text-gray-300">
                        {t('actions')}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-white/10">
                    {translationIssues.issues.map((issue: any) => (
                      <tr key={issue.articleId}>
                        <td className="px-4 py-3">
                          <Checkbox
                            checked={selectedArticles.includes(issue.articleId)}
                            onChange={() =>
                              handleArticleSelect(issue.articleId)
                            }
                          />
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-medium text-gray-900 dark:text-white">
                            {issue.articleTitle}
                          </div>
                          <div className="text-xs text-gray-500">
                            ID: {issue.articleId}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="space-y-1">
                            {issue.issues.map((item: any, idx: number) => (
                              <div key={idx} className="text-sm">
                                <Badge
                                  color={
                                    item.issueType === 'TITLE_NOT_TRANSLATED'
                                      ? 'red'
                                      : item.issueType === 'CONTENT_INCOMPLETE'
                                        ? 'yellow'
                                        : 'gray'
                                  }
                                >
                                  {item.issueType === 'TITLE_NOT_TRANSLATED'
                                    ? t('issueTitleNotTranslated')
                                    : item.issueType === 'CONTENT_INCOMPLETE'
                                      ? t('issueContentIncomplete')
                                      : item.issueType === 'NOT_TRANSLATED'
                                        ? t('issueNotTranslated')
                                        : t('issueFailed')}
                                </Badge>
                                <div className="text-xs text-gray-500 mt-1">
                                  {item.description}
                                </div>
                              </div>
                            ))}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="space-y-1">
                            {issue.issues.map((item: any, idx: number) => (
                              <div key={idx}>
                                <Badge
                                  color={
                                    item.severity === 'HIGH'
                                      ? 'red'
                                      : item.severity === 'MEDIUM'
                                        ? 'yellow'
                                        : 'gray'
                                  }
                                >
                                  {item.severity === 'HIGH'
                                    ? t('severityHigh')
                                    : item.severity === 'MEDIUM'
                                      ? t('severityMedium')
                                      : t('severityLow')}
                                </Badge>
                              </div>
                            ))}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setSelectedArticles([issue.articleId]);
                              handleBatchFix();
                            }}
                          >
                            {t('fixSingle')}
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="text-center py-8 text-gray-500">
              <CheckCircle className="w-12 h-12 mx-auto text-emerald-300 mb-3" />
              <p>{t('noIssuesFound')}</p>
              <p className="text-sm mt-1">
                {t('noIssuesFoundDesc', {
                  lang: selectedLanguage.toUpperCase(),
                })}
              </p>
            </div>
          )}
        </div>
      </Card>

      {/* 🏷️ 分类翻译问题 */}
      {translationIssues?.categories &&
        translationIssues.categories.length > 0 && (
          <Card
            title={t('categoryIssuesTitle', {
              count: translationIssues.categories.length,
            })}
          >
            <div className="space-y-3">
              {/* 分类操作栏：全选 + 批量翻译 */}
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Checkbox
                    checked={
                      translationIssues.categories.length > 0 &&
                      selectedCategories.length ===
                        translationIssues.categories.length
                    }
                    onChange={handleSelectAllCategories}
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleSelectAllCategories}
                    className="text-xs"
                  >
                    {selectedCategories.length ===
                    translationIssues.categories.length
                      ? t('deselectAll')
                      : t('selectAll')}
                  </Button>
                  <span className="text-sm text-gray-500 ml-1">
                    {t('categoryIssuesFound', {
                      count: translationIssues.categories.length,
                    })}
                  </span>
                </div>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleBatchTranslateCategories}
                  isLoading={batchTranslatingCategories}
                  disabled={
                    batchTranslatingCategories ||
                    Object.keys(translatingCategories).length > 0
                  }
                >
                  {batchTranslatingCategories
                    ? t('translatingProgress', {
                        current:
                          Object.values(translatingCategories).filter(Boolean)
                            .length -
                          Object.values(translatingCategories).filter((v) => !v)
                            .length,
                        total: Object.keys(translatingCategories).length,
                      })
                    : selectedCategories.length > 0
                      ? t('translateSelected', {
                          count: selectedCategories.length,
                        })
                      : t('translateAll')}
                </Button>
              </div>

              <div className="grid gap-3">
                {translationIssues.categories.map((category: any) => {
                  const isTranslating =
                    translatingCategories[category.categoryId] || false;
                  return (
                    <div
                      key={category.categoryId}
                      className={`flex items-center justify-between p-4 border rounded-lg transition-colors ${
                        isTranslating
                          ? 'border-blue-300 bg-blue-50/50 dark:border-blue-700 dark:bg-blue-900/20'
                          : 'border-gray-100 dark:border-white/5'
                      }`}
                    >
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        <Checkbox
                          checked={selectedCategories.includes(
                            category.categoryId,
                          )}
                          onChange={() =>
                            handleCategorySelect(category.categoryId)
                          }
                          disabled={isTranslating}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="font-medium truncate">
                            {category.categoryName?.zh || category.slug}
                          </div>
                          <div className="text-xs text-gray-500 mt-1">
                            slug: {category.slug}
                          </div>
                          <div className="mt-1">
                            {category.issues?.map((item: any, idx: number) => (
                              <Badge key={idx} color="yellow">
                                {t('issueNotTranslated')}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      </div>
                      <Button
                        variant={isTranslating ? 'outline' : 'primary'}
                        size="sm"
                        isLoading={isTranslating}
                        disabled={isTranslating}
                        onClick={() =>
                          handleTranslateCategory(category.categoryId)
                        }
                      >
                        {isTranslating
                          ? t('translating')
                          : t('translateButton')}
                      </Button>
                    </div>
                  );
                })}
              </div>
            </div>
          </Card>
        )}

      {/* 🏷️ 标签翻译问题 */}
      {translationIssues?.tags && translationIssues.tags.length > 0 && (
        <Card
          title={t('tagIssuesTitle', { count: translationIssues.tags.length })}
        >
          <div className="space-y-3">
            {/* 标签操作栏：全选 + 批量翻译 */}
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Checkbox
                  checked={
                    translationIssues.tags.length > 0 &&
                    selectedTags.length === translationIssues.tags.length
                  }
                  onChange={handleSelectAllTags}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleSelectAllTags}
                  className="text-xs"
                >
                  {selectedTags.length === translationIssues.tags.length
                    ? t('deselectAll')
                    : t('selectAll')}
                </Button>
                <span className="text-sm text-gray-500 ml-1">
                  {t('tagIssuesFound', {
                    count: translationIssues.tags.length,
                  })}
                </span>
              </div>
              <Button
                variant="primary"
                size="sm"
                onClick={handleBatchTranslateTags}
                isLoading={batchTranslatingTags}
                disabled={
                  batchTranslatingTags ||
                  Object.keys(translatingTags).length > 0
                }
              >
                {batchTranslatingTags
                  ? t('translatingProgress', {
                      current:
                        Object.keys(translatingTags).length -
                        Object.values(translatingTags).filter(Boolean).length,
                      total: Object.keys(translatingTags).length,
                    })
                  : selectedTags.length > 0
                    ? t('translateSelected', { count: selectedTags.length })
                    : t('translateAll')}
              </Button>
            </div>

            <div className="grid gap-3">
              {translationIssues.tags.map((tag: any) => {
                const isTranslating = translatingTags[tag.tagId] || false;
                return (
                  <div
                    key={tag.tagId}
                    className={`flex items-center justify-between p-4 border rounded-lg transition-colors ${
                      isTranslating
                        ? 'border-blue-300 bg-blue-50/50 dark:border-blue-700 dark:bg-blue-900/20'
                        : 'border-gray-100 dark:border-white/5'
                    }`}
                  >
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <Checkbox
                        checked={selectedTags.includes(tag.tagId)}
                        onChange={() => handleTagSelect(tag.tagId)}
                        disabled={isTranslating}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">
                          {tag.tagName?.zh || tag.slug}
                        </div>
                        <div className="text-xs text-gray-500 mt-1">
                          slug: {tag.slug}
                        </div>
                        <div className="mt-1">
                          {tag.issues?.map((item: any, idx: number) => (
                            <Badge key={idx} color="yellow">
                              {t('issueNotTranslated')}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    </div>
                    <Button
                      variant={isTranslating ? 'outline' : 'primary'}
                      size="sm"
                      isLoading={isTranslating}
                      disabled={isTranslating}
                      onClick={() => handleTranslateTag(tag.tagId)}
                    >
                      {isTranslating ? t('translating') : t('translateButton')}
                    </Button>
                  </div>
                );
              })}
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
