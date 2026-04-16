'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/navigation';
import { Bookmark, FileText } from 'lucide-react';
import { ArticleCard } from '@/components/blog/ArticleCard';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageSkeleton } from '@/components/ui/PageSkeleton';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { useBookmarksList } from '@/lib/hooks/useBookmarks';
import { frontendBlogApi } from '@/lib/api/frontendBlogApi';
import { useToast } from '@/lib/hooks/useToast';
import type { BookmarkedArticle } from '@/lib/types/frontend-blog';

export default function BookmarksPage() {
  const t = useTranslations();
  const router = useRouter();
  const { success, error: showError } = useToast();
  const [removingArticles, setRemovingArticles] = useState<Set<string>>(
    new Set(),
  );

  // 使用 useBookmarksList Hook 获取收藏列表
  const { data, isLoading, error, refetch } = useBookmarksList({
    page: 1,
    pageSize: 12,
  });

  // 处理取消收藏
  const handleRemoveBookmark = async (articleId: string) => {
    try {
      // 添加到移除中集合
      setRemovingArticles((prev) => new Set(prev).add(articleId));

      // 使用统一的API客户端取消收藏
      await frontendBlogApi.removeBookmark(articleId);

      // 显示成功消息
      success('已取消收藏');

      // 立即从本地数据中移除
      if (data?.items) {
        // 这里我们重新获取数据以确保数据一致性
        // 在实际应用中，可以优化为本地状态更新
        refetch();
      }
    } catch (err) {
      console.error('取消收藏失败:', err);
      showError('取消收藏失败，请稍后重试');
    } finally {
      // 从移除中集合移除
      setRemovingArticles((prev) => {
        const newSet = new Set(prev);
        newSet.delete(articleId);
        return newSet;
      });
    }
  };

  // 处理收藏状态变化
  const handleBookmarkChange = (articleId: string, bookmarked: boolean) => {
    if (!bookmarked) {
      // 如果取消收藏，立即从列表中移除
      handleRemoveBookmark(articleId);
    }
  };

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

  const bookmarks = data?.items || [];
  const total = data?.total || 0;

  // 过滤掉正在移除的文章
  const visibleBookmarks = bookmarks.filter(
    (article) => !removingArticles.has(article.id),
  );

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
        {visibleBookmarks.length === 0 ? (
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
              {visibleBookmarks.map((article: BookmarkedArticle) => (
                <div key={article.id} className="relative">
                  {/* 正在移除的覆盖层 */}
                  {removingArticles.has(article.id) && (
                    <div className="absolute inset-0 bg-background/80 backdrop-blur-sm rounded-lg z-20 flex items-center justify-center">
                      <div className="flex items-center gap-2">
                        <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                        <span className="text-sm text-muted-foreground">
                          取消收藏中...
                        </span>
                      </div>
                    </div>
                  )}
                  <ArticleCard
                    article={article}
                    showBookmarkButton={true}
                    onBookmarkChange={handleBookmarkChange}
                    bookmarkStatus={{
                      isBookmarked: true,
                      bookmarkedAt: article.bookmarkedAt,
                    }}
                  />
                </div>
              ))}
            </div>

            {/* 统计信息 */}
            <div className="p-6 rounded-xl border border-border bg-muted/30">
              <div className="flex items-center gap-3">
                <FileText className="w-5 h-5 text-muted-foreground" />
                <span className="text-muted-foreground">
                  {t('bookmarks.totalCount', {
                    count: total - removingArticles.size, // 减去正在移除的文章
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
