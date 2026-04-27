'use client';

import { useTranslations } from 'next-intl';
import dynamic from 'next/dynamic';
import { ChevronLeft, Clock, Calendar, User } from 'lucide-react';
import { Link } from '@/navigation';
import CommentList from '@/components/blog/CommentList';
import { BookmarkButton } from '@/lib/components/BookmarkButton';
import { ArticleDetailSkeleton } from '@/lib/components/SkeletonLoader';
import { useFrontendArticleBySlug } from '@/lib/hooks/useFrontendArticles';
import { generateArticleSchema, injectStructuredData } from '@/lib/seo/schema';
import type { FrontendArticle } from '@/lib/types/frontend-blog';

const ArticleMarkdown = dynamic(
  () => import('@/components/blog/ArticleMarkdown'),
  {
    ssr: false,
    loading: () => (
      <div className="animate-pulse space-y-4 py-8">
        <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-3/4" />
        <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-1/2" />
        <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-5/6" />
        <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-2/3" />
      </div>
    ),
  },
);

interface ArticlePageClientProps {
  initialData: FrontendArticle | null;
  locale: string;
  slug: string;
}

export default function ArticlePageClient({
  initialData,
  locale,
  slug,
}: ArticlePageClientProps) {
  const t = useTranslations();
  const {
    data: article,
    isLoading,
    error,
  } = useFrontendArticleBySlug(slug, initialData);

  // Zero flicker logic: only show skeleton when no initial data
  const hasInitialData = !!initialData;
  const hasCurrentData = !!article;

  if (isLoading && !hasInitialData && !hasCurrentData) {
    return <ArticleDetailSkeleton />;
  }

  if (error || !article) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-20">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white mb-4">
            {t('article.notFound')}
          </h1>
          <p className="text-slate-600 dark:text-slate-400 mb-8">
            {t('article.notFoundDescription')}
          </p>
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-primary hover:text-primary-600 transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
            <span>{t('common.backToHome')}</span>
          </Link>
        </div>
      </div>
    );
  }

  // Format date
  const formatDate = (dateString: string | null) => {
    if (!dateString) return t('article.notPublished');
    try {
      return new Intl.DateTimeFormat(locale, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      }).format(new Date(dateString));
    } catch {
      return dateString;
    }
  };

  // Calculate reading time
  const calculateReadingTime = (content: string) => {
    const wordsPerMinute = 200;
    const wordCount = content.split(/\s+/).length;
    const minutes = Math.ceil(wordCount / wordsPerMinute);
    return `${minutes} ${t('article.minutes')}`;
  };

  // 生成结构化数据
  const articleSchema = article ? generateArticleSchema(article, locale) : null;
  const structuredData = articleSchema
    ? injectStructuredData(articleSchema)
    : '';

  return (
    <>
      {/* 结构化数据注入 */}
      {structuredData && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: structuredData }}
        />
      )}

      <div className="max-w-5xl mx-auto px-4 py-8 md:py-12">
        {/* Back button */}
        <div className="mb-8">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
            <span>{t('common.backToHome')}</span>
          </Link>
        </div>

        {/* Article header */}
        <header className="mb-10">
          <h1 className="text-3xl md:text-4xl lg:text-5xl font-bold mb-6">
            {article.title}
          </h1>

          {article.excerpt && (
            <p className="text-lg text-muted-foreground mb-6">
              {article.excerpt}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
            <div className="flex items-center gap-2">
              <User className="w-4 h-4" />
              <span>{article.author?.name || t('article.anonymous')}</span>
            </div>
            <span className="text-muted-foreground/60">·</span>
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4" />
              <span>{formatDate(article.publishedAt)}</span>
            </div>
            <span className="text-muted-foreground/60">·</span>
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4" />
              <span>{calculateReadingTime(article.content || '')}</span>
            </div>
            <span className="text-muted-foreground/60">·</span>
            <div className="flex items-center gap-2">
              <BookmarkButton
                articleId={article.id}
                size="sm"
                showLabel={false}
                onBookmarkChange={(bookmarked) => {
                  console.log(
                    `Article ${article.id} bookmark status: ${bookmarked ? 'Bookmarked' : 'Not bookmarked'}`,
                  );
                }}
              />
              <span className="text-xs">Bookmark</span>
            </div>
          </div>
        </header>

        {/* Article content — lazy-loaded markdown renderer */}
        <ArticleMarkdown content={article.content || ''} />
        {/* Comment system */}
        {article.slug && <CommentList articleId={article.slug} />}
      </div>
    </>
  );
}
