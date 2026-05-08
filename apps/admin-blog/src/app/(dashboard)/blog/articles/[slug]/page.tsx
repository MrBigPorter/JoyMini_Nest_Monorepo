'use client';

import { useMemo } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useRequest } from 'ahooks';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import { PrismLight as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import {
  ArrowLeft,
  Eye,
  Clock,
  // TODO: Restore published date display — uncomment Calendar when date is shown again
  // Calendar,
  User,
  Heart,
  MessageSquare,
  Tag,
  FileText,
  Info,
  Loader2,
  AlertCircle,
  BookOpen,
} from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import { useLanguage, getLocalizedValue } from '@/hooks/LanguageProvider';
import { blogApi } from '@/api';
import { Card, Badge, Skeleton } from '@/components/UIComponents';
import { PageHeader } from '@/components/scaffold/PageHeader';
import { SmartImage } from '@/components/ui/SmartImage';
import { Button } from '@repo/ui';
import type { Locale } from '@lucky/shared';

// Register commonly used Prism languages for syntax highlighting
import typescript from 'react-syntax-highlighter/dist/esm/languages/prism/typescript';
import javascript from 'react-syntax-highlighter/dist/esm/languages/prism/javascript';
import tsx from 'react-syntax-highlighter/dist/esm/languages/prism/tsx';
import jsx from 'react-syntax-highlighter/dist/esm/languages/prism/jsx';
import bash from 'react-syntax-highlighter/dist/esm/languages/prism/bash';
import json from 'react-syntax-highlighter/dist/esm/languages/prism/json';
import css from 'react-syntax-highlighter/dist/esm/languages/prism/css';
import scss from 'react-syntax-highlighter/dist/esm/languages/prism/scss';
import yaml from 'react-syntax-highlighter/dist/esm/languages/prism/yaml';
import sql from 'react-syntax-highlighter/dist/esm/languages/prism/sql';
import markdown from 'react-syntax-highlighter/dist/esm/languages/prism/markdown';
import python from 'react-syntax-highlighter/dist/esm/languages/prism/python';
import go from 'react-syntax-highlighter/dist/esm/languages/prism/go';
import java from 'react-syntax-highlighter/dist/esm/languages/prism/java';
import docker from 'react-syntax-highlighter/dist/esm/languages/prism/docker';
import nginx from 'react-syntax-highlighter/dist/esm/languages/prism/nginx';
import graphql from 'react-syntax-highlighter/dist/esm/languages/prism/graphql';

SyntaxHighlighter.registerLanguage('typescript', typescript);
SyntaxHighlighter.registerLanguage('javascript', javascript);
SyntaxHighlighter.registerLanguage('tsx', tsx);
SyntaxHighlighter.registerLanguage('jsx', jsx);
SyntaxHighlighter.registerLanguage('bash', bash);
SyntaxHighlighter.registerLanguage('sh', bash);
SyntaxHighlighter.registerLanguage('shell', bash);
SyntaxHighlighter.registerLanguage('json', json);
SyntaxHighlighter.registerLanguage('css', css);
SyntaxHighlighter.registerLanguage('scss', scss);
SyntaxHighlighter.registerLanguage('yaml', yaml);
SyntaxHighlighter.registerLanguage('yml', yaml);
SyntaxHighlighter.registerLanguage('sql', sql);
SyntaxHighlighter.registerLanguage('markdown', markdown);
SyntaxHighlighter.registerLanguage('md', markdown);
SyntaxHighlighter.registerLanguage('python', python);
SyntaxHighlighter.registerLanguage('py', python);
SyntaxHighlighter.registerLanguage('go', go);
SyntaxHighlighter.registerLanguage('java', java);
SyntaxHighlighter.registerLanguage('docker', docker);
SyntaxHighlighter.registerLanguage('dockerfile', docker);
SyntaxHighlighter.registerLanguage('nginx', nginx);
SyntaxHighlighter.registerLanguage('graphql', graphql);
SyntaxHighlighter.registerLanguage('gql', graphql);

interface ArticlePreview {
  id: string;
  slug: string;
  title?: string;
  titleLocalized?: Record<string, string>;
  content?: string;
  contentLocalized?: Record<string, string>;
  contentMd?: string;
  contentMdLocalized?: Record<string, string>;
  excerpt?: string;
  excerptLocalized?: Record<string, string>;
  coverImage?: string;
  coverImageLocalized?: Record<string, string>;
  status?: string;
  category?: { id: string; name: Record<string, string> };
  author?: { username?: string; realName?: string };
  tags?: Array<{ id: string; name: Record<string, string> }>;
  publishedAt?: string;
  createdAt?: string;
  updatedAt?: string;
  viewCount?: number;
  likeCount?: number;
  commentCount?: number;
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
  const {
    data: article,
    loading,
    error,
  } = useRequest<ArticlePreview, any[]>(
    () => blogApi.getArticleBySlug(slug, locale),
    {
      refreshDeps: [slug, locale],
      cacheKey: `article-preview-${slug}-${locale}`,
    },
  );

  // Derive localized values - API returns title+titleLocalized, content+contentLocalized etc.
  const localizedTitle = useMemo(
    () =>
      getLocalizedValue(article?.titleLocalized, locale as Locale) ??
      article?.title ??
      '',
    [article?.titleLocalized, article?.title, locale],
  );

  const localizedContent = useMemo(
    () =>
      getLocalizedValue(article?.contentLocalized, locale as Locale) ??
      article?.content ??
      '',
    [article?.contentLocalized, article?.content, locale],
  );

  const localizedContentMd = useMemo(
    () =>
      getLocalizedValue(article?.contentMdLocalized, locale as Locale) ??
      article?.contentMd ??
      '',
    [article?.contentMdLocalized, article?.contentMd, locale],
  );

  const localizedExcerpt = useMemo(
    () =>
      getLocalizedValue(article?.excerptLocalized, locale as Locale) ??
      article?.excerpt ??
      '',
    [article?.excerptLocalized, article?.excerpt, locale],
  );

  const featuredImage = useMemo(
    () =>
      getLocalizedValue(article?.coverImageLocalized, locale as Locale) ??
      article?.coverImage ??
      null,
    [article?.coverImageLocalized, article?.coverImage, locale],
  );

  // Author display name
  const authorName =
    article?.author?.realName ?? article?.author?.username ?? t('admin');

  // Loading state
  if (loading) {
    return (
      <div className="space-y-6">
        <PageHeader
          title={t('preview')}
          breadcrumbs={[
            globalT('content'),
            globalT('breadcrumbArticles'),
            '...',
          ]}
        />
        <Card>
          <div className="p-6 space-y-6">
            {/* Featured image skeleton */}
            <Skeleton variant="rect" className="h-48 w-full rounded-lg" />
            {/* Title skeleton */}
            <Skeleton variant="text" className="h-8 w-3/4" />
            {/* Meta info skeleton */}
            <div className="flex gap-2">
              <Skeleton variant="text" className="w-20 h-6 rounded-full" />
              <Skeleton variant="text" className="w-16 h-6 rounded-full" />
            </div>
            {/* Content skeleton */}
            <div className="space-y-2">
              <Skeleton variant="text" />
              <Skeleton variant="text" className="w-5/6" />
              <Skeleton variant="text" className="w-4/6" />
              <Skeleton variant="text" className="w-3/4" />
              <Skeleton variant="text" className="w-2/3" />
            </div>
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
          breadcrumbs={[
            globalT('content'),
            globalT('breadcrumbArticles'),
            t('preview'),
          ]}
        />
        <Card>
          <div className="flex flex-col items-center justify-center py-20 text-gray-400">
            <AlertCircle className="h-12 w-12 mb-4 text-red-400" />
            <p className="text-lg font-medium text-gray-600 mb-2">
              {t('articleNotFound') || 'Article not found'}
            </p>
            <p className="text-sm text-gray-400 mb-6">
              {error
                ? String(error)
                : t('articleNotFoundDesc') ||
                  'The requested article could not be found.'}
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
        breadcrumbs={[
          globalT('content'),
          globalT('breadcrumbArticles'),
          localizedTitle || t('preview'),
        ]}
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
        <div className="flex items-center gap-3">
          <Badge color={statusBadgeColor(article.status)}>
            {t(article.status?.toLowerCase() ?? '')}
          </Badge>
          <div className="flex items-center gap-2">
            <Eye className="h-4 w-4 text-gray-400" />
            <span className="text-sm text-gray-500 dark:text-gray-400">
              {t('preview')}
            </span>
          </div>
        </div>
      </div>

      {/* Article preview content — styled to match frontend blog detail */}
      <div className="max-w-5xl mx-auto">
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

        {/* Categories & Tags — match frontend layout */}
        <div className="flex flex-wrap items-center gap-3 mb-4">
          {article.category && (
            <Badge color="gray">
              {getLocalizedValue(article.category?.name, locale as Locale) ??
                ''}
            </Badge>
          )}

          {article.tags?.map((tag: any) => (
            <span
              key={tag.id}
              className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700 dark:bg-gray-500/10 dark:text-gray-400 border border-gray-200 dark:border-gray-500/20"
            >
              <Tag className="h-3 w-3" />
              {renderTagName(tag)}
            </span>
          ))}
        </div>

        {/* Article title — match frontend typography */}
        <h1 className="text-3xl md:text-4xl lg:text-5xl font-bold text-gray-900 dark:text-white leading-tight mb-4">
          {localizedTitle}
        </h1>

        {/* Article metadata — match frontend fields */}
        <div className="flex flex-wrap items-center gap-4 text-sm text-gray-500 dark:text-gray-400 mb-8 pb-6 border-b border-gray-100 dark:border-white/10">
          <div className="flex items-center gap-2">
            <User className="h-4 w-4" />
            <span>{authorName}</span>
          </div>

          {/* TODO: Restore published date display — hidden to avoid showing outdated dates */}
          {/* {article.publishedAt && (
            <>
              <span className="text-gray-300 dark:text-white/20">·</span>
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4" />
                <span>
                  {new Date(article.publishedAt).toLocaleDateString(locale, {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                  })}
                </span>
              </div>
            </>
          )} */}

          {(localizedContent || localizedContentMd) && (
            <>
              <span className="text-gray-300 dark:text-white/20">·</span>
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4" />
                <span>{article.readTime || t('min')}</span>
              </div>
            </>
          )}

          {/* Views — match frontend */}
          <div className="flex items-center gap-1">
            <Eye className="h-4 w-4" />
            <span>{article.viewCount ?? 0}</span>
          </div>

          {/* Likes — match frontend */}
          <div className="flex items-center gap-1">
            <Heart className="h-4 w-4" />
            <span>{article.likeCount ?? 0}</span>
          </div>

          {/* Comments — match frontend */}
          <div className="flex items-center gap-1">
            <MessageSquare className="h-4 w-4" />
            <span>{article.commentCount ?? 0}</span>
          </div>
        </div>

        {/* Article content — render with syntax highlighting */}
        {localizedContent || localizedContentMd ? (
          <ArticleRenderer
            content={localizedContentMd || localizedContent || ''}
          />
        ) : (
          <div className="flex items-center justify-center py-12 text-gray-400">
            <Info className="h-5 w-5 mr-2" />
            <p className="text-sm">{globalT('common_noData')}</p>
          </div>
        )}

        {/* Excerpt — kept for admin review purposes */}
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

// ---------------------------------------------------------------------------
// ArticleRenderer: renders markdown (with syntax highlighting) or HTML
// ---------------------------------------------------------------------------
function isHtmlContent(content: string): boolean {
  return /^\s*<\w+[^>]*>/.test(content.trim());
}

function renderTagName(tag: any): string {
  if (typeof tag.name === 'string') return tag.name;
  if (tag.name && typeof tag.name === 'object') {
    // Try common locales
    return (
      tag.name['en'] || tag.name['zh'] || tag.name['ja'] || tag.name['ko'] || ''
    );
  }
  return '';
}

function ArticleRenderer({ content }: { content: string }) {
  // For HTML content, render directly
  if (isHtmlContent(content)) {
    return (
      <article
        className="prose prose-slate dark:prose-invert max-w-none break-words
          prose-headings:font-bold prose-headings:text-gray-900 dark:prose-headings:text-white
          prose-p:text-gray-700 dark:prose-p:text-gray-300
          prose-a:text-primary hover:prose-a:text-primary-600 prose-a:no-underline hover:prose-a:underline
          prose-img:rounded-lg prose-img:mx-auto
          prose-code:bg-gray-100 dark:prose-code:bg-white/10 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded
          prose-pre:bg-gray-900 dark:prose-pre:bg-gray-800 prose-pre:text-gray-100 prose-pre:overflow-x-auto
          prose-hr:border-t prose-hr:border-gray-200 dark:prose-hr:border-gray-700 prose-hr:my-8
          prose-table:w-full prose-table:border-collapse prose-table:border prose-table:border-gray-300 dark:prose-table:border-gray-600
          prose-th:bg-gray-100 dark:prose-th:bg-gray-800 prose-th:border prose-th:border-gray-300 dark:prose-th:border-gray-600 prose-th:px-4 prose-th:py-2 prose-th:text-left
          prose-td:border prose-td:border-gray-300 dark:prose-td:border-gray-600 prose-td:px-4 prose-td:py-2 prose-td:align-top
          prose-blockquote:border-primary prose-blockquote:bg-primary/5 prose-blockquote:px-4 prose-blockquote:py-2 prose-blockquote:rounded-r-lg
          prose-strong:text-gray-900 dark:prose-strong:text-white
          prose-li:my-0 prose-li:border-0"
        dangerouslySetInnerHTML={{ __html: content }}
      />
    );
  }

  // For Markdown content, use ReactMarkdown with full syntax highlighting
  return (
    <article
      className="prose prose-slate dark:prose-invert max-w-none break-words
        prose-headings:font-bold prose-headings:text-gray-900 dark:prose-headings:text-white
        prose-p:text-gray-700 dark:prose-p:text-gray-300
        prose-a:text-primary hover:prose-a:text-primary-600 prose-a:no-underline hover:prose-a:underline
        prose-img:rounded-lg prose-img:mx-auto
        prose-code:bg-gray-100 dark:prose-code:bg-white/10 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded
        prose-pre:bg-gray-900 dark:prose-pre:bg-gray-800 prose-pre:text-gray-100 prose-pre:overflow-x-auto
        prose-hr:border-t prose-hr:border-gray-200 dark:prose-hr:border-gray-700 prose-hr:my-8
        prose-table:w-full prose-table:border-collapse prose-table:border prose-table:border-gray-300 dark:prose-table:border-gray-600
        prose-th:bg-gray-100 dark:prose-th:bg-gray-800 prose-th:border prose-th:border-gray-300 dark:prose-th:border-gray-600 prose-th:px-4 prose-th:py-2 prose-th:text-left
        prose-td:border prose-td:border-gray-300 dark:prose-td:border-gray-600 prose-td:px-4 prose-td:py-2 prose-td:align-top
        prose-blockquote:border-primary prose-blockquote:bg-primary/5 prose-blockquote:px-4 prose-blockquote:py-2 prose-blockquote:rounded-r-lg
        prose-strong:text-gray-900 dark:prose-strong:text-white
        prose-li:my-0 prose-li:border-0"
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw]}
        components={{
          hr() {
            return <hr className="border-0 !border-none h-0 m-0 p-0 !hidden" />;
          },
          code({ className, children, ...props }) {
            const match = /language-(\w+)/.exec(className || '');
            const language = match ? match[1] : '';

            // Only use SyntaxHighlighter for code blocks with a detected language
            if (language) {
              return (
                <SyntaxHighlighter
                  style={oneDark}
                  language={language}
                  PreTag="div"
                  customStyle={{
                    margin: '1em 0',
                    borderRadius: '0.5rem',
                    fontSize: '0.875rem',
                    lineHeight: '1.5',
                  }}
                >
                  {String(children).replace(/\n$/, '')}
                </SyntaxHighlighter>
              );
            }

            // Inline code or code block without language — keep default styling
            return (
              <code className={className} {...props}>
                {children}
              </code>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </article>
  );
}
