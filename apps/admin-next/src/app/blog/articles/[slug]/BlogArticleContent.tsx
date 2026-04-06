'use client';

import { Card } from '@/components/UIComponents';
import { Badge } from '@repo/ui';
import {
  Calendar,
  User,
  Eye,
  MessageSquare,
  FolderTree,
  Tag,
} from 'lucide-react';
import DOMPurify from 'dompurify';
import Link from 'next/link';

interface BlogArticleContentProps {
  article: any; // TODO: 定义更精确的类型
}

export default function BlogArticleContent({
  article,
}: BlogArticleContentProps) {
  const formatDate = (dateString?: string | null) => {
    if (!dateString) return '—';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  const getStatusBadge = (status: string) => {
    const normalized = status.toLowerCase();
    switch (normalized) {
      case 'published':
        return <Badge color="green">Published</Badge>;
      case 'draft':
        return <Badge color="gray">Draft</Badge>;
      case 'archived':
        return <Badge color="blue">Archived</Badge>;
      default:
        return <Badge color="gray">{normalized}</Badge>;
    }
  };

  // Sanitize HTML on the client side
  const safeContent = DOMPurify.sanitize(article.content || '', {
    ALLOWED_TAGS: [
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
      'p',
      'br',
      'strong',
      'em',
      'u',
      's',
      'blockquote',
      'code',
      'pre',
      'ul',
      'ol',
      'li',
      'a',
      'img',
      'figure',
      'figcaption',
      'table',
      'thead',
      'tbody',
      'tr',
      'th',
      'td',
      'div',
      'span',
      'hr',
      'sub',
      'sup',
      'mark',
      'del',
      'ins',
    ],
    ALLOWED_ATTR: [
      'href',
      'target',
      'rel',
      'src',
      'alt',
      'title',
      'width',
      'height',
      'class',
      'style',
      'data-*',
      'id',
    ],
    ALLOW_DATA_ATTR: true,
  });

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto">
        {/* Back navigation */}
        <div className="mb-8">
          <Link
            href="/blog/articles"
            className="inline-flex items-center text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
          >
            ← Back to blog
          </Link>
        </div>

        <Card className="p-8">
          {/* Status badge (only show if not published) */}
          {article.status !== 'PUBLISHED' && (
            <div className="mb-6">
              {getStatusBadge(article.status)}
              <p className="text-sm text-amber-600 dark:text-amber-400 mt-2">
                This article is not published yet. This is a preview.
              </p>
            </div>
          )}

          {/* Featured image */}
          {article.featuredImage && (
            <div className="mb-8 rounded-xl overflow-hidden">
              <img
                src={article.featuredImage}
                alt={article.title}
                className="w-full h-auto max-h-96 object-cover"
              />
            </div>
          )}

          {/* Title */}
          <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-4">
            {article.title}
          </h1>

          {/* Meta information */}
          <div className="flex flex-wrap items-center gap-6 text-sm text-gray-500 dark:text-gray-400 mb-8 pb-6 border-b border-gray-200 dark:border-gray-700">
            <div className="flex items-center">
              <User className="h-4 w-4 mr-2" />
              <span>
                {article.author?.username ||
                  article.author?.realName ||
                  'Admin'}
              </span>
            </div>
            <div className="flex items-center">
              <Calendar className="h-4 w-4 mr-2" />
              <span>
                {formatDate(article.publishedAt || article.createdAt)}
              </span>
            </div>
            <div className="flex items-center">
              <Eye className="h-4 w-4 mr-2" />
              <span>{(article.viewCount || 0).toLocaleString()} views</span>
            </div>
            <div className="flex items-center">
              <MessageSquare className="h-4 w-4 mr-2" />
              <span>{article.commentCount || 0} comments</span>
            </div>
            {article.category && (
              <div className="flex items-center">
                <FolderTree className="h-4 w-4 mr-2" />
                <span className="px-2.5 py-1 text-xs rounded-full bg-gray-100 dark:bg-white/5">
                  {article.category.name}
                </span>
              </div>
            )}
          </div>

          {/* Excerpt */}
          {article.excerpt && (
            <div className="mb-8">
              <p className="text-lg text-gray-700 dark:text-gray-300 italic">
                {article.excerpt}
              </p>
            </div>
          )}

          {/* Tags */}
          {article.tags && article.tags.length > 0 && (
            <div className="mb-8 flex flex-wrap gap-2">
              <Tag className="h-4 w-4 mt-1 text-gray-400" />
              {article.tags.map((tag: any) => (
                <span
                  key={tag.id || tag}
                  className="px-3 py-1 text-sm rounded-full border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-black/20 text-gray-600 dark:text-gray-300"
                >
                  {tag.name || tag}
                </span>
              ))}
            </div>
          )}

          {/* Article content */}
          <div
            className="prose dark:prose-invert prose-lg max-w-none"
            dangerouslySetInnerHTML={{ __html: safeContent }}
          />

          {/* Footer */}
          <div className="mt-12 pt-8 border-t border-gray-200 dark:border-gray-700 text-sm text-gray-500 dark:text-gray-400">
            <p>
              Article last updated: {formatDate(article.updatedAt)} • Slug:{' '}
              <code className="bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded">
                {article.slug}
              </code>
            </p>
          </div>
        </Card>
      </div>
    </div>
  );
}
