'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
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

export default function CreateArticlePage() {
  const router = useRouter();
  const { addToast } = useToastStore();
  const { locale } = useLanguage();

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
        await blogApi.createArticle(data);

        addToast('success', 'Article created successfully');
        router.push('/blog/articles');
      } catch (error) {
        console.error('Failed to create article:', error);
        addToast('error', 'Failed to create article');
        throw error;
      }
    },
  });

  const { form, submitHandler, isLoading } = blogForm;
  const { watch, setValue } = form;

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

  const handleTagToggle = (tagId: string) => {
    const currentTagIds = watch('tagIds') || [];
    const newTagIds = currentTagIds.includes(tagId)
      ? currentTagIds.filter((id) => id !== tagId)
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
        title="Create New Article"
        description="Write a new blog article"
        showBackButton={true}
        onBack={() => router.push('/blog/articles')}
        breadcrumbs={['Blog', 'Articles', 'Create']}
        buttonText="Save Article"
        buttonOnClick={handleSaveClick}
        buttonPrefixIcon={
          isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save size={18} />
          )
        }
        buttonDisabled={isLoading || !watch('title.zh') || !watch('content.zh')}
        secondaryButtonText="Cancel"
        secondaryButtonOnClick={() => router.push('/blog/articles')}
        tertiaryButtonText="Publish Article"
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
                placeholder="Write your article content here..."
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

            {/* Submit Buttons */}
            <div className="flex items-center justify-end space-x-4 pt-6 border-t">
              <Link
                href="/blog/articles"
                className="px-4 py-2 text-sm font-medium rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-black/20 hover:bg-gray-50 dark:hover:bg-white/5 text-gray-700 dark:text-gray-200 transition-colors"
              >
                Cancel
              </Link>
              <button
                type="submit"
                disabled={
                  isLoading || !watch('title.zh') || !watch('content.zh')
                }
                className="px-4 py-2 text-sm font-medium rounded-lg bg-primary text-white hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isLoading ? 'Saving...' : 'Save Article'}
              </button>
            </div>
          </form>
        </Form>
      </Card>
    </div>
  );
}
