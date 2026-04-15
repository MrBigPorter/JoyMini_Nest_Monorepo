'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from '@/navigation';
import { Bookmark, FileText } from 'lucide-react';
import { ArticleCard } from '@/components/blog/ArticleCard';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageSkeleton } from '@/components/ui/PageSkeleton';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { blogApi } from '@/lib/api/blogApi';
import useSWR from 'swr';

export default function BookmarksPage() {
  const t = useTranslations();
  const router = useRouter();

  const { data, isLoading, error } = useSWR(
    '/bookmarks',
    () => blogApi.getBookmarks({ page: 1, pageSize: 12 }),
    {
      revalidateOnFocus: false,
      shouldRetryOnError: false,
    },
  );

  if (isLoading) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-8 md:py-12">
        <PageSkeleton />
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-8 md:py-12">
        <div className="text-center py-16">
          <h2 className="text-xl font-semibold text-red-600 mb-2">
            {t('common.loadFailed')}
          </h2>
          <p className="text-muted-foreground">{t('bookmarks.loadFailed')}</p>
          <button
            onClick={() => window.location.reload()}
            className="mt-4 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
          >
            {t('common.retry')}
          </button>
        </div>
      </div>
    );
  }

  const bookmarks = data?.items || data?.list || [];
  const total = data?.total || 0;

  return (
    <ProtectedRoute>
      <div className="max-w-5xl mx-auto px-4 py-8 md:py-12">
        {/* 页面标题 */}
        <header className="mb-10">
          <div className="flex items-center gap-3 mb-4">
            <Bookmark className="w-8 h-8 text-primary" />
            <h1 className="text-3xl md:text-4xl font-bold">
              {t('bookmarks.title')}
            </h1>
          </div>
          <p className="text-lg text-muted-foreground">
            {t('bookmarks.subtitle')}
          </p>
        </header>

        {/* 收藏文章列表 */}
        {bookmarks.length === 0 ? (
          <EmptyState
            type="bookmarks"
            title={t('bookmarks.emptyTitle')}
            description={t('bookmarks.emptyDescription')}
            actionText={t('bookmarks.browseArticles')}
            onAction={() => router.push('/articles')}
          />
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-16">
              {bookmarks.map((article) => (
                <ArticleCard key={article.id} article={article} />
              ))}
            </div>

            {/* 统计信息 */}
            <div className="p-6 rounded-xl border border-border bg-muted/30">
              <div className="flex items-center gap-3">
                <FileText className="w-5 h-5 text-muted-foreground" />
                <span className="text-muted-foreground">
                  {t('bookmarks.totalCount', {
                    count: total,
                  })}
                </span>
              </div>
            </div>
          </>
        )}
      </div>
    </ProtectedRoute>
  );
}
