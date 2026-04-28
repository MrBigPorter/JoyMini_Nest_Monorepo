'use client';

import { useMemo } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useRequest } from 'ahooks';
import { ArrowLeft, Eye, Clock, Calendar, User, FileText, Info, Loader2, AlertCircle, BookOpen } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import { useLanguage, getLocalizedValue } from '@/hooks/LanguageProvider';
import { blogApi } from '@/api';
import { Card, Badge } from '@/components/UIComponents';
import { PageHeader } from '@/components/scaffold/PageHeader';
import { SmartImage } from '@/components/ui/SmartImage';
import { Button } from '@repo/ui';
import type { Locale } from '@lucky/shared';

interface ArticlePreview {
  id: string;
  slug: string;
  title?: string;
  titleLocalized?: Record<string, string>;
  content?: string;
  contentLocalized?: Record<string, string>;
  excerpt?: string;
  excerptLocalized?: Record<string, string>;
  coverImage?: string;
  coverImageLocalized?: Record<string, string>;
  status?: string;
  category?: { id: string; name: Record<string, string> };
  author?: { username?: string; realName?: string };
  tags?: string[];
  publishedAt?: string;
  createdAt?: string;
  updatedAt?: string;
  viewCount?: number;
  readTime?: string;
}

const statusBadgeColor = (status?: string): 'green' | 'gray' | 'blue' => {
  switch (status) {
    case 'PUBLISHED':
      return 'green';
    case 'DRAFT':
      return 'gray';
    case 'ARCHIVED':
      return 'blue';
    default:
      return 'gray';
  }
};

export default function ArticlePreviewPage() {
  const params = useParams<{ slug: string }>();
  const slug = params?.slug ?? '';
  const { t: globalT, lang } = useTranslation();
  const { locale } = useLanguage();

  // Prefixed translation helper (same pattern as articles/page.tsx)
  const t = (key: string, params?: Record<string, string | number>) =>
    globalT(`blog_articles_${key}`, params);

  // Fetch article by slug
  const { data: article, loading, error } = useRequest<ArticlePreview, any[]>(
    () => blogApi.getArticleBySlug(slug),
    {
      refreshDeps: [slug],
      cacheKey: `article-preview-${slug}`,
    },
  );

  // Derive localized values - API returns title+titleLocalized, content+contentLocalized etc.
  const localizedTitle = useMemo(
    () => getLocalizedValue(article?.titleLocalized, locale as Locale) ?? article?.title ?? '',
    [article?.titleLocalized, article?.title, locale],
  );

  const localizedContent = useMemo(
    () => getLocalizedValue(article?.contentLocalized, locale as Locale) ?? article?.content ?? '',
    [article?.contentLocalized, article?.content, locale],
  );

  const localizedExcerpt = useMemo(
    () => getLocalizedValue(article?.excerptLocalized, locale as Locale) ?? article?.excerpt ?? '',
    [article?.excerptLocalized, article?.excerpt, locale],
  );

  const featuredImage = useMemo(
    () => getLocalizedValue(article?.coverImageLocalized, locale as Locale) ?? article?.coverImage ?? null,
    [article?.coverImageLocalized, article?.coverImage, locale],
  );

  // Author display name
  const authorName = article?.author?.realName ?? article?.author?.username ?? t('admin');

  // Loading state
  if (loading) {
    return (
      <div className="space-y-6">
        <PageHeader
          title={t('preview')}
          breadcrumbs={[globalT('content'), globalT('breadcrumbArticles'), '...']}
        />
        <Card>
          <div className="flex flex-col items-center justify-center py-20 text-gray-400">
            <Loader2 className="h-8 w-8 animate-spin mb-4" />
            <p className="text-sm">{globalT('common_loading') || 'Loading...'}</p>
          </div>
        </Card>
      </div>
    );
  }

  // Error or not found state
  if (error || !article) {
    return (
      <div className="space-y-6">
        <PageHeader
          title={t('preview')}
          breadcrumbs={[globalT('content'), globalT('breadcrumbArticles'), t('preview')]}
        />
        <Card>
          <div className="flex flex-col items-center justify-center py-20 text-gray-400">
            <AlertCircle className="h-12 w-12 mb-4 text-red-400" />
            <p className="text-lg font-medium text-gray-600 mb-2">
              {t('articleNotFound') || 'Article not found'}
            </p>
            <p className="text-sm text-gray-400 mb-6">
              {error ? String(error) : t('articleNotFoundDesc') || 'The requested article could not be found.'}
            </p>
            <Link href="/blog/articles">
              <Button variant="outline">
                <ArrowLeft className="h-4 w-4 mr-2" />
                {t('backToList')}
              </Button>
            </Link>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={localizedTitle || t('preview')}
        breadcrumbs={[globalT('content'), globalT('breadcrumbArticles'), localizedTitle || t('preview')]}
      />

      {/* Back link */}
      <div className="flex items-center justify-between">
        <Link
          href="/blog/articles"
          className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          {t('backToList')}
        </Link>
        <div className="flex items-center gap-2">
          <Eye className="h-4 w-4 text-gray-400" />
          <span className="text-sm text-gray-500 dark:text-gray-400">{t('preview')}</span>
        </div>
      </div>

      {/* Article preview content */}
      <Card>
        <div className="p-6 md:p-8">
          {/* Featured image */}
          {featuredImage && (
            <div className="mb-8 rounded-lg overflow-hidden">
              <SmartImage
                src={featuredImage}
                alt={localizedTitle || 'Article cover'}
                width={1200}
                height={630}
                className="w-full"
                imgClassName="w-full h-auto object-cover max-h-96"
                layout="constrained"
              />
            </div>
          )}

          {/* Article title */}
          <h1 className="text-3xl md:text-4xl font-bold text-gray-900 dark:text-white mb-6">
            {localizedTitle}
          </h1>

          {/* Article metadata */}
          <div className="flex flex-wrap items-center gap-4 text-sm text-gray-500 dark:text-gray-400 mb-8 pb-6 border-b border-gray-100 dark:border-white/10">
            <div className="flex items-center gap-2">
              <User className="h-4 w-4" />
              <span>{authorName}</span>
            </div>

            {article.publishedAt && (
              <>
                <span className="text-gray-300 dark:text-white/20">·</span>
                <div className="flex items-center gap-2">
                  <Calendar className="h-4 w-4" />
                  <span>{new Date(article.publishedAt).toLocaleDateString(locale, {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                  })}</span>
                </div>
              </>
            )}

            {localizedContent && (
              <>
                <span className="text-gray-300 dark:text-white/20">·</span>
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4" />
                  <span>{article.readTime || t('min')}</span>
                </div>
              </>
            )}

            {article.category && (
                <>
                  <span className="text-gray-300 dark:text-white/20">·</span>
                  <div className="flex items-center gap-2">
                    <BookOpen className="h-4 w-4" />
                    <span>{getLocalizedValue(article.category?.name, locale as Locale) ?? ''}</span>
                  </div>
                </>
              )}

            <span className="text-gray-300 dark:text-white/20">·</span>
            <Badge color={statusBadgeColor(article.status)}>{t(article.status?.toLowerCase() ?? '')}</Badge>
          </div>

          {/* Article content */}
          {localizedContent ? (
            <div
              className="prose prose-slate dark:prose-invert max-w-none
                prose-headings:font-bold prose-headings:text-gray-900 dark:prose-headings:text-white
                prose-p:text-gray-700 dark:prose-p:text-gray-300
                prose-a:text-primary hover:prose-a:text-primary-600
                prose-img:rounded-lg prose-img:mx-auto
                prose-code:bg-gray-100 dark:prose-code:bg-white/10 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded
                prose-pre:bg-gray-900 dark:prose-pre:bg-gray-800 prose-pre:text-gray-100
                prose-blockquote:border-primary prose-blockquote:bg-primary/5 prose-blockquote:px-4 prose-blockquote:py-2 prose-blockquote:rounded-r-lg
                prose-strong:text-gray-900 dark:prose-strong:text-white"
              dangerouslySetInnerHTML={{ __html: localizedContent }}
            />
          ) : (
            <div className="flex items-center justify-center py-12 text-gray-400">
              <Info className="h-5 w-5 mr-2" />
              <p className="text-sm">{globalT('common_noData')}</p>
            </div>
          )}

          {/* Excerpt */}
          {localizedExcerpt && (
            <div className="mt-8 p-4 bg-gray-50 dark:bg-white/5 rounded-lg border border-gray-100 dark:border-white/10">
              <div className="flex items-center gap-2 mb-2 text-sm font-medium text-gray-600 dark:text-gray-400">
                <FileText className="h-4 w-4" />
                <span>{t('excerpt') || 'Excerpt'}</span>
              </div>
              <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed">
                {localizedExcerpt}
              </p>
            </div>
          )}
        </div>
      </Card>

      {/* Bottom actions */}
      <div className="flex items-center justify-between">
        <Link
          href="/blog/articles"
          className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          {t('backToList')}
        </Link>
      </div>
    </div>
  );
}
