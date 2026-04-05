'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { ArrowLeft, Save, Eye, Send, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useRequest } from 'ahooks';
import { useToastStore } from '@/store/useToastStore';
import { uploadApi, blogApi } from '@/api';
import { RichTextEditor } from '@/components/blog/RichTextEditor';

export default function EditArticlePage() {
  const router = useRouter();
  const params = useParams();
  const { addToast } = useToastStore();
  const articleId = params.id as string;

  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [excerpt, setExcerpt] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [status, setStatus] = useState('DRAFT');
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

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

  // Mock data
  const categories = [
    { id: '1', name: 'Technology' },
    { id: '2', name: 'Lifestyle' },
    { id: '3', name: 'Learning' },
  ];

  const tags = [
    { id: '1', name: 'Next.js' },
    { id: '2', name: 'TypeScript' },
    { id: '3', name: 'React' },
    { id: '4', name: 'Tailwind CSS' },
    { id: '5', name: 'Database' },
  ];

  // Mock article data (fallback)
  const mockArticle = {
    id: articleId,
    title: 'Next.js 15 New Features Explained',
    content:
      '# Next.js 15 New Features\n\nNext.js 15 introduces several exciting new features...',
    excerpt: 'A comprehensive guide to the new features in Next.js 15',
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
        setTitle(article.title);
        setContent(article.content);
        setExcerpt(article.excerpt || '');
        setCategoryId(article.categoryId);
        setTagIds(article.tagIds || []);
        setStatus(article.status);
      } catch (error) {
        console.error('Failed to fetch article:', error);
        addToast('error', 'Failed to load article data');
        setContent(mockArticle.content);
        setExcerpt(mockArticle.excerpt);
        setCategoryId(mockArticle.categoryId);
        setTagIds(mockArticle.tagIds);
        setStatus(mockArticle.status);
      } finally {
        setIsLoading(false);
      }
    };

    fetchArticle();
  }, [articleId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      await blogApi.updateArticle(articleId, {
        title,
        content,
        excerpt,
        categoryId,
        tagIds,
        status,
      });

      addToast('success', 'Article updated successfully');
      router.push('/blog/articles');
    } catch (error) {
      console.error('Failed to update article:', error);
      addToast('error', 'Failed to update article');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleTagToggle = (tagId: string) => {
    setTagIds((prev) =>
      prev.includes(tagId)
        ? prev.filter((id) => id !== tagId)
        : [...prev, tagId],
    );
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
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <Link
            href="/blog/articles"
            className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Articles
          </Link>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Edit Article</h1>
            <p className="text-muted-foreground mt-2">
              Edit blog article: {mockArticle.slug}
            </p>
          </div>
        </div>
        <div className="flex items-center space-x-2">
          <button
            type="button"
            onClick={() => setStatus('DRAFT')}
            className={`px-4 py-2 text-sm font-medium rounded-md border ${
              status === 'DRAFT'
                ? 'bg-primary text-primary-foreground border-primary'
                : 'border-input bg-background hover:bg-accent hover:text-accent-foreground'
            }`}
          >
            <Save className="mr-2 h-4 w-4 inline" />
            Save Draft
          </button>
          <button
            type="button"
            onClick={() => setStatus('PUBLISHED')}
            className={`px-4 py-2 text-sm font-medium rounded-md ${
              status === 'PUBLISHED'
                ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                : 'border border-input bg-background hover:bg-accent hover:text-accent-foreground'
            }`}
          >
            <Send className="mr-2 h-4 w-4 inline" />
            {status === 'PUBLISHED' ? 'Update Article' : 'Publish Changes'}
          </button>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Title */}
        <div className="space-y-2">
          <label htmlFor="title" className="text-sm font-medium">
            Article Title *
          </label>
          <input
            id="title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Enter article title"
            className="w-full px-3 py-2 border border-input rounded-md bg-background text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
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
            value={excerpt}
            onChange={(e) => setExcerpt(e.target.value)}
            placeholder="Enter article excerpt (optional)"
            rows={3}
            className="w-full px-3 py-2 border border-input rounded-md bg-background text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
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
                onClick={() => setCategoryId(category.id)}
                className={`px-3 py-1.5 text-sm rounded-md border ${
                  categoryId === category.id
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'border-input bg-background hover:bg-accent hover:text-accent-foreground'
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
                className={`px-3 py-1.5 text-sm rounded-md border ${
                  tagIds.includes(tag.id)
                    ? 'bg-secondary text-secondary-foreground border-secondary'
                    : 'border-input bg-background hover:bg-accent hover:text-accent-foreground'
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
            value={content}
            onChange={setContent}
            label="Article Content *"
            placeholder="Edit your article content here..."
            required
            onUpload={handleEditorUpload}
            error={!content ? 'Article content is required' : undefined}
          />
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <div>Rich text editor with image upload support</div>
            <div className="space-x-2">
              <button
                type="button"
                className="hover:text-foreground"
                onClick={() => {
                  const newContent =
                    content + '\n# Heading\n\nYour content here...';
                  setContent(newContent);
                }}
              >
                # Heading
              </button>
              <button
                type="button"
                className="hover:text-foreground"
                onClick={() => {
                  const newContent = content + ' **bold text** ';
                  setContent(newContent);
                }}
              >
                **Bold**
              </button>
              <button
                type="button"
                className="hover:text-foreground"
                onClick={() => {
                  const newContent = content + ' *italic text* ';
                  setContent(newContent);
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
                {status.toLowerCase()}
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
              className="px-4 py-2 text-sm font-medium rounded-md border border-input bg-background hover:bg-accent hover:text-accent-foreground"
            >
              View Live
            </Link>
            <button
              type="button"
              className="px-4 py-2 text-sm font-medium rounded-md border border-input bg-background hover:bg-accent hover:text-accent-foreground text-destructive"
            >
              Delete Article
            </button>
          </div>
          <div className="flex items-center space-x-4">
            <Link
              href="/blog/articles"
              className="px-4 py-2 text-sm font-medium rounded-md border border-input bg-background hover:bg-accent hover:text-accent-foreground"
            >
              Cancel
            </Link>
            <button
              type="submit"
              disabled={isSubmitting || !title || !content}
              className="px-4 py-2 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
