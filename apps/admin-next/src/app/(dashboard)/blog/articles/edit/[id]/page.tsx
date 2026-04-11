'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { Save, Send, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useRequest } from 'ahooks';
import { useToastStore } from '@/store/useToastStore';
import { uploadApi, blogApi } from '@/api';
import { RichTextEditor } from '@/components/blog/RichTextEditor';
import { PageHeader } from '@/components/scaffold/PageHeader';
import { Card } from '@/components/UIComponents';
import { useBlogForm } from '@/hooks/useBlogForm';
import { articleSchema, type ArticleFormInputs } from '@/schema/blog';
import {
  Form,
  FormTextField,
  FormTextareaField,
  FormSelectField,
} from '@repo/ui/form';
import { useLanguage } from '@/hooks/LanguageProvider';
import { useLocalizedForm } from '@/hooks/useLocalizedForm';
import { LanguageSwitch } from '@/components/blog/LanguageSwitch';

export default function EditArticlePage() {
  const router = useRouter();
  const params = useParams();
  const { addToast } = useToastStore();
  const { locale } = useLanguage();
  const articleId = params.id as string;

  const [isLoading, setIsLoading] = useState(true);
  const [categories, setCategories] = useState<
    { id: string; name: { zh: string; en: string } }[]
  >([]);
  const [tags, setTags] = useState<
    { id: string; name: { zh: string; en: string } }[]
  >([]);
  const [loadingCategories, setLoadingCategories] = useState(false);
  const [loadingTags, setLoadingTags] = useState(false);

  const blogForm = useBlogForm({
    schema: articleSchema,
    defaultValues: {
      title: { zh: '', en: '' },
      content: { zh: '', en: '' },
      excerpt: { zh: '', en: '' },
      categoryId: '',
      tagIds: [],
      status: 'DRAFT',
    },
    onSubmitAction: async (data: ArticleFormInputs) => {
      try {
        await blogApi.updateArticle(articleId, data);
        addToast('success', 'Article updated successfully');
        router.push('/blog/articles');
      } catch (error) {
        console.error('Failed to update article:', error);
        addToast('error', 'Failed to update article');
        throw error;
      }
    },
  });

  const { form, submitHandler, isLoading: isSubmitting } = blogForm;
  const { watch, setValue, reset } = form;

  const { localize } = useLocalizedForm({
    watch: form.watch,
    setValue: form.setValue,
    errors: form.formState.errors,
    locale,
  });

  // 上传请求
  const upload = useRequest(uploadApi.uploadMedia, {
    manual: true,
  });

  // 富文本编辑器用的上传函数
  const handleEditorUpload = async (file: File): Promise<string> => {
    try {
      const res = await upload.runAsync(file);
      return res.url;
    } catch (error) {
      addToast('error', 'Failed to upload editor image');
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
        addToast('error', 'Failed to load categories/tags');
      } finally {
        setLoadingCategories(false);
        setLoadingTags(false);
      }
    };
    fetchData();
  }, [addToast]);

  // Mock article data (fallback)
  const mockArticle = {
    id: articleId,
    title: {
      zh: 'Next.js 15 New Features Explained',
      en: 'Next.js 15 New Features Explained',
    },
    content: {
      zh: '# Next.js 15 New Features\n\nNext.js 15 introduces several exciting new features...',
      en: '# Next.js 15 New Features\n\nNext.js 15 introduces several exciting new features...',
    },
    excerpt: {
      zh: 'A comprehensive guide to the new features in Next.js 15',
      en: 'A comprehensive guide to the new features in Next.js 15',
    },
    categoryId: '1',
    tagIds: ['1', '3'],
    status: 'PUBLISHED',
    slug: 'nextjs-15-new-features',
    author: 'Admin',
    views: 1250,
    comments: 24,
    publishedAt: '2026-04-01',
  };

  useEffect(() => {
    // Fetch article data from API
    const fetchArticle = async () => {
      setIsLoading(true);

      try {
        const article = await blogApi.getArticle(articleId);
        reset({
          title: article.title,
          content: article.content,
          excerpt: article.excerpt || { zh: '', en: '' },
          categoryId: article.categoryId,
          tagIds: article.tagIds || [],
          status: article.status as ArticleFormInputs['status'],
        });
      } catch (error) {
        console.error('Failed to fetch article:', error);
        addToast('error', 'Failed to load article data');
        reset({
          title: mockArticle.title,
          content: mockArticle.content,
          excerpt: mockArticle.excerpt,
          categoryId: mockArticle.categoryId,
          tagIds: mockArticle.tagIds,
          status: mockArticle.status as ArticleFormInputs['status'],
        });
      } finally {
        setIsLoading(false);
      }
    };

    fetchArticle();
  }, [articleId, reset, addToast]);

  const handleSaveClick = () => {
    const mockEvent = {
      preventDefault: () => {},
    } as React.FormEvent;
    submitHandler(mockEvent);
  };

  const handleTagToggle = (tagId: string) => {
    const currentTagIds = watch('tagIds') || [];
    const newTagIds = currentTagIds.includes(tagId)
      ? currentTagIds.filter((id) => id !== tagId)
      : [...currentTagIds, tagId];
    setValue('tagIds', newTagIds);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
          <p className="mt-4 text-sm text-muted-foreground">
            Loading article...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Edit Article"
        description={`Edit blog article`}
        showBackButton={true}
        onBack={() => router.push('/blog/articles')}
        breadcrumbs={['Blog', 'Articles', 'Edit']}
        buttonText="Save Changes"
        buttonOnClick={handleSaveClick}
        buttonPrefixIcon={
          isSubmitting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save size={18} />
          )
        }
        buttonDisabled={
          isSubmitting || !watch('title.zh') || !watch('content.zh')
        }
        secondaryButtonText="Cancel"
        secondaryButtonOnClick={() => router.push('/blog/articles')}
        tertiaryButtonText={
          watch('status') === 'PUBLISHED' ? 'Update Article' : 'Publish Changes'
        }
        tertiaryButtonOnClick={() => setValue('status', 'PUBLISHED')}
        tertiaryButtonIcon={<Send size={18} />}
        tertiaryButtonVariant="success"
      />

      <Card>
        <Form {...form}>
          <form onSubmit={submitHandler} className="space-y-6">
            <div className="flex justify-between items-center">
              <h3 className="text-sm font-medium">Article Content</h3>
              <LanguageSwitch />
            </div>

            {/* Title */}
            <FormTextField
              label="Article Title *"
              placeholder="Enter article title"
              required
              {...localize('title')}
            />

            {/* Excerpt */}
            <FormTextareaField
              label="Article Excerpt"
              placeholder="Enter article excerpt (optional)"
              {...localize('excerpt')}
            />

            {/* Category */}
            <FormSelectField
              name="categoryId"
              label="Category *"
              placeholder="Select category"
              options={categories.map((c) => ({
                label: c.name[locale] || c.name.zh,
                value: c.id,
              }))}
            />

            {/* Tags */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Tags</label>
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
                      {tag.name[locale] || tag.name.zh}
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

            {/* Content */}
            <div className="space-y-2">
              <RichTextEditor
                value={watch(`content.${locale}`) || ''}
                onChange={(value) => setValue(`content.${locale}`, value)}
                label="Article Content *"
                placeholder="Edit your article content here..."
                required
                onUpload={handleEditorUpload}
                error={
                  !watch(`content.${locale}`)
                    ? 'Article content is required'
                    : undefined
                }
              />
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <div>Rich text editor with image upload support</div>
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
                    # Heading
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
                    **Bold**
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
                    *Italic*
                  </button>
                </div>
              </div>
            </div>

            {/* Article Stats */}
            <div className="rounded-lg border bg-card p-4">
              <h3 className="text-sm font-medium mb-3">Article Statistics</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <p className="text-xs text-muted-foreground">Views</p>
                  <p className="text-lg font-semibold">
                    {mockArticle.views.toLocaleString()}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Comments</p>
                  <p className="text-lg font-semibold">
                    {mockArticle.comments}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Status</p>
                  <p className="text-lg font-semibold capitalize">
                    {watch('status').toLowerCase()}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Published</p>
                  <p className="text-lg font-semibold">
                    {mockArticle.publishedAt}
                  </p>
                </div>
              </div>
            </div>

            {/* Submit Buttons */}
            <div className="flex items-center justify-between space-x-4 pt-6 border-t">
              <div className="flex items-center space-x-2">
                <Link
                  href={`/blog/articles/${mockArticle.slug}`}
                  className="px-4 py-2 text-sm font-medium rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-black/20 hover:bg-gray-50 dark:hover:bg-white/5 text-gray-700 dark:text-gray-200 transition-colors"
                >
                  View Live
                </Link>
                <button
                  type="button"
                  className="px-4 py-2 text-sm font-medium rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-black/20 hover:bg-gray-50 dark:hover:bg-white/5 text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 transition-colors"
                >
                  Delete Article
                </button>
              </div>
              <div className="flex items-center space-x-4">
                <Link
                  href="/blog/articles"
                  className="px-4 py-2 text-sm font-medium rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-black/20 hover:bg-gray-50 dark:hover:bg-white/5 text-gray-700 dark:text-gray-200 transition-colors"
                >
                  Cancel
                </Link>
                <button
                  type="submit"
                  disabled={
                    isSubmitting || !watch('title.zh') || !watch('content.zh')
                  }
                  className="px-4 py-2 text-sm font-medium rounded-lg bg-primary text-white hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {isSubmitting ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </div>
          </form>
        </Form>
      </Card>
    </div>
  );
}
