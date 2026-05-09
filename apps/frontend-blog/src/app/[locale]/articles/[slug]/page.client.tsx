'use client';

import React, { useMemo, useCallback } from 'react';
import { setNavDirection, getNavDirection } from '@/lib/navigation/direction';
import Image from 'next/image';
import { useParams } from 'next/navigation';
import { useRouter } from '@/navigation';
import { useLocale, useTranslations } from 'next-intl';
import {
  // TODO: Restore published date display — uncomment Calendar when date is shown again
  // Calendar,
  Clock,
  Eye,
  Heart,
  MessageSquare,
  ArrowLeft,
  BookOpen,
  User,
  Tag,
} from 'lucide-react';
import { useFrontendArticleBySlug } from '@/lib/hooks/useFrontendArticles';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import ArticleMarkdown from '@/components/blog/ArticleMarkdown';
import CommentList from '@/components/blog/CommentList';
import { BookmarkButton } from '@/components/blog/BookmarkButton';
import { useAuth } from '@/lib/hooks';
import { useIsClient } from '@/lib/hooks/useIsClient';

// ---------------------------------------------------------------------------
// Loading placeholder
// ---------------------------------------------------------------------------
function LoadingSkeleton() {
  return (
    <div className="max-w-5xl mx-auto px-4 py-8 md:py-12">
      <Skeleton className="h-10 w-3/4 mb-4" />
      <Skeleton className="h-5 w-1/3 mb-2" />
      <Skeleton className="h-5 w-1/4 mb-8" />
      <Skeleton className="h-64 w-full mb-4" />
      <Skeleton className="h-4 w-full mb-2" />
      <Skeleton className="h-4 w-full mb-2" />
      <Skeleton className="h-4 w-3/4" />
    </div>
  );
}

interface ArticlePageClientProps {
  initialArticle?: any;
}

// ---------------------------------------------------------------------------
// Page client component
// ---------------------------------------------------------------------------
export default function ArticlePageClient({
  initialArticle,
}: ArticlePageClientProps) {
  const params = useParams();
  const locale = useLocale();
  const { isAuthenticated } = useAuth();
  const isClient = useIsClient();
  const router = useRouter();
  const t = useTranslations('article');
  const tc = useTranslations('common');

  const slug = (params?.slug as string) || '';

  const {
    data: article,
    isLoading,
    error,
  } = useFrontendArticleBySlug(slug, initialArticle);

  // 检测文章元数据已加载但正文内容尚未获取（被服务端剥离以节省 Worker CPU）
  const isContentLoading = !!(
    article &&
    !isLoading &&
    !error &&
    !article.content &&
    !article.contentMd
  );

  // -------------------------------------------------------------------
  // Structured data for SEO (JSON-LD)
  // -------------------------------------------------------------------
  const structuredData = useMemo(() => {
    if (!article) return null;
    return {
      '@context': 'https://schema.org',
      '@type': 'Article',
      headline: article.title,
      description: article.excerpt,
      image: article.coverImage,
      datePublished: article.publishedAt,
      dateModified: article.updatedAt,
      author: article.author
        ? {
            '@context': 'https://schema.org',
            '@type': 'Person',
            name: article.author.name,
          }
        : undefined,
    };
  }, [article]);

  // -------------------------------------------------------------------
  // Back navigation handler
  // Navigate to homepage with current locale preserved
  // @/navigation's router.push('/') auto-prepends the active locale (e.g., /ja/)
  // -------------------------------------------------------------------
  const handleBack = useCallback(() => {
    setNavDirection('backward');
    const previousUrl =
      typeof window !== 'undefined'
        ? sessionStorage.getItem('previousPageUrl')
        : null;
    if (previousUrl) {
      router.push(previousUrl, { scroll: false });
      sessionStorage.removeItem('previousPageUrl');
    } else {
      router.push('/', { scroll: false });
    }
  }, [router]);

  // -------------------------------------------------------------------
  // Loading / Error states
  // -------------------------------------------------------------------
  if (isLoading) return <LoadingSkeleton />;

  if (error || !article) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-8 md:py-12">
        <div className="text-center">
          <div className="mb-4">
            <BookOpen className="mx-auto h-16 w-16 text-gray-300 dark:text-gray-600" />
          </div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
            {t('notFound') || 'Article Not Found'}
          </h2>
          <p className="text-gray-500 dark:text-gray-400 mb-6">
            {t('notFoundDescription') ||
              'The article you are looking for does not exist or has been removed.'}
          </p>
          <button
            onClick={handleBack}
            className="inline-flex items-center gap-2 text-primary hover:text-primary-600"
          >
            <ArrowLeft className="h-4 w-4" />
            {tc('backToArticles') || 'Back to Articles'}
          </button>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------------
  // Format helpers
  // -------------------------------------------------------------------
  const formatDate = (dateString: string | null) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleDateString(locale === 'zh' ? 'zh-CN' : 'en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  const calculateReadingTime = (content: string) => {
    const wordsPerMinute = 200;
    const textLength = content?.length || 0;
    const minutes = Math.ceil(textLength / wordsPerMinute);
    return Math.max(1, minutes);
  };

  const readingTime = calculateReadingTime(
    article.contentMd || article.content || '',
  );

  return (
    <>
      {structuredData && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
        />
      )}

      <div className="max-w-5xl mx-auto px-4 py-8 md:py-12">
        {/* Back link — uses router.back() to preserve home page URL search params */}
        <div className="mb-8">
          <button
            onClick={handleBack}
            className="inline-flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 hover:text-primary transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            {tc('backToArticles') || 'Back to Articles'}
          </button>
        </div>

        {/* Header */}
        <header className="mb-10">
          {/* Categories & Tags */}
          <div className="flex flex-wrap items-center gap-3 mb-4">
            {article.category && (
              <Badge variant="secondary">{article.category.name}</Badge>
            )}

            {article.tags?.map((tag: any) => (
              <Badge key={tag.id} variant="outline">
                <Tag className="h-3 w-3 mr-1" />
                {tag.name}
              </Badge>
            ))}
          </div>

          {/* Title */}
          <h1 className="text-3xl md:text-4xl lg:text-5xl font-bold text-gray-900 dark:text-white leading-tight mb-4">
            {article.title}
          </h1>

          {/* Meta */}
          <div className="flex flex-wrap items-center gap-4 text-sm text-gray-500 dark:text-gray-400 mb-4">
            {article.author && (
              <div className="flex items-center gap-2">
                {article.author.avatar ? (
                  <Image
                    src={article.author.avatar}
                    alt={article.author.name}
                    width={24}
                    height={24}
                    className="rounded-full"
                  />
                ) : (
                  <User className="h-4 w-4" />
                )}
                <span>{article.author.name}</span>
              </div>
            )}
            {/* TODO: Restore published date display — hidden to avoid showing outdated dates */}
            {/* {article.publishedAt && (
              <div className="flex items-center gap-1">
                <Calendar className="h-4 w-4" />
                <time dateTime={article.publishedAt}>
                  {formatDate(article.publishedAt)}
                </time>
              </div>
            )} */}
            <div className="flex items-center gap-1">
              <Clock className="h-4 w-4" />
              <span>
                {readingTime} {t('minutes') || 'min read'}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <Eye className="h-4 w-4" />
              <span>{article.views || 0}</span>
            </div>
            <div className="flex items-center gap-1">
              <Heart className="h-4 w-4" />
              <span>{article.likes || 0}</span>
            </div>
            <div className="flex items-center gap-1">
              <MessageSquare className="h-4 w-4" />
              <span>{article.commentsCount || 0}</span>
            </div>
            {/* Action buttons */}
            {isClient && isAuthenticated && (
              <div className="flex items-center gap-1">
                <BookmarkButton articleId={article.id} />
              </div>
            )}
          </div>
        </header>

        {/* Article content — render markdown with syntax highlighting, fall back to HTML */}
        <div className="min-h-[400px]">
          {isContentLoading ? (
            <div
              className="space-y-4 my-8"
              aria-label="Loading article content"
            >
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-11/12" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-32 w-full my-6" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-4/5" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          ) : (
            <ArticleMarkdown
              content={article.contentMd || article.content || ''}
              meta={article.meta}
            />
          )}
        </div>

        {/* Comment system — articleId=slug (REST API), articleDbId=id (SSE 过滤) */}
        {article.slug && (
          <CommentList articleId={article.slug} articleDbId={article.id} />
        )}
      </div>
    </>
  );
}
