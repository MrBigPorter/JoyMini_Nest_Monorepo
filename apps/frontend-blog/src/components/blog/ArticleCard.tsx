'use client';

import { useLocale } from 'next-intl';
import { Link } from '@/navigation';
// TODO: Restore published date display — uncomment the two lines below and the JSX block
// import { formatDistanceToNow } from 'date-fns';
// import { getDateFnsLocale } from '@/lib/utils/date-locale';
import { useCallback, useRef, useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import type { Article } from '@/lib/types/blog';
import type { FrontendArticle } from '@/lib/types/frontend-blog';
import { BookmarkIconButton } from '@/lib/components/BookmarkButton';
import { BlurhashImage } from './BlurhashImage';
import { HlsVideoPlayer } from './HlsVideoPlayer';
import { isVideoUrl } from '@/lib/utils/media';
import { setNavDirection } from '@/lib/navigation/direction';
import { Play } from 'lucide-react';
import type { NetworkQuality } from '@/lib/hooks/useNetworkQuality';

/** Format seconds to MM:SS */
function formatDuration(seconds: number): string {
  if (!seconds || seconds <= 0) return '';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

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
  /** 默认封面图片URL (不设置则纯文本时无封面) */
  fallbackImage?: string;
  /** 是否为关键首屏图片，启用 priority + fetchPriority=high */
  priority?: boolean;
  /** P0-3b: Network-aware adaptive quality settings */
  networkQuality?: NetworkQuality;
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
  fallbackImage = '',
  priority = false,
  networkQuality,
}: ArticleCardProps) {
  const router = useRouter();
  const [videoPlaying, setVideoPlaying] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const coverImageUrl = article.coverImage || fallbackImage || '';

  // Predictive image prefetch via IntersectionObserver
  // When card is 200px from viewport, warm the SW cache by loading the image
  useEffect(() => {
    if (!coverImageUrl || priority || isVideoUrl(coverImageUrl)) return;

    const el = cardRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            // Image is about to enter viewport — prefetch into SW cache
            const img = new Image();
            img.src = coverImageUrl;
            // Also add to Service Worker cache via a fetch request
            fetch(coverImageUrl, { mode: 'no-cors' }).catch(() => {
              // Silent fail — SW will still cache if registered
            });
            observer.disconnect();
            break;
          }
        }
      },
      {
        rootMargin: '200px',
        threshold: 0,
      },
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [coverImageUrl, priority]);

  // Check if article has HLS video available (from meta.video.hlsUrl)
  const hlsUrl =
    'meta' in article
      ? (article as FrontendArticle).meta?.video?.hlsUrl
      : undefined;

  /** Click play button → play video inline, prevent navigation */
  // P0-3b: Use adaptive quality from network conditions
  // Note: Don't pass quality for priority images — CDN (img.joyminis.com) rejects ?q=85
  // Use undefined so Next.js applies its default (75) which CDN accepts
  const imageQuality = priority ? undefined : (networkQuality?.quality ?? 65);

  const handlePlayVideo = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const vid = videoRef.current;
    if (!vid) return;
    vid
      .play()
      .then(() => setVideoPlaying(true))
      .catch(() => {});
  }, []);

  const locale = useLocale();
  const [isClient, setIsClient] = useState(false);
  useEffect(() => {
    setIsClient(true);
  }, []);

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

  // 确定宽高比类名
  const aspectRatioClass =
    imageAspect === 'video'
      ? 'aspect-video'
      : imageAspect === 'square'
        ? 'aspect-square'
        : '';

  return (
    <div
      ref={cardRef}
      className={`group relative w-full min-w-0 overflow-hidden bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-700 transition-all hover:shadow-md hover:border-primary/20 transform duration-150 ease-in-out ${
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

      {/* 封面图片 - 顶部位置 (standalone — no Link, clicking plays video) */}
      {showCoverImage && imagePosition === 'top' && (
        <div
          className={`relative overflow-hidden rounded-lg mb-4 ${
            coverImageUrl ? aspectRatioClass : 'aspect-video'
          }`}
        >
          {coverImageUrl ? (
            isVideoUrl(coverImageUrl) ? (
              hlsUrl ? (
                /* HLS video — use HlsVideoPlayer for adaptive streaming */
                <HlsVideoPlayer
                  hlsUrl={hlsUrl}
                  poster={
                    'meta' in article
                      ? (article as FrontendArticle).meta?.video?.poster
                      : undefined
                  }
                  posterWebp={
                    'meta' in article
                      ? (article as FrontendArticle).meta?.video?.posterWebp
                      : undefined
                  }
                  className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                  clickToPlay
                />
              ) : (
                /* Raw video — use native <video> with click-to-play overlay */
                <>
                  <video
                    ref={videoRef}
                    src={coverImageUrl}
                    className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                    muted
                    playsInline
                    preload="metadata"
                    controls={videoPlaying}
                    onPlay={() => setVideoPlaying(true)}
                    onPause={() => {
                      /* keep controls visible after first play */
                    }}
                  />
                  {/* Play button overlay — only shows before first play */}
                  {!videoPlaying && (
                    <button
                      type="button"
                      onClick={handlePlayVideo}
                      className="absolute inset-0 flex items-center justify-center bg-black/20 transition-opacity hover:bg-black/30 cursor-pointer z-10"
                      aria-label="Play video"
                    >
                      <div className="w-12 h-12 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center transition-transform group-hover:scale-110">
                        <Play className="w-6 h-6 text-white fill-white ml-0.5" />
                      </div>
                    </button>
                  )}
                  {/* Duration badge */}
                  {'meta' in article &&
                  (article as FrontendArticle).meta?.video?.duration ? (
                    <span className="absolute bottom-2 right-2 z-20 px-1.5 py-0.5 bg-black/70 backdrop-blur-sm text-white text-[10px] font-medium rounded">
                      {formatDuration(
                        (article as FrontendArticle).meta!.video!.duration,
                      )}
                    </span>
                  ) : null}
                </>
              )
            ) : (
              <Link
                href={`/articles/${article.slug}`}
                className="block w-full h-full"
                prefetch={false}
                onPointerDown={() => {
                  setNavDirection('forward');
                  if (typeof window !== 'undefined') {
                    const path = window.location.pathname;
                    const search = window.location.search;
                    const localePrefix = `/${locale}`;
                    const pathWithoutLocale = path.startsWith(localePrefix)
                      ? path.slice(localePrefix.length) || '/'
                      : path;
                    const savedUrl = pathWithoutLocale + search;
                    sessionStorage.setItem('previousPageUrl', savedUrl);
                  }
                }}
                onMouseEnter={() =>
                  router.prefetch(`/articles/${article.slug}`)
                }
                onTouchStart={() =>
                  router.prefetch(`/articles/${article.slug}`)
                }
              >
                <BlurhashImage
                  src={coverImageUrl}
                  alt={article.title}
                  fill
                  priority={priority}
                  quality={imageQuality}
                  blurhash={
                    'meta' in article
                      ? (article as FrontendArticle).meta?.images?.blurhash
                      : undefined
                  }
                  className="transition-transform duration-300 group-hover:scale-105 cursor-pointer"
                  sizes="(max-width: 768px) 90vw, (max-width: 1024px) 45vw, 600px"
                />
              </Link>
            )
          ) : (
            /* Gradient placeholder for text-only articles — maintains consistent card height */
            <div className="w-full h-full absolute inset-0 bg-gradient-to-br from-slate-100 via-slate-50 to-slate-200 dark:from-slate-800 dark:via-slate-800/50 dark:to-slate-700 flex items-center justify-center">
              <svg
                className="w-12 h-12 text-slate-300 dark:text-slate-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1}
                  d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z"
                />
              </svg>
            </div>
          )}
        </div>
      )}

      {/* 标题 + 摘要 + 元信息 — wrapped in Link for navigation */}
      <Link
        href={`/articles/${article.slug}`}
        className="block min-w-0"
        onPointerDown={() => {
          setNavDirection('forward');
          if (typeof window !== 'undefined') {
            const path = window.location.pathname;
            const search = window.location.search;
            const localePrefix = `/${locale}`;
            const pathWithoutLocale = path.startsWith(localePrefix)
              ? path.slice(localePrefix.length) || '/'
              : path;
            const savedUrl = pathWithoutLocale + search;
            sessionStorage.setItem('previousPageUrl', savedUrl);
          }
        }}
        // P1-2 修复：禁用自动 prefetch，改为 hover/touch 时按需 prefetch
        // 原因：首屏 10 篇文章的 Link 全部进入视口，会立即触发 10 个文章页 prefetch
        //       每个 prefetch 都触发对应页面的 ISR revalidation，造成并发 ISR 风暴
        // 效果：只有用户真正悬停或触摸时才 prefetch，精准预热用户感兴趣的页面
        prefetch={false}
        onMouseEnter={() => router.prefetch(`/articles/${article.slug}`)}
        onTouchStart={() => router.prefetch(`/articles/${article.slug}`)}
      >
        <div className="min-w-0 space-y-3">
          {/* 标题 */}
          <h3
            className={`break-words font-semibold text-slate-800 dark:text-slate-200 group-hover:text-primary-600 dark:group-hover:text-primary-500 transition-colors line-clamp-2 ${
              compact ? 'text-base pr-10' : 'text-lg pr-12'
            }`}
          >
            {article.title}
          </h3>

          {/* 摘要 */}
          {!compact && (
            <p className="break-words text-slate-600 dark:text-slate-400 text-sm leading-relaxed line-clamp-2 mt-1 min-h-[3rem]">
              {article.excerpt}
            </p>
          )}

          {/* 底部元信息 */}
          <div className="flex min-w-0 items-center justify-between gap-3 pt-3 text-xs text-slate-500 dark:text-slate-400">
            <div className="flex min-w-0 items-center gap-3">
              {/* TODO: Restore published date display — hidden to avoid showing outdated dates */}
              {/* <span
                className="flex min-w-0 items-center gap-1"
                suppressHydrationWarning
              >
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
                  isClient
                    ? { addSuffix: true, locale: getDateFnsLocale(locale) }
                    : { addSuffix: true },
                )}
              </span> */}

              {!compact && (
                <>
                  <span className="flex min-w-0 items-center gap-1">
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
              <span className="max-w-[42vw] truncate px-2.5 py-1 bg-primary-50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400 rounded-md text-xs font-medium">
                {category.name}
              </span>
            )}
          </div>
        </div>
      </Link>
    </div>
  );
}
