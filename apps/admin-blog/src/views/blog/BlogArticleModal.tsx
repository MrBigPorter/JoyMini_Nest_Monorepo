'use client';

// 类型守卫，安全判断 File
function isFile(val: unknown): val is File {
  return typeof File !== 'undefined' && val instanceof File;
}

import React, {
  useState,
  useEffect,
  useRef,
  useMemo,
  useCallback,
} from 'react';
import { Modal, Button } from '@/components/UIComponents';
import { Globe, Loader2 } from 'lucide-react';
import { Form, FormSelectField } from '@repo/ui/form';
import { useBlogLocalizedForm } from '@/hooks/useBlogLocalizedForm';
import { articleSchema, type ArticleFormInputs } from '@/schema/blog';
import { useTranslation } from '@/hooks/useTranslation';
import type { Locale } from '@/hooks/LanguageProvider';
import { useAvailableLocales } from '@/hooks/useAvailableLocales';
import { renderLocalizedText } from '@/utils/localizedText';

import { blogApi, uploadApi } from '@/api';
import { useRequest } from 'ahooks';
import { useToastStore } from '@/store/useToastStore';
import { Marked } from 'marked';

import { ArticleForm, ArticleFormRef } from './ArticleForm';

export interface BlogArticleModalProps {
  isOpen: boolean;
  onCloseAction: () => void;
  editingArticle?: (Partial<ArticleFormInputs> & { id: string }) | null;
  onSuccessAction: () => void;
}

const marked = new Marked({
  gfm: true,
  breaks: true,
  silent: true,
});

export const BlogArticleModal: React.FC<BlogArticleModalProps> = ({
  isOpen,
  onCloseAction,
  editingArticle,
  onSuccessAction,
}) => {
  const isEditing = !!editingArticle;
  const addToast = useToastStore((state) => state.addToast);
  const { t: globalT, lang } = useTranslation();

  // Local blog-article scoped translator
  const t = useCallback(
    (key: string, params?: Record<string, string | number>) =>
      globalT(`blog_article_${key}`, params),
    [globalT],
  );
  const [categories, setCategories] = useState<{ id: string; name: unknown }[]>(
    [],
  );
  const [tags, setTags] = useState<{ id: string; name: unknown }[]>([]);
  const [isLoadingData, setIsLoadingData] = useState(false);
  const [isTranslating, setIsTranslating] = useState(false);

  // (translation helper defined above as blog-article scoped `t`)

  // Fetch categories and tags
  useEffect(() => {
    if (isOpen) {
      const fetchData = async () => {
        setIsLoadingData(true);
        try {
          const [categoriesRes, tagsRes] = await Promise.all([
            blogApi.getCategories(),
            blogApi.getTags(),
          ]);
          setCategories(categoriesRes.list || []);
          setTags(tagsRes.list || []);
        } catch (error) {
          console.error('Failed to fetch categories/tags:', error);
          addToast('error', t('failedLoadData'));
        } finally {
          setIsLoadingData(false);
        }
      };
      fetchData();
    }
  }, [isOpen, addToast, t]);

  const { run: createArticle, loading: isCreating } = useRequest(
    blogApi.createArticle,
    {
      manual: true,
      onSuccess: () => {
        onSuccessAction();
        onCloseAction();
      },
    },
  );

  const { run: updateArticle, loading: isUpdating } = useRequest(
    blogApi.updateArticle,
    {
      manual: true,
      onSuccess: () => {
        onSuccessAction();
        onCloseAction();
      },
    },
  );

  const upload = useRequest(
    async (
      file: File,
      onProgress?: (percent: number) => void,
      extraFields?: Record<string, string>,
    ) => {
      return uploadApi.uploadMedia(file, onProgress, extraFields);
    },
    {
      manual: true,
    },
  );

  // 使用统一的多语言表单钩子
  const blogForm = useBlogLocalizedForm({
    schema: articleSchema,
    defaultValues: undefined, // Don't pass default values here, let useEffect handle it
    onSubmitAction: async (data: any) => {
      try {
        // 处理多语言图片上传
        const processedData = { ...data };

        // 获取当前语言的值
        const currentFeaturedImage = data.featuredImage;

        // 如果featuredImage是字符串（来自ArticleForm），需要转换为多语言对象
        if (typeof currentFeaturedImage === 'string') {
          // 创建一个多语言对象，当前语言设置为字符串值，其他语言为空
          const localizedFeaturedImage: Record<string, string> = {};
          availableLocaleCodes.forEach((lang) => {
            localizedFeaturedImage[lang] =
              lang === currentLocale ? currentFeaturedImage : '';
          });
          processedData.featuredImage = localizedFeaturedImage;
        }

        if (
          processedData.featuredImage &&
          typeof processedData.featuredImage === 'object'
        ) {
          for (const lang of Object.keys(processedData.featuredImage)) {
            const value = (processedData.featuredImage as Record<string, any>)[
              lang
            ];
            if (value && value instanceof File) {
              try {
                // Pass articleId when editing so media processing is triggered
                const extraFields =
                  isEditing && editingArticle?.id
                    ? { articleId: editingArticle.id }
                    : undefined;
                const res = await upload.runAsync(
                  value,
                  undefined,
                  extraFields,
                );
                (processedData.featuredImage as Record<string, any>)[lang] =
                  res.url;
              } catch (uploadError) {
                throw uploadError;
              }
            }
          }
        }

        if (isEditing && editingArticle) {
          await updateArticle(editingArticle.id, processedData);
          // Invoke the async initializer
          fetchAndInit();
        } else {
          await createArticle(processedData);
        }
      } catch (error) {
        throw error;
      }
    },
  });

  const {
    form,
    submitHandler,
    isLoading,
    localize,
    locale: currentLocale,
    availableLocaleCodes,
    handleLocaleChange: baseHandleLocaleChange,
    getFullLocalizedData,
  } = blogForm;
  const { watch, setValue, reset, getValues } = form;

  // 子表单引用
  const articleFormRef = useRef<ArticleFormRef>(null);
  // Track which article id we've initialized the modal with to avoid re-initializing
  // when the parent updates the `editingArticle` object from a list refresh.
  const initializedArticleId = useRef<string | null>(null);

  // 获取启用语言列表 - 在组件顶层调用Hook
  const { enabledLocales } = useAvailableLocales();

  /**
   * 提取为 useCallback，使其在 submit handler 和 useEffect 中均可访问
   * 用于在编辑模式下初始化表单（获取文章完整数据 + 预处理内容 + 重置表单）
   */
  const fetchAndInit = useCallback(async () => {
    if (!editingArticle) return;
    let sourceArticle: any = editingArticle;
    try {
      const hasContentLocalized = !!(
        (editingArticle as any).contentLocalized &&
        Object.keys((editingArticle as any).contentLocalized).length > 0
      );
      const hasContent = !!(editingArticle as any).content;
      if (!hasContentLocalized && !hasContent) {
        // Fetch the full article detail from API
        try {
          const full = await blogApi.getArticle(editingArticle.id);
          if (full) sourceArticle = full;
        } catch (e) {
          console.warn(
            '[BlogArticleModal] failed to fetch full article, falling back to provided editingArticle',
            e,
          );
        }
      }
    } catch (e) {
      console.warn(
        '[BlogArticleModal] error checking editingArticle content',
        e,
      );
    }

    const mappedArticle: any = sourceArticle
      ? {
          ...sourceArticle,
          featuredImage:
            (
              sourceArticle as Partial<ArticleFormInputs> & {
                id: string;
                coverImage?: string;
              }
            )?.coverImage ||
            sourceArticle.featuredImage ||
            '',
          categoryId:
            (sourceArticle as any).categoryId ||
            (sourceArticle as any)?.category?.id ||
            '',
        }
      : null;

    // 预处理内容，解决 MD 混用问题 - 支持所有启用语言
    const contentLocalized: Record<string, string> = {};

    // 处理所有启用语言的内容
    enabledLocales.forEach((locale) => {
      let content = '';
      // 优先使用Localized字段
      if (mappedArticle?.contentLocalized?.[locale.code]) {
        content = mappedArticle.contentLocalized[locale.code];
      } else if (locale.code === 'en' && mappedArticle?.contentEn) {
        content = mappedArticle.contentEn;
      } else if (locale.code === 'zh' && mappedArticle?.content) {
        content = mappedArticle.content;
      }

      // 检查是否需要Markdown解析
      if (content && !/<[a-z][\s\S]*>/i.test(content)) {
        content = marked.parse(content) as string;
      }

      // Only set non-empty content; empty/unset keys pass Zod's localizedStringSchema
      // (which accepts z.undefined() for missing locale keys)
      if (content) {
        contentLocalized[locale.code] = content;
      }
    });

    // 直接使用后端返回的标准 Localized 对象，确保所有启用语言都有值
    // 对于未翻译文章，titleLocalized 可能为 null，此时回退到 titleLocalizedFull
    const titleObj =
      mappedArticle?.titleLocalized || mappedArticle?.titleLocalizedFull || {};
    const contentObj = contentLocalized;
    const excerptObj =
      mappedArticle?.excerptLocalized ||
      mappedArticle?.excerptLocalizedFull ||
      {};
    const featuredImageObj =
      mappedArticle?.coverImageLocalized ||
      mappedArticle?.coverImageLocalizedFull ||
      {};

    // 重置表单
    console.debug(
      '[BlogArticleModal] resetting form with titleObj/contentObj (snippet)',
      {
        titleSnippet: JSON.stringify(titleObj).slice(0, 200),
        contentSnippet: Object.fromEntries(
          Object.entries(contentObj).map(([k, v]) => [
            k,
            String(v).slice(0, 200),
          ]),
        ),
      },
    );
    reset({
      title: titleObj,
      content: contentObj,
      excerpt: excerptObj,
      featuredImage: featuredImageObj,
      categoryId:
        typeof (mappedArticle as any)?.categoryId === 'string'
          ? (mappedArticle as any).categoryId
          : (mappedArticle as any)?.category?.id || '',
      tagIds: Array.isArray(mappedArticle?.tagIds)
        ? mappedArticle.tagIds.map((t: any) =>
            typeof t === 'object' && t !== null && 'id' in t ? t.id : t,
          )
        : Array.isArray(mappedArticle?.tags)
          ? mappedArticle.tags.map((t: any) =>
              typeof t === 'object' && t !== null && 'id' in t ? t.id : t,
            )
          : [],
      status: mappedArticle?.status || 'DRAFT',
      featured: mappedArticle?.featured ?? false,
    });

    // 延迟初始化子表单，确保子组件已挂载
    setTimeout(() => {
      const childResetPayload = {
        title: titleObj[currentLocale] ?? '',
        content: contentObj[currentLocale] ?? '',
        excerpt: excerptObj[currentLocale] ?? '',
        featuredImage: featuredImageObj[currentLocale] ?? '',
      };
      console.debug('[BlogArticleModal] calling articleFormRef.reset with', {
        payloadSnippet: Object.fromEntries(
          Object.entries(childResetPayload).map(([k, v]) => [
            k,
            String(v).slice(0, 200),
          ]),
        ),
      });
      articleFormRef.current?.reset(childResetPayload);
    }, 0);

    // remember we've initialized this id so subsequent list refreshes
    // won't re-initialize the modal with lighter payloads
    try {
      if (mappedArticle?.id) initializedArticleId.current = mappedArticle.id;
    } catch (e) {
      /* ignore */
    }
  }, [editingArticle, enabledLocales, reset, currentLocale]);

  // 使用 ref 持有 fetchAndInit 以避免被加入 useEffect 的依赖数组导致死循环
  const fetchAndInitRef = useRef(fetchAndInit);
  fetchAndInitRef.current = fetchAndInit;

  // 编辑文章初始化 — 使用 ref 调用 fetchAndInit 避免死循环
  useEffect(() => {
    if (isOpen) {
      if (editingArticle) {
        // If we've already initialized this modal with the same article id,
        // skip re-initialization to avoid overwriting the editor content when
        // the parent performs a list refresh that supplies a lightweight
        // editingArticle object.
        if (initializedArticleId.current === editingArticle.id) {
          return;
        }
        // Initialize form with article data (fetchAndInit handles the full flow)
        fetchAndInitRef.current();
      } else {
        // 新建文章时重置所有状态
        reset({
          title: { zh: '', en: '' },
          content: { zh: '', en: '' },
          excerpt: { zh: '', en: '' },
          featuredImage: { zh: '', en: '' },
          categoryId: '',
          tagIds: [],
          status: 'DRAFT',
          featured: false,
        });

        setTimeout(() => {
          articleFormRef.current?.reset({
            title: '',
            content: '',
            excerpt: '',
            featuredImage: '',
          });
        }, 0);
      }
    } else {
      // 弹窗关闭时完全重置表单
      // Clear initialized id so next open will re-initialize
      initializedArticleId.current = null;
      reset({
        title: { zh: '', en: '' },
        content: { zh: '', en: '' },
        excerpt: { zh: '', en: '' },
        featuredImage: { zh: '', en: '' },
        categoryId: '',
        tagIds: [],
        status: 'DRAFT',
        featured: false,
      });

      setTimeout(() => {
        articleFormRef.current?.reset({
          title: '',
          content: '',
          excerpt: '',
          featuredImage: '',
        });
      }, 0);
    }
  }, [isOpen, editingArticle, reset, currentLocale]);

  // 辅助函数：安全提取本地化值
  const getLocalizedValue = (value: any, locale: string): string => {
    if (typeof value === 'string') return value;
    if (value && typeof value === 'object') {
      return value[locale] || value['zh'] || value['en'] || '';
    }
    return '';
  };

  // 包装语言切换函数，同时更新子表单
  const handleLocaleChange = (newLocale: Locale) => {
    if (newLocale === currentLocale) return;

    // 调用基础的语言切换函数
    baseHandleLocaleChange(newLocale);

    // 更新子表单 - 使用安全的本地化值提取
    const currentValues = getValues();
    setTimeout(() => {
      articleFormRef.current?.reset({
        title: getLocalizedValue(currentValues.title, newLocale),
        content: getLocalizedValue(currentValues.content, newLocale),
        excerpt: getLocalizedValue(currentValues.excerpt, newLocale),
        featuredImage: getLocalizedValue(
          currentValues.featuredImage,
          newLocale,
        ),
      });
    }, 0);
  };

  // Handle image/video upload for RichTextEditor
  const handleEditorUpload = async (
    file: File,
    onProgress?: (pct: number) => void,
  ): Promise<string> => {
    try {
      // Pass articleId when editing so media processing is triggered
      const extraFields =
        isEditing && editingArticle?.id
          ? { articleId: editingArticle.id }
          : undefined;
      const res = await upload.runAsync(file, onProgress, extraFields);
      return res.url;
    } catch (error) {
      addToast('error', t('failedUploadImage'));
      throw error;
    }
  };

  // Handle tag selection (multi-select)
  const handleTagToggle = (tagId: string) => {
    const currentTagIds = watch('tagIds') || [];
    const newTagIds = currentTagIds.includes(tagId)
      ? currentTagIds.filter((id) => id !== tagId)
      : [...currentTagIds, tagId];
    setValue('tagIds', newTagIds);
  };

  // 稳定化选项数组，避免每次渲染创建新引用
  const categoryOptions = useMemo(
    () =>
      categories.map((c) => ({
        label: renderLocalizedText(c.name, 'zh', c.id),
        value: c.id,
      })),
    [categories],
  );

  const statusOptions = useMemo(
    () => [
      { label: t('draft'), value: 'DRAFT' },
      { label: t('published'), value: 'PUBLISHED' },
      { label: t('archived'), value: 'ARCHIVED' },
    ],
    [t],
  );

  const loading =
    isCreating || isUpdating || isLoading || isLoadingData || upload.loading;

  return (
    <Modal
      size="lg"
      isOpen={isOpen}
      onCloseAction={onCloseAction}
      title={isEditing ? t('modalTitleEdit') : t('modalTitleCreate')}
    >
      <div className="relative">
        {/* Upload loading overlay - covers modal content during video/image upload */}
        {upload.loading && (
          <div className="absolute inset-0 bg-white/80 dark:bg-gray-900/80 z-50 flex items-center justify-center rounded-lg">
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
              <span className="text-sm text-gray-500 dark:text-gray-400">
                Uploading...
              </span>
            </div>
          </div>
        )}
        <Form {...form}>
          <form onSubmit={submitHandler} className="space-y-6">
            {/* 顶部操作栏 */}
            <div className="flex items-center justify-between mb-4">
              {/* Language Switcher */}
              <div className="flex items-center gap-2">
                <div className="flex gap-2">
                  {availableLocaleCodes.map((lang) => (
                    <Button
                      key={lang}
                      type="button"
                      variant={currentLocale === lang ? 'primary' : 'outline'}
                      size="sm"
                      onClick={() => handleLocaleChange(lang as Locale)}
                    >
                      {lang.toUpperCase()}
                    </Button>
                  ))}
                </div>
                {isEditing ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="flex items-center gap-2"
                    isLoading={isTranslating}
                    onClick={async () => {
                      if (!editingArticle?.id) return;
                      try {
                        setIsTranslating(true);
                        await blogApi.translateArticle(editingArticle.id);
                        addToast('success', t('translationRequestSent'));
                      } catch (error) {
                        console.error('Translation failed:', error);
                        addToast('error', t('translationFailed'));
                      } finally {
                        setIsTranslating(false);
                      }
                    }}
                  >
                    <Globe size={16} />
                    {t('retranslate')}
                  </Button>
                ) : (
                  <div className="text-xs text-gray-500 flex items-center gap-1">
                    <Globe size={14} />
                    {t('autoTranslateAfterSave')}
                  </div>
                )}
              </div>
            </div>

            {/* 独立多语言表单 */}
            <ArticleForm
              ref={articleFormRef}
              onUploadAction={handleEditorUpload}
              onFieldChangeAction={async (field, value) => {
                // 如果featuredImage选择的是File对象，立即上传，不等待提交
                if (field === 'featuredImage' && isFile(value)) {
                  try {
                    const extraFields =
                      isEditing && editingArticle?.id
                        ? { articleId: editingArticle.id }
                        : undefined;
                    const res = await upload.runAsync(
                      value,
                      undefined,
                      extraFields,
                    );
                    const url = res.url;

                    // 直接用上传后的URL更新表单
                    const currentValues = getValues();
                    const localizedField =
                      currentValues[field as keyof typeof currentValues];
                    if (
                      typeof localizedField === 'object' &&
                      localizedField !== null
                    ) {
                      setValue(
                        field as any,
                        {
                          ...localizedField,
                          [currentLocale]: url,
                        },
                        {
                          shouldDirty: true,
                          shouldTouch: true,
                          shouldValidate: true,
                        },
                      );
                    } else {
                      const newLocalized: Record<string, string> = {};
                      availableLocaleCodes.forEach((lang) => {
                        newLocalized[lang] = lang === currentLocale ? url : '';
                      });
                      setValue(field as any, newLocalized, {
                        shouldDirty: true,
                        shouldTouch: true,
                        shouldValidate: true,
                      });
                    }
                    addToast(
                      'success',
                      globalT('blog_articleForm_featuredImage') + ' uploaded',
                    );
                  } catch (error) {
                    console.error('Featured image upload failed:', error);
                    addToast(
                      'error',
                      globalT('blog_article_failedUploadImage'),
                    );
                  }
                  return;
                }

                // 防御：防止空内容或Quill默认值覆盖已有有效内容
                if (
                  (field === 'content' || field === 'excerpt') &&
                  typeof value === 'string' &&
                  (!value || value === '<p><br></p>')
                ) {
                  const currentValues = getValues();
                  const localizedField: Record<string, any> = currentValues[
                    field as keyof typeof currentValues
                  ] as Record<string, any>;
                  if (
                    localizedField &&
                    typeof localizedField === 'object' &&
                    localizedField[currentLocale]
                  ) {
                    // 已有有效内容，跳过更新
                    return;
                  }
                }

                // 普通字段：当ArticleForm的字段变化时，同步更新父表单的多语言字段
                const currentValues = getValues();
                const localizedField =
                  currentValues[field as keyof typeof currentValues];

                // 更新多语言对象中当前语言的值
                if (
                  typeof localizedField === 'object' &&
                  localizedField !== null
                ) {
                  setValue(
                    field as any,
                    {
                      ...localizedField,
                      [currentLocale]: value,
                    },
                    {
                      shouldDirty: true,
                      shouldTouch: true,
                      shouldValidate: true,
                    },
                  );
                } else {
                  // 如果还不是多语言对象，创建一个
                  const newLocalized: Record<string, string> = {};
                  availableLocaleCodes.forEach((lang) => {
                    newLocalized[lang] = lang === currentLocale ? value : '';
                  });
                  setValue(field as any, newLocalized, {
                    shouldDirty: true,
                    shouldTouch: true,
                    shouldValidate: true,
                  });
                }
              }}
            />

            {/* Common Fields - Always Visible */}
            <FormSelectField
              name="categoryId"
              label={t('category')}
              placeholder={t('selectCategory')}
              options={categoryOptions}
            />
            <div className="p-4 border rounded-lg shadow-sm">
              <label className="block text-sm font-medium mb-2">
                {t('tags')}
              </label>
              <div className="flex flex-wrap gap-2">
                {tags.map((tag) => {
                  const selected = (watch('tagIds') || []).includes(tag.id);
                  return (
                    <button
                      key={tag.id}
                      type="button"
                      className={`px-3 py-1.5 rounded-full text-sm border ${
                        selected
                          ? 'bg-primary-500 text-white border-primary-500'
                          : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600'
                      }`}
                      onClick={() => handleTagToggle(tag.id)}
                    >
                      {renderLocalizedText(tag.name, 'zh', tag.id)}
                    </button>
                  );
                })}
              </div>
            </div>
            <FormSelectField
              name="status"
              label={t('status')}
              options={statusOptions}
            />

            {/* Featured Toggle */}
            <div className="flex items-center justify-between p-4 border rounded-lg">
              <div>
                <label className="text-sm font-medium">{t('featured')}</label>
                <p className="text-xs text-gray-500 mt-0.5">
                  {t('featuredDescription')}
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={watch('featured')}
                onClick={() => setValue('featured', !watch('featured'))}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 ${
                  watch('featured')
                    ? 'bg-primary'
                    : 'bg-gray-200 dark:bg-gray-700'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    watch('featured') ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>

            <div className="flex justify-between items-center pt-4">
              <div className="flex flex-1 gap-3 justify-end">
                <Button
                  type="button"
                  variant="outline"
                  onClick={onCloseAction}
                  disabled={loading}
                >
                  {t('cancel')}
                </Button>
                <Button type="submit" isLoading={loading}>
                  {isEditing ? t('update') : t('publish')}
                </Button>
              </div>
            </div>
          </form>
        </Form>
      </div>
    </Modal>
  );
};
