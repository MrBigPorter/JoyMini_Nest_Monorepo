'use client';

import { useState } from 'react';
import { useLocale } from 'next-intl';
import { Link } from '@/navigation';
import Image from 'next/image';
import { formatDistanceToNow } from 'date-fns';
import { getDateFnsLocale } from '@/lib/utils/date-locale';
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
  /** 是否显示封面图片 */
  showCoverImage?: boolean;
  /** 图片位置 */
  imagePosition?: 'top' | 'left';
  /** 图片宽高比 */
  imageAspect?: 'video' | 'square' | 'auto';
  /** 默认封面图片URL */
  fallbackImage?: string;
}

export function ArticleCard({
  article,
  showBookmarkButton = true,
  onBookmarkChange,
  bookmarkStatus,
  compact = false,
  showCoverImage = true,
  imagePosition = 'top',
  imageAspect = 'video',
  fallbackImage = 'https://placehold.co/800x450/3b82f6/ffffff?text=Tarsier+Labs+Article',
}: ArticleCardProps) {
  const locale = useLocale();
  const [imageError, setImageError] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);

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

  // 获取封面图片URL
  const coverImageUrl = article.coverImage || fallbackImage;

  // 确定宽高比类名
  const aspectRatioClass =
    imageAspect === 'video'
      ? 'aspect-video'
      : imageAspect === 'square'
        ? 'aspect-square'
        : '';

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
          {/* 封面图片 - 顶部位置 */}
          {showCoverImage && imagePosition === 'top' && coverImageUrl && (
            <div
              className={`relative overflow-hidden rounded-lg mb-4 ${aspectRatioClass}`}
            >
              {/* 图片加载占位符 */}
              {!imageLoaded && !imageError && (
                <div className="absolute inset-0 bg-slate-100 dark:bg-slate-800 animate-pulse" />
              )}

              {/* 图片错误占位符 */}
              {imageError && (
                <div className="absolute inset-0 bg-slate-200 dark:bg-slate-700 flex items-center justify-center">
                  <div className="text-slate-400 dark:text-slate-500 text-center p-4">
                    <svg
                      className="w-12 h-12 mx-auto mb-2"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={1.5}
                        d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                      />
                    </svg>
                    <p className="text-xs">图片加载失败</p>
                  </div>
                </div>
              )}

              {/* 实际图片 */}
              <Image
                src={imageError ? fallbackImage : coverImageUrl}
                alt={article.title}
                fill
                className={`object-cover transition-transform duration-300 group-hover:scale-105 ${
                  imageLoaded ? 'opacity-100' : 'opacity-0'
                }`}
                sizes="(max-width: 768px) 100vw, (max-width: 1024px) 50vw, 33vw"
                quality={85}
                onLoad={() => setImageLoaded(true)}
                onError={() => setImageError(true)}
              />
            </div>
          )}

          {/* 标题 */}
          <h3
            className={`font-semibold text-slate-800 dark:text-slate-200 group-hover:text-primary-600 dark:group-hover:text-primary-500 transition-colors line-clamp-2 ${
              compact ? 'text-base pr-10' : 'text-lg pr-12'
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
                    locale: getDateFnsLocale(locale),
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
