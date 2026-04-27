'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { Link } from '@/navigation';
import { useTranslations } from 'next-intl';
import Hls from 'hls.js';
import type { FrontendArticle } from '@/lib/types/frontend-blog';
import { BlurhashImage } from './BlurhashImage';
import { isVideoUrl } from '@/lib/utils/media';

/** Format seconds to MM:SS display string */
function formatDuration(seconds: number): string {
  if (!seconds || seconds <= 0) return '';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

interface FeaturedProjectsProps {
  articles: FrontendArticle[];
}

/**
 * FeaturedProjects — 首页精选项目轮播
 *
 * 设计要点：
 * - 全宽单卡片轮播，简洁漂亮
 * - Active 卡片如果有 m3u8 视频则显示封面图 + 播放按钮，点击后才加载播放
 * - 切换时销毁上一个 HLS 实例，释放资源
 * - 底部缩略图条提供快速导航
 * - 自动轮播 + 悬停暂停
 * - 跨组件协调：通过 `hls-video-play` 自定义事件确保同时只有一个视频播放
 * - 全面处理边界情况：0项/1项/视频失败/快速点击
 */
export function FeaturedProjects({ articles }: FeaturedProjectsProps) {
  const t = useTranslations();
  const [activeIndex, setActiveIndex] = useState(0);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [userClicked, setUserClicked] = useState(false);
  const [hasError, setHasError] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const currentHlsUrlRef = useRef<string | undefined>(undefined);
  const slideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ─── Auto-play logic ───
  const startAutoPlay = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    // Only auto-play if more than 1 article
    if (articles.length <= 1) return;
    intervalRef.current = setInterval(() => {
      setActiveIndex((prev) => (prev + 1) % articles.length);
    }, 5000);
  }, [articles.length]);

  const stopAutoPlay = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  useEffect(() => {
    startAutoPlay();
    return () => stopAutoPlay();
  }, [startAutoPlay, stopAutoPlay]);

  // ─── Video lifecycle management ───
  const destroyVideo = useCallback(() => {
    // Destroy HLS instance
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
    // Stop native video
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.removeAttribute('src');
      videoRef.current.load();
    }
  }, []);

  /** Initialize HLS.js or native video and start playing (called on user click) */
  const initVideo = useCallback(
    (article: FrontendArticle, videoElement: HTMLVideoElement) => {
      const hlsUrl = article.meta?.video?.hlsUrl;
      const coverIsVideo = isVideoUrl(article.coverImage);

      if (!hlsUrl && !coverIsVideo) return; // No video to play

      videoRef.current = videoElement;

      if (hlsUrl && Hls.isSupported()) {
        // HLS stream — use hls.js
        const hls = new Hls({
          enableWorker: true,
          lowLatencyMode: true,
        });
        hlsRef.current = hls;

        hls.loadSource(hlsUrl);
        hls.attachMedia(videoElement);

        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          videoElement.play().catch(() => {
            // Autoplay blocked — silently fail, poster will show
          });
        });

        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (data.fatal) {
            setHasError(true);
            destroyVideo();
          }
        });
      } else if (hlsUrl && videoElement.canPlayType('application/vnd.apple.mpegurl')) {
        // Native HLS support (Safari)
        videoElement.src = hlsUrl;
        videoElement.play().catch(() => {});
      } else if (coverIsVideo) {
        // Raw video file (mp4, webm, etc.)
        videoElement.src = article.coverImage;
        videoElement.play().catch(() => {});
      }
    },
    [destroyVideo],
  );

  // ─── Cross-component single-video coordination ───
  // Keep a ref to the current article's hlsUrl for the stable event listener
  useEffect(() => {
    const currentArticle = articles[activeIndex];
    currentHlsUrlRef.current = currentArticle?.meta?.video?.hlsUrl;
  }, [activeIndex, articles]);

  // Listen for other videos playing — stop this one
  useEffect(() => {
    const handleOtherVideoPlay = (e: CustomEvent) => {
      const otherHlsUrl = e.detail?.hlsUrl;
      if (otherHlsUrl === currentHlsUrlRef.current) return; // It's us — don't double-stop
      destroyVideo();
      setUserClicked(false);
    };
    window.addEventListener('hls-video-play', handleOtherVideoPlay as EventListener);
    return () => {
      window.removeEventListener('hls-video-play', handleOtherVideoPlay as EventListener);
    };
  }, [destroyVideo]);

  // ─── Handle play button click ───
  const handlePlayClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      if (userClicked) return;

      const currentArticle = articles[activeIndex];
      const hlsUrl = currentArticle?.meta?.video?.hlsUrl;

      // Notify all other video players (HlsVideoPlayer, ArticleCard, etc.) to stop
      window.dispatchEvent(
        new CustomEvent('hls-video-play', { detail: { hlsUrl } }),
      );

      setUserClicked(true);

      // Initialize video on the stored ref
      if (videoRef.current) {
        initVideo(currentArticle, videoRef.current);
      }
    },
    [userClicked, activeIndex, articles, initVideo],
  );

  // ─── Handle slide change ───
  const goToSlide = useCallback(
    (index: number) => {
      if (isTransitioning || index === activeIndex) return;
      if (index < 0 || index >= articles.length) return;

      setIsTransitioning(true);
      // Destroy previous video before switching
      destroyVideo();
      setUserClicked(false);
      setActiveIndex(index);

      // Release transition lock after animation completes
      if (slideTimerRef.current) clearTimeout(slideTimerRef.current);
      slideTimerRef.current = setTimeout(() => {
        setIsTransitioning(false);
      }, 500); // Match CSS transition duration
    },
    [activeIndex, articles.length, isTransitioning, destroyVideo],
  );

  const goNext = useCallback(() => {
    goToSlide((activeIndex + 1) % articles.length);
  }, [activeIndex, articles.length, goToSlide]);

  const goPrev = useCallback(() => {
    goToSlide((activeIndex - 1 + articles.length) % articles.length);
  }, [activeIndex, articles.length, goToSlide]);

  // ─── Page Visibility: pause/resume ───
  useEffect(() => {
    const handleVisibility = () => {
      if (document.hidden) {
        destroyVideo();
        setUserClicked(false);
        stopAutoPlay();
      } else {
        startAutoPlay();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [destroyVideo, stopAutoPlay, startAutoPlay]);

  // ─── Cleanup on unmount ───
  useEffect(() => {
    return () => {
      destroyVideo();
      stopAutoPlay();
      if (slideTimerRef.current) clearTimeout(slideTimerRef.current);
    };
  }, [destroyVideo, stopAutoPlay]);

  // ─── Empty state ───
  if (!articles || articles.length === 0) return null;

  const currentArticle = articles[activeIndex];
  const hasHlsVideo = !!currentArticle?.meta?.video?.hlsUrl;
  const coverIsVideo = isVideoUrl(currentArticle?.coverImage);
  const hasVideo = hasHlsVideo || coverIsVideo;
  const videoDuration = currentArticle?.meta?.video?.duration;
  const posterUrl =
    currentArticle?.meta?.video?.poster ||
    (!isVideoUrl(currentArticle?.coverImage) ? currentArticle?.coverImage : undefined);

  return (
    <section className="mb-12 md:mb-16">
      {/* Section header */}
      <div className="flex items-center justify-between mb-6 px-4 md:px-0">
        <div className="flex items-center gap-3">
          <span className="w-1 h-6 bg-primary rounded-full" />
          <h2 className="text-xl md:text-2xl font-bold text-slate-900 dark:text-white">
            {t('home.featuredProjects') || 'Featured Projects'}
          </h2>
        </div>

        {/* Navigation arrows (desktop only, when >1 slide) */}
        {articles.length > 1 && (
          <div className="hidden md:flex items-center gap-2">
            <button
              onClick={(e) => {
                e.preventDefault();
                goPrev();
              }}
              className="p-2 rounded-full border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors disabled:opacity-30"
              aria-label="Previous project"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <button
              onClick={(e) => {
                e.preventDefault();
                goNext();
              }}
              className="p-2 rounded-full border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors disabled:opacity-30"
              aria-label="Next project"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
        )}
      </div>

      {/* ─── Main carousel ─── */}
      <div
        className="relative overflow-hidden rounded-xl bg-white dark:bg-slate-800 shadow-lg"
        onMouseEnter={stopAutoPlay}
        onMouseLeave={startAutoPlay}
      >
        {/* Slide container — key changes trigger full remount for clean video lifecycle */}
        <div
          className="relative h-[280px] sm:h-[360px] md:h-[420px] lg:h-[480px] transition-opacity duration-500 ease-in-out"
          key={activeIndex}
        >
          {/* ── Media: Video or Image ── */}
          {hasVideo ? (
            <>
              {/* Poster image shown while video is not yet playing or as fallback */}
              {posterUrl ? (
                <BlurhashImage
                  src={posterUrl}
                  alt={currentArticle.title}
                  fill
                  priority={activeIndex === 0}
                  blurhash={currentArticle.meta?.images?.blurhash}
                  sizes="100vw"
                  className="absolute inset-0 w-full h-full object-cover"
                />
              ) : (
                <div className="absolute inset-0 bg-gradient-to-br from-slate-800 via-slate-900 to-slate-950" />
              )}

              {/* Video element — deferred loading until user clicks play */}
              <video
                ref={(el) => {
                  if (el) {
                    videoRef.current = el;
                  }
                }}
                className="absolute inset-0 w-full h-full object-cover"
                poster={posterUrl}
                muted
                playsInline
                preload="none"
              />

              {/* Play button overlay — shown until user clicks, hidden during video play or error */}
              {!userClicked && !hasError && (
                <div
                  className="absolute inset-0 flex items-center justify-center cursor-pointer z-20"
                  onClick={handlePlayClick}
                >
                  <div className="w-16 h-16 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center hover:bg-white/30 transition-all">
                    <svg className="w-8 h-8 text-white ml-1" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  </div>
                </div>
              )}

              {/* Video badge */}
              <div className="absolute top-4 left-4 z-20 flex items-center gap-2">
                <span className="px-2.5 py-1 bg-black/60 backdrop-blur-sm text-white text-xs font-medium rounded-full flex items-center gap-1.5">
                  <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                  {videoDuration ? formatDuration(videoDuration) : t('common.video') || 'Video'}
                </span>
              </div>
            </>
          ) : currentArticle.coverImage ? (
            <BlurhashImage
              src={currentArticle.coverImage}
              alt={currentArticle.title}
              fill
              priority={activeIndex === 0}
              blurhash={currentArticle.meta?.images?.blurhash}
              sizes="100vw"
              className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 hover:scale-105"
            />
          ) : (
            /* Gradient placeholder */
            <div className="absolute inset-0 bg-gradient-to-br from-blue-600 via-indigo-600 to-purple-700" />
          )}

          {/* Gradient overlay */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent" />

          {/* ── Content overlay ── */}
          <div className="absolute bottom-0 left-0 right-0 p-4 md:p-8 lg:p-10">
            <Link
              href={`/articles/${currentArticle.slug}`}
              className="block group/card"
            >
              {/* Category badge */}
              {currentArticle.category && (
                <span className="inline-block px-3 py-1 mb-3 text-xs font-medium text-white bg-blue-600/80 backdrop-blur-sm rounded-full">
                  {currentArticle.category.name}
                </span>
              )}

              {/* Title */}
              <h3 className="text-xl md:text-3xl lg:text-4xl font-bold text-white mb-2 line-clamp-2 group-hover/card:text-blue-200 transition-colors">
                {currentArticle.title}
              </h3>

              {/* Excerpt */}
              {currentArticle.excerpt && (
                <p className="text-sm md:text-base text-white/80 line-clamp-2 mb-3 max-w-2xl">
                  {currentArticle.excerpt}
                </p>
              )}

              {/* Meta info */}
              <div className="flex items-center gap-3 text-xs md:text-sm text-white/60">
                {currentArticle.author?.name && (
                  <>
                    <span className="flex items-center gap-1.5">
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                      </svg>
                      {currentArticle.author.name}
                    </span>
                    <span>·</span>
                  </>
                )}
                <span>
                  {new Date(currentArticle.publishedAt).toLocaleDateString()}
                </span>
                <span>·</span>
                <span>{currentArticle.views} views</span>
              </div>
            </Link>
          </div>
        </div>

        {/* ─── Dot indicators ─── */}
        {articles.length > 1 && (
          <div className="absolute bottom-4 right-4 md:bottom-8 md:right-8 flex gap-2 z-20">
            {articles.map((_, i) => (
              <button
                key={i}
                onClick={(e) => {
                  e.preventDefault();
                  goToSlide(i);
                }}
                className={`w-2 h-2 md:w-3 md:h-3 rounded-full transition-all duration-300 ${
                  i === activeIndex
                    ? 'bg-white scale-110 shadow-sm'
                    : 'bg-white/40 hover:bg-white/60'
                }`}
                aria-label={`Slide ${i + 1}`}
              />
            ))}
          </div>
        )}
      </div>

      {/* ─── Thumbnail strip ─── */}
      {articles.length > 1 && (
        <div className="mt-4 flex gap-3 overflow-x-auto pb-2 px-4 md:px-0 scrollbar-thin scrollbar-thumb-slate-300 dark:scrollbar-thumb-slate-600">
          {articles.map((article, i) => {
            const thumbSrc =
              article.meta?.video?.poster ||
              (!isVideoUrl(article.coverImage) ? article.coverImage : undefined);
            const isActive = i === activeIndex;

            return (
              <button
                key={article.id}
                onClick={() => goToSlide(i)}
                className={`flex-shrink-0 relative w-24 h-16 md:w-32 md:h-20 rounded-lg overflow-hidden transition-all duration-300 ${
                  isActive
                    ? 'ring-2 ring-primary ring-offset-2 ring-offset-background scale-105'
                    : 'opacity-60 hover:opacity-90'
                }`}
                aria-label={`View ${article.title}`}
              >
                {thumbSrc ? (
                  <img
                    src={thumbSrc}
                    alt={article.title}
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <div className="w-full h-full bg-gradient-to-br from-slate-600 to-slate-800 flex items-center justify-center">
                    <svg className="w-5 h-5 text-white/50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z" />
                    </svg>
                  </div>
                )}
                {isActive && (
                  <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
                )}
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

/**
 * Skeleton loader for FeaturedProjects
 */
export function FeaturedProjectsSkeleton() {
  return (
    <section className="mb-12 md:mb-16">
      {/* Section header skeleton */}
      <div className="flex items-center gap-3 mb-6 px-4 md:px-0">
        <div className="w-1 h-6 bg-slate-200 dark:bg-slate-700 rounded-full" />
        <div className="h-7 w-48 bg-slate-200 dark:bg-slate-700 rounded-lg animate-pulse" />
      </div>

      {/* Main carousel skeleton */}
      <div className="rounded-xl overflow-hidden bg-slate-200 dark:bg-slate-700 animate-pulse">
        <div className="h-[280px] sm:h-[360px] md:h-[420px] lg:h-[480px]" />
      </div>

      {/* Thumbnail strip skeleton */}
      <div className="mt-4 flex gap-3 px-4 md:px-0">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="flex-shrink-0 w-24 h-16 md:w-32 md:h-20 rounded-lg bg-slate-200 dark:bg-slate-700 animate-pulse"
          />
        ))}
      </div>
    </section>
  );
}
