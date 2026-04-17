'use client';

import { useTranslations } from 'next-intl';
import { ChevronLeft, Clock, Calendar, User, Loader2 } from 'lucide-react';
import { Link } from '@/navigation';
import { useParams } from 'next/navigation';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import CommentList from '@/components/blog/CommentList';
import { BookmarkButton } from '@/lib/components/BookmarkButton';
import { useFrontendArticleBySlug } from '@/lib/hooks/useFrontendArticles';

export default function ArticlePage() {
  const t = useTranslations();
  const params = useParams();
  const slug = params.slug as string;

  const { data: article, isLoading, error } = useFrontendArticleBySlug(slug);

  if (isLoading) {
    return (
      <div className="max-w-[720px] mx-auto px-4 py-20">
        <div className="flex flex-col items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="mt-4 text-slate-500">{t('common.loading')}</p>
        </div>
      </div>
    );
  }

  if (error || !article) {
    return (
      <div className="max-w-[720px] mx-auto px-4 py-20">
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

  // 格式化日期
  const formatDate = (dateString: string | null) => {
    if (!dateString) return t('article.notPublished');
    try {
      return new Date(dateString).toLocaleDateString('zh-CN', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
    } catch {
      return dateString;
    }
  };

  // 计算阅读时间
  const calculateReadingTime = (content: string) => {
    const wordsPerMinute = 200;
    const wordCount = content.split(/\s+/).length;
    const minutes = Math.ceil(wordCount / wordsPerMinute);
    return `${minutes} ${t('article.minutes')}`;
  };

  return (
    <div className="max-w-[720px] mx-auto px-4 py-8 md:py-12">
      {/* 返回按钮 */}
      <div className="mb-8">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronLeft className="w-4 h-4" />
          <span>{t('common.backToHome')}</span>
        </Link>
      </div>

      {/* 文章头部 */}
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
                  `文章 ${article.id} 收藏状态: ${bookmarked ? '已收藏' : '未收藏'}`,
                );
              }}
            />
            <span className="text-xs">收藏</span>
          </div>
        </div>
      </header>

      {/* 文章内容 */}
      <article className="prose prose-slate dark:prose-invert max-w-none">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeRaw]}
          components={{
            h1: ({ children }) => (
              <h1 className="text-4xl font-bold mt-8 mb-6">{children}</h1>
            ),
            h2: ({ children }) => (
              <h2 className="text-3xl font-semibold mt-8 mb-4">{children}</h2>
            ),
            h3: ({ children }) => (
              <h3 className="text-2xl font-semibold mt-6 mb-4">{children}</h3>
            ),
            p: ({ children }) => (
              <p className="mb-6 leading-7 text-justify">{children}</p>
            ),
          }}
        >
          {article.content}
        </ReactMarkdown>
      </article>
      {/* 评论系统 */}
      {article.slug && <CommentList articleId={article.slug} />}
    </div>
  );
}
