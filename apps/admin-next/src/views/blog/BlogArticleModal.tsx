'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Modal, Button } from '@/components/UIComponents';
import { Globe } from 'lucide-react';
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

interface BlogArticleModalProps {
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
  const t = (key: string, params?: Record<string, string | number>) =>
    globalT(`blog_article_${key}`, params);
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
          addToast('error', 'Failed to load categories/tags');
        } finally {
          setIsLoadingData(false);
        }
      };
      fetchData();
    }
  }, [isOpen, addToast]);

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

  const upload = useRequest(uploadApi.uploadMedia, {
    manual: true,
  });

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
                const res = await upload.runAsync(value);
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

  // 获取启用语言列表 - 在组件顶层调用Hook
  const { enabledLocales } = useAvailableLocales();

  // 编辑文章初始化
  useEffect(() => {
    if (isOpen) {
      if (editingArticle) {
        const mappedArticle: any = editingArticle
          ? {
              ...editingArticle,
              featuredImage:
                (
                  editingArticle as Partial<ArticleFormInputs> & {
                    id: string;
                    coverImage?: string;
                  }
                )?.coverImage ||
                editingArticle.featuredImage ||
                '',
              categoryId:
                (editingArticle as any).categoryId ||
                (editingArticle as any)?.category?.id ||
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

          contentLocalized[locale.code] = content;
        });

        // 直接使用后端返回的标准 Localized 对象，确保所有启用语言都有值
        const titleObj = mappedArticle?.titleLocalized || {};
        const contentObj = contentLocalized;
        const excerptObj = mappedArticle?.excerptLocalized || {};
        const featuredImageObj = mappedArticle?.coverImageLocalized || {};

        // 确保所有启用语言在对象中都有键（即使为空值）
        enabledLocales.forEach((locale) => {
          if (!titleObj[locale.code]) titleObj[locale.code] = '';
          if (!contentObj[locale.code]) contentObj[locale.code] = '';
          if (!excerptObj[locale.code]) excerptObj[locale.code] = '';
          if (!featuredImageObj[locale.code])
            featuredImageObj[locale.code] = '';
        });

        // 重置表单
        reset({
          title: titleObj,
          content: contentObj,
          excerpt: excerptObj,
          featuredImage: featuredImageObj,
          categoryId:
            (mappedArticle as any)?.categoryId ||
            (mappedArticle as any)?.category?.id ||
            '',
          tagIds:
            mappedArticle?.tagIds?.map((t: any) => t.id) ||
            mappedArticle?.tagIds ||
            [],
          status: mappedArticle?.status || 'DRAFT',
        });

        // 延迟初始化子表单，确保子组件已挂载
        setTimeout(() => {
          articleFormRef.current?.reset({
            title: titleObj[currentLocale] ?? '',
            content: contentObj[currentLocale] ?? '',
            excerpt: excerptObj[currentLocale] ?? '',
            featuredImage: featuredImageObj[currentLocale] ?? '',
          });
        }, 0);
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
      reset({
        title: { zh: '', en: '' },
        content: { zh: '', en: '' },
        excerpt: { zh: '', en: '' },
        featuredImage: { zh: '', en: '' },
        categoryId: '',
        tagIds: [],
        status: 'DRAFT',
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

  // Handle image upload for RichTextEditor
  const handleEditorUpload = async (file: File): Promise<string> => {
    try {
      const res = await upload.runAsync(file);
      return res.url;
    } catch (error) {
      addToast('error', 'Failed to upload image');
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
      { label: 'Draft', value: 'DRAFT' },
      { label: 'Published', value: 'PUBLISHED' },
      { label: 'Archived', value: 'ARCHIVED' },
    ],
    [],
  );

  const loading =
    isCreating || isUpdating || isLoading || isLoadingData || upload.loading;

  return (
    <Modal
      size="lg"
      isOpen={isOpen}
      onCloseAction={onCloseAction}
      title={`${isEditing ? 'Edit' : 'Create'} Article`}
    >
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
            onUpload={handleEditorUpload}
            onFieldChange={(field, value) => {
              // 当ArticleForm的字段变化时，同步更新父表单的多语言字段
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
            label="Category"
            placeholder="Select category"
            options={categoryOptions}
          />
          <div className="p-4 border rounded-lg shadow-sm">
            <label className="block text-sm font-medium mb-2">Tags</label>
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
            label="Status"
            options={statusOptions}
          />

          <div className="flex justify-between items-center pt-4">
            <div className="flex flex-1 gap-3 justify-end">
              <Button
                type="button"
                variant="outline"
                onClick={onCloseAction}
                disabled={loading}
              >
                Cancel
              </Button>
              <Button type="submit" isLoading={loading}>
                {isEditing ? 'Update' : 'Publish'}
              </Button>
            </div>
          </div>
        </form>
      </Form>
    </Modal>
  );
};
