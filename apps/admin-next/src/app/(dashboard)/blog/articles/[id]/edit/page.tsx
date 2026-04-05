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

export default function EditArticlePage() {
  const router = useRouter();
  const params = useParams();
  const { addToast } = useToastStore();
  const articleId = params.id as string;

  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [categories, setCategories] = useState<{ id: string; name: string }[]>(
    [],
  );
  const [tags, setTags] = useState<{ id: string; name: string }[]>([]);
  const [loadingCategories, setLoadingCategories] = useState(false);
  const [loadingTags, setLoadingTags] = useState(false);

  // 表单
  const onSubmit = async (data: ArticleFormInputs) => {
    setIsSubmitting(true);
    try {
      await blogApi.updateArticle(articleId, data);
      addToast('success', 'Article updated successfully');
      router.push('/blog/articles');
    } catch (error) {
      console.error('Failed to update article:', error);
      addToast('error', 'Failed to update article');
      throw error;
    } finally {
      setIsSubmitting(false);
    }
  };

  const form = useBlogForm({
    schema: articleSchema,
    defaultValues: {
      title: '',
      content: '',
      excerpt: '',
      categoryId: '',
      tagIds: [],
      status: 'draft',
      featuredImage: '',
    },
    onSubmit,
  });
  const { submitHandler, errors, watch, setValue } = form;

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
    title: 'Next.js 15 New Features Explained',
    content:
      '# Next.js 15 New Features\n\nNext.js 15 introduces several exciting new features...',
    excerpt: 'A comprehensive guide to the new features in Next.js 15',
    categoryId: '1',
    tagIds: ['1', '3'],
    status: 'published',
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
        form.reset({
          title: article.title,
          content: article.content,
          excerpt: article.excerpt || '',
          categoryId: article.categoryId,
          tagIds: article.tagIds || [],
          status: article.status as ArticleFormInputs['status'],
          featuredImage: article.featuredImage || '',
        });
      } catch (error) {
        console.error('Failed to fetch article:', error);
        addToast('error', 'Failed to load article data');
        form.reset({
          title: mockArticle.title,
          content: mockArticle.content,
          excerpt: mockArticle.excerpt,
          categoryId: mockArticle.categoryId,
          tagIds: mockArticle.tagIds,
          status: mockArticle.status as ArticleFormInputs['status'],
          featuredImage: '',
        });
      } finally {
        setIsLoading(false);
      }
    };

    fetchArticle();
  }, [articleId]);

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
        description={`Edit blog article: ${mockArticle.slug}`}
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
        buttonDisabled={isSubmitting || !watch('title') || !watch('content')}
        secondaryButtonText="Cancel"
        secondaryButtonOnClick={() => router.push('/blog/articles')}
        tertiaryButtonText={
          watch('status') === 'published' ? 'Update Article' : 'Publish Changes'
        }
        tertiaryButtonOnClick={() => setValue('status', 'published')}
        tertiaryButtonIcon={<Send size={18} />}
        tertiaryButtonVariant="success"
      />

      <form onSubmit={submitHandler} className="space-y-6">
        {/* Title */}
        <div className="space-y-2">
          <label htmlFor="title" className="text-sm font-medium">
            Article Title *
          </label>
          <input
            id="title"
            type="text"
            value={watch('title')}
            onChange={(e) => setValue('title', e.target.value)}
            placeholder="Enter article title"
            className="w-full px-3 py-2.5 border border-gray-200 dark:border-white/10 rounded-lg bg-gray-50 dark:bg-black/20 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500 dark:text-white placeholder-gray-400 dark:placeholder-gray-600"
            required
          />
          <p className="text-xs text-muted-foreground">
            Title will be used to generate URL slug
          </p>
        </div>

        {/* Excerpt */}
        <div className="space-y-2">
          <label htmlFor="excerpt" className="text-sm font-medium">
            Article Excerpt
          </label>
          <textarea
            id="excerpt"
            value={watch('excerpt')}
            onChange={(e) => setValue('excerpt', e.target.value)}
            placeholder="Enter article excerpt (optional)"
            rows={3}
            className="w-full px-3 py-2.5 border border-gray-200 dark:border-white/10 rounded-lg bg-gray-50 dark:bg-black/20 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500 dark:text-white placeholder-gray-400 dark:placeholder-gray-600"
          />
          <p className="text-xs text-muted-foreground">
            Excerpt will be displayed on article list page
          </p>
        </div>

        {/* Category */}
        <div className="space-y-2">
          <label className="text-sm font-medium">Category *</label>
          <div className="flex flex-wrap gap-2">
            {categories.map((category) => (
              <button
                key={category.id}
                type="button"
                onClick={() => setValue('categoryId', category.id)}
                className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${
                  watch('categoryId') === category.id
                    ? 'border-primary bg-primary text-white hover:bg-primary/90'
                    : 'border-gray-200 dark:border-white/10 bg-white dark:bg-black/20 hover:bg-gray-50 dark:hover:bg-white/5 text-gray-700 dark:text-gray-200'
                }`}
              >
                {category.name}
              </button>
            ))}
          </div>
        </div>

        {/* Tags */}
        <div className="space-y-2">
          <label className="text-sm font-medium">Tags</label>
          <div className="flex flex-wrap gap-2">
            {tags.map((tag) => (
              <button
                key={tag.id}
                type="button"
                onClick={() => handleTagToggle(tag.id)}
                className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${
                  (watch('tagIds') || []).includes(tag.id)
                    ? 'border-secondary bg-secondary text-secondary-foreground hover:bg-secondary/80'
                    : 'border-gray-200 dark:border-white/10 bg-white dark:bg-black/20 hover:bg-gray-50 dark:hover:bg-white/5 text-gray-700 dark:text-gray-200'
                }`}
              >
                {tag.name}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="space-y-2">
          <RichTextEditor
            value={watch('content')}
            onChange={(value) => setValue('content', value)}
            label="Article Content *"
            placeholder="Edit your article content here..."
            required
            onUpload={handleEditorUpload}
            error={
              !watch('content') ? 'Article content is required' : undefined
            }
          />
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <div>Rich text editor with image upload support</div>
            <div className="space-x-2">
              <button
                type="button"
                className="hover:text-foreground"
                onClick={() => {
                  const newContent =
                    watch('content') + '\n# Heading\n\nYour content here...';
                  setValue('content', newContent);
                }}
              >
                # Heading
              </button>
              <button
                type="button"
                className="hover:text-foreground"
                onClick={() => {
                  const newContent = watch('content') + ' **bold text** ';
                  setValue('content', newContent);
                }}
              >
                **Bold**
              </button>
              <button
                type="button"
                className="hover:text-foreground"
                onClick={() => {
                  const newContent = watch('content') + ' *italic text* ';
                  setValue('content', newContent);
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
              <p className="text-lg font-semibold">{mockArticle.comments}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Status</p>
              <p className="text-lg font-semibold capitalize">
                {watch('status').toLowerCase()}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Published</p>
              <p className="text-lg font-semibold">{mockArticle.publishedAt}</p>
            </div>
          </div>
        </div>

        {/* Submit Buttons */}
        <div className="flex items-center justify-between space-x-4 pt-6 border-t">
          <div className="flex items-center space-x-2">
            <Link
              href={`/blog/articles/${mockArticle.slug}`}
              target="_blank"
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
              disabled={isSubmitting || !watch('title') || !watch('content')}
              className="px-4 py-2 text-sm font-medium rounded-lg bg-primary text-white hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isSubmitting ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
