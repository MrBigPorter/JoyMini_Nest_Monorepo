'use client';

import { Link } from '@/navigation';
import { formatDistanceToNow } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import type { Article } from '@/lib/types/blog';
import type { FrontendArticle } from '@/lib/types/frontend-blog';
import { BookmarkIconButton } from '@/lib/components/BookmarkButton';

interface ArticleCardProps {
  article: Article | FrontendArticle;
  showBookmarkButton?: boolean;
  onBookmarkChange?: (articleId: string, bookmarked: boolean) => void;
  /** 预加载的收藏状态，避免每个卡片单独查询 */
  bookmarkStatus?: {
    isBookmarked?: boolean;
    bookmarkedAt?: string;
  };
  /** 紧凑模式，用于搜索结果等场景 */
  compact?: boolean;
}

export function ArticleCard({
  article,
  showBookmarkButton = true,
  onBookmarkChange,
  bookmarkStatus,
  compact = false,
}: ArticleCardProps) {
  // 处理两种类型的差异
  const publishedDate =
    'publishedAt' in article ? article.publishedAt : (article as any).createdAt;

  const views = 'views' in article ? article.views : 0;
  const commentsCount = 'commentsCount' in article ? article.commentsCount : 0;
  const category = 'category' in article ? article.category : null;

  // 处理收藏状态变化
  const handleBookmarkChange = (bookmarked: boolean) => {
    if (onBookmarkChange) {
      onBookmarkChange(article.id, bookmarked);
    } else {
      // 默认行为：只打印日志
      console.log(
        `文章 ${article.id} 收藏状态: ${bookmarked ? '已收藏' : '未收藏'}`,
      );
    }
  };

  return (
    <div
      className={`group relative bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-700 transition-all hover:shadow-md hover:border-primary/20 transform duration-150 ease-in-out ${
        compact ? 'p-4' : 'p-6'
      }`}
    >
      {/* 收藏按钮 - 右上角，始终显示 */}
      {showBookmarkButton && (
        <div className="absolute top-4 right-4 z-10">
          <BookmarkIconButton
            articleId={article.id}
            size="sm"
            className="opacity-100 md:opacity-100 transition-opacity duration-200 bg-white/80 dark:bg-slate-800/80 backdrop-blur-sm hover:bg-white dark:hover:bg-slate-800"
            onBookmarkChange={handleBookmarkChange}
            bookmarkStatus={bookmarkStatus}
          />
        </div>
      )}

      <Link href={`/articles/${article.slug}`} className="block">
        <div className="space-y-3">
          {/* 标题 */}
          <h3
            className={`font-semibold text-slate-800 dark:text-slate-200 group-hover:text-primary-600 dark:group-hover:text-primary-500 transition-colors line-clamp-2 ${
              compact
                ? 'text-base pr-10'
                : 'text-lg pr-12'
            }`}
          >
            {article.title}
          </h3>

          {/* 摘要 */}
          {!compact && (
            <p className="text-slate-600 dark:text-slate-400 text-sm leading-relaxed line-clamp-2 mt-1">
              {article.excerpt}
            </p>
          )}

          {/* 底部元信息 */}
          <div className="flex items-center justify-between pt-3 text-xs text-slate-500 dark:text-slate-400">
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1">
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                {formatDistanceToNow(
                  new Date(publishedDate || new Date().toISOString()),
                  {
                    addSuffix: true,
                    locale: zhCN,
                  },
                )}
              </span>

              {!compact && (
                <>
                  <span className="flex items-center gap-1">
                    <svg
                      className="w-4 h-4"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                      />
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                      />
                    </svg>
                    {views}
                  </span>

                  <span className="flex items-center gap-1">
                    <svg
                      className="w-4 h-4"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                      />
                    </svg>
                    {commentsCount}
                  </span>
                </>
              )}
            </div>

            {category && !compact && (
              <span className="px-2.5 py-1 bg-primary-50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400 rounded-md text-xs font-medium">
                {category.name}
              </span>
            )}
          </div>
        </div>
      </Link>
    </div>
  );
}
