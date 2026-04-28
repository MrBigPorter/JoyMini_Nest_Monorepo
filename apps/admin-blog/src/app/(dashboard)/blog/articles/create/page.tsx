'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Save, Send, Loader2, Info } from 'lucide-react';
import Link from 'next/link';
import { useRequest } from 'ahooks';
import { useToastStore } from '@/store/useToastStore';
import { uploadApi, blogApi } from '@/api';
import { RichTextEditor } from '@/components/blog/RichTextEditor';
import { PageHeader } from '@/components/scaffold/PageHeader';
import { Card } from '@/components/UIComponents';
import { SmartImage } from '@/components/ui/SmartImage';
import { useBlogLocalizedForm } from '@/hooks/useBlogLocalizedForm';
import { articleSchema, type ArticleFormInputs } from '@/schema/blog';
import {
  Form,
  FormTextField,
  FormTextareaField,
  FormSelectField,
  FormMediaUploaderField,
} from '@repo/ui/form';
import { useLanguage } from '@/hooks/LanguageProvider';
import { LanguageSwitch } from '@/components/blog/LanguageSwitch';
import { useTranslation } from '@/hooks/useTranslation';

export default function CreateArticlePage() {
  const router = useRouter();
  const { addToast } = useToastStore();
  const { locale } = useLanguage();
  const { t: globalT } = useTranslation();
  const t = useCallback(
    (key: string, params?: Record<string, string | number>) =>
      globalT(`blog_createArticle_${key}`, params),
    [globalT],
  );

  const [categories, setCategories] = useState<
    { id: string; name: { zh: string; en: string } }[]
  >([]);
  const [tags, setTags] = useState<
    { id: string; name: { zh: string; en: string } }[]
  >([]);
  const [loadingCategories, setLoadingCategories] = useState(false);
  const [loadingTags, setLoadingTags] = useState(false);

  // Track video file keys uploaded during creation to trigger transcoding after article is created
  const videoKeysRef = useRef<string[]>([]);

  const blogForm = useBlogLocalizedForm({
    schema: articleSchema,
    defaultValues: {
      title: { zh: '', en: '' },
      content: { zh: '', en: '' },
      excerpt: { zh: '', en: '' },
      categoryId: '',
      tagIds: [],
      status: 'DRAFT',
      featured: false,
      featuredImage: {},
    },
    onSubmitAction: async (data: any) => {
      try {
        // 处理精选图片上传
        const processedData = { ...data };
        const featuredImage = data.featuredImage;
        if (featuredImage && typeof featuredImage === 'object') {
          for (const lang of Object.keys(featuredImage)) {
            const value = featuredImage[lang];
            if (value instanceof File) {
              const res = await upload.runAsync(value);
              processedData.featuredImage[lang] = res.url;
            }
          }
        }

        const newArticle = await blogApi.createArticle(processedData);
        const articleId = newArticle.id;

        // Trigger video transcoding for any videos uploaded during creation
        const pendingKeys = videoKeysRef.current;
        videoKeysRef.current = []; // Clear after use
        for (const videoKey of pendingKeys) {
          blogApi
            .triggerVideoTranscode(articleId, videoKey)
            .catch((err: unknown) => {
              console.error(
                `Failed to trigger transcode for ${videoKey}:`,
                err,
              );
            });
        }

        addToast('success', t('toastCreated'));
        router.push('/blog/articles');
      } catch (error) {
        console.error('Failed to create article:', error);
        addToast('error', t('toastCreateFailed'));
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
  } = blogForm;
  const { watch, setValue } = form;

  // 上传请求
  const upload = useRequest(uploadApi.uploadMedia, {
    manual: true,
  });

  // 富文本编辑器用的上传函数
  const handleEditorUpload = async (
    file: File,
    onProgress?: (pct: number) => void,
  ): Promise<string> => {
    try {
      const res = await uploadApi.uploadMedia(file, onProgress);
      // Track video keys to trigger HLS transcoding after article creation
      if (file.type.startsWith('video/') && res.key) {
        videoKeysRef.current.push(res.key);
      }
      return res.url;
    } catch (error) {
      addToast('error', t('toastUploadFailed'));
      throw error;
    }
  };

  // Fetch categories and tags from API
  useEffect(() => {
    const fetchData = async () => {
      setLoadingCategories(true);
      setLoadingTags(true);
      try {
        const [categoriesRes, tagsRes] = await Promise.all([
          blogApi.getCategories(),
          blogApi.getTags(),
        ]);
        setCategories(categoriesRes.list || []);
        setTags(tagsRes.list || []);
      } catch (error) {
        console.error('Failed to fetch categories/tags:', error);
        addToast('error', t('toastLoadFailed'));
      } finally {
        setLoadingCategories(false);
        setLoadingTags(false);
      }
    };
    fetchData();
  }, [addToast, t]);

  const handleTagToggle = (tagId: string) => {
    const currentTagIds = watch('tagIds') || [];
    const newTagIds = currentTagIds.includes(tagId)
      ? currentTagIds.filter((id: string) => id !== tagId)
      : [...currentTagIds, tagId];
    setValue('tagIds', newTagIds);
  };

  const handleSaveClick = () => {
    const mockEvent = {
      preventDefault: () => {},
    } as React.FormEvent;
    submitHandler(mockEvent);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('pageTitle')}
        description={t('pageDescription')}
        showBackButton={true}
        onBack={() => router.push('/blog/articles')}
        breadcrumbs={[
          t('breadcrumbBlog'),
          t('breadcrumbArticles'),
          t('breadcrumbCreate'),
        ]}
        buttonText={t('saveArticle')}
        buttonOnClick={handleSaveClick}
        buttonPrefixIcon={
          isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save size={18} />
          )
        }
        buttonDisabled={isLoading || !watch('title.zh') || !watch('content.zh')}
        secondaryButtonText={t('cancel')}
        secondaryButtonOnClick={() => router.push('/blog/articles')}
        tertiaryButtonText={t('publishArticle')}
        tertiaryButtonOnClick={() => setValue('status', 'PUBLISHED')}
        tertiaryButtonIcon={<Send size={18} />}
        tertiaryButtonVariant="success"
      />

      <Card>
        <Form {...form}>
          <form onSubmit={submitHandler} className="space-y-6">
            <div className="flex justify-between items-center">
              <h3 className="text-sm font-medium">{t('articleContent')}</h3>
              <LanguageSwitch />
            </div>

            {/* Title */}
            <FormTextField
              label={t('articleTitle')}
              placeholder={t('articleTitlePlaceholder')}
              required
              {...localize('title')}
            />

            {/* Excerpt */}
            <FormTextareaField
              label={t('articleExcerpt')}
              placeholder={t('articleExcerptPlaceholder')}
              {...localize('excerpt')}
            />

            {/* Category */}
            <FormSelectField
              name="categoryId"
              label={t('category')}
              placeholder={t('selectCategory')}
              options={categories.map((c) => ({
                label: (c.name as Record<string, string>)[locale] || c.name.zh,
                value: c.id,
              }))}
            />

            {/* Tags */}
            <div className="space-y-2">
              <label className="text-sm font-medium">{t('tags')}</label>
              <div className="flex flex-wrap gap-2">
                {tags.map((tag) => {
                  const selected = (watch('tagIds') || []).includes(tag.id);
                  return (
                    <button
                      key={tag.id}
                      type="button"
                      className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${
                        selected
                          ? 'border-secondary bg-secondary text-secondary-foreground hover:bg-secondary/80'
                          : 'border-gray-200 dark:border-white/10 bg-white dark:bg-black/20 hover:bg-gray-50 dark:hover:bg-white/5 text-gray-700 dark:text-gray-200'
                      }`}
                      onClick={() => handleTagToggle(tag.id)}
                    >
                      {(tag.name as Record<string, string>)[locale] ||
                        tag.name.zh}
                    </button>
                  );
                })}
              </div>
              {form.formState.errors.tagIds?.message && (
                <p className="text-xs text-red-500 mt-1">
                  {form.formState.errors.tagIds.message as string}
                </p>
              )}
            </div>

            {/* Featured Image */}
            <div className="p-4 rounded-lg shadow-sm">
              <FormMediaUploaderField
                {...localize('featuredImage')}
                label={globalT('blog_articleForm_featuredImage')}
                maxFileCount={1}
                renderImage={({ src, alt, className }) => (
                  <SmartImage
                    src={src}
                    alt={alt}
                    width={400}
                    height={400}
                    className={className}
                    imgClassName="w-64 h-64 rounded-md object-cover"
                    layout="constrained"
                  />
                )}
              />
              <p className="text-xs text-gray-500 mt-2 flex items-center gap-1">
                <Info size={12} /> {globalT('blog_articleForm_recommendedSize')}
              </p>
            </div>

            {/* Featured Toggle */}
            <div className="flex items-center justify-between p-4 border rounded-lg">
              <div>
                <label className="text-sm font-medium">
                  {globalT('blog_article_featured')}
                </label>
                <p className="text-xs text-gray-500 mt-0.5">
                  {globalT('blog_article_featuredDescription')}
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={watch('featured') || false}
                onClick={() => setValue('featured', !watch('featured'))}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
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

            {/* Content */}
            <div className="space-y-2">
              <RichTextEditor
                value={watch(`content.${locale}`) || ''}
                onChange={(value) => setValue(`content.${locale}`, value)}
                label={t('articleContentLabel')}
                placeholder={t('articleContentPlaceholder')}
                required
                onUpload={handleEditorUpload}
                error={
                  !watch(`content.${locale}`) ? t('contentRequired') : undefined
                }
              />
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <div>{t('editorDescription')}</div>
                <div className="space-x-2">
                  <button
                    type="button"
                    className="px-2 py-1 text-xs rounded border border-gray-200 dark:border-white/10 bg-white dark:bg-black/20 hover:bg-gray-50 dark:hover:bg-white/5 text-gray-700 dark:text-gray-200 transition-colors"
                    onClick={() => {
                      const newContent =
                        watch(`content.${locale}`) +
                        '\n# Heading\n\nYour content here...';
                      setValue(`content.${locale}`, newContent);
                    }}
                  >
                    {t('headingBtn')}
                  </button>
                  <button
                    type="button"
                    className="px-2 py-1 text-xs rounded border border-gray-200 dark:border-white/10 bg-white dark:bg-black/20 hover:bg-gray-50 dark:hover:bg-white/5 text-gray-700 dark:text-gray-200 transition-colors"
                    onClick={() => {
                      const newContent =
                        watch(`content.${locale}`) + ' **bold text** ';
                      setValue(`content.${locale}`, newContent);
                    }}
                  >
                    {t('boldBtn')}
                  </button>
                  <button
                    type="button"
                    className="px-2 py-1 text-xs rounded border border-gray-200 dark:border-white/10 bg-white dark:bg-black/20 hover:bg-gray-50 dark:hover:bg-white/5 text-gray-700 dark:text-gray-200 transition-colors"
                    onClick={() => {
                      const newContent =
                        watch(`content.${locale}`) + ' *italic text* ';
                      setValue(`content.${locale}`, newContent);
                    }}
                  >
                    {t('italicBtn')}
                  </button>
                </div>
              </div>
            </div>

            {/* Submit Buttons */}
            <div className="flex items-center justify-end space-x-4 pt-6 border-t">
              <Link
                href="/blog/articles"
                className="px-4 py-2 text-sm font-medium rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-black/20 hover:bg-gray-50 dark:hover:bg-white/5 text-gray-700 dark:text-gray-200 transition-colors"
              >
                {t('cancel')}
              </Link>
              <button
                type="submit"
                disabled={
                  isLoading || !watch('title.zh') || !watch('content.zh')
                }
                className="px-4 py-2 text-sm font-medium rounded-lg bg-primary text-white hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isLoading ? t('saving') : t('saveArticle')}
              </button>
            </div>
          </form>
        </Form>
      </Card>
    </div>
  );
}
