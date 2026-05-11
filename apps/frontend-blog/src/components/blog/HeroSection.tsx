'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { Link } from '@/navigation';
import type { FrontendArticle } from '@/lib/types/frontend-blog';
import { BlurhashImage } from './BlurhashImage';
import { HlsVideoPlayer } from './HlsVideoPlayer';
import { isVideoUrl } from '@/lib/utils/media';

/** Format seconds to MM:SS display string */
function formatDuration(seconds: number): string {
  if (!seconds || seconds <= 0) return '';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

interface HeroSectionProps {
  articles: FrontendArticle[];
}

/**
 * Hero Section for the blog homepage
 * Displays featured articles with rich media support
 * - First article: Large hero card with image/video
 * - Remaining articles: Side grid
 * Responsive: stacks vertically on mobile
 */
export function HeroSection({ articles }: HeroSectionProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startAutoPlay = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(() => {
      setActiveIndex((prev) => (prev + 1) % Math.min(articles.length, 5));
    }, 5000);
  }, [articles.length]);

  const stopAutoPlay = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (articles.length > 1) {
      startAutoPlay();
    }
    return () => stopAutoPlay();
  }, [articles.length, startAutoPlay, stopAutoPlay]);

  if (!articles || articles.length === 0) return null;

  // Take up to 5 articles for the hero
  const heroArticles = articles.slice(0, 5);
  const mainArticle = heroArticles[activeIndex];
  const sideArticles = heroArticles.filter((_, i) => i !== activeIndex);

  const hasHlsVideo = mainArticle?.meta?.video?.hlsUrl;
  const coverIsVideo = isVideoUrl(mainArticle?.coverImage);

  return (
    <section className="mb-12 md:mb-16">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6">
        {/* Main hero card */}
        <div
          className="lg:col-span-2 relative group rounded-xl overflow-hidden bg-white dark:bg-slate-800 shadow-lg"
          onMouseEnter={stopAutoPlay}
          onMouseLeave={startAutoPlay}
        >
          <div className="relative h-[300px] sm:h-[400px] lg:h-[500px]">
            {hasHlsVideo ? (
              <HlsVideoPlayer
                hlsUrl={mainArticle.meta!.video!.hlsUrl}
                poster={
                  mainArticle.meta?.video?.poster ||
                  (!isVideoUrl(mainArticle.coverImage)
                    ? mainArticle.coverImage
                    : undefined)
                }
                posterWebp={mainArticle.meta?.video?.posterWebp}
                className="w-full h-full"
                videoClassName="object-cover"
                autoPlay={false}
                muted
              />
            ) : coverIsVideo ? (
              <video
                src={mainArticle.coverImage}
                className="w-full h-full object-cover"
                controls={false}
                muted
                playsInline
                preload="metadata"
              />
            ) : mainArticle.coverImage ? (
              <BlurhashImage
                src={mainArticle.coverImage}
                alt={mainArticle.title}
                fill
                priority
                blurhash={mainArticle.meta?.images?.blurhash}
                sizes="(max-width: 1024px) 100vw, 66vw"
                className="w-full h-full"
              />
            ) : (
              <div className="w-full h-full bg-gradient-to-br from-blue-600 via-indigo-600 to-purple-700 flex items-center justify-center p-8">
                <div className="text-center">
                  <svg
                    className="w-16 h-16 mx-auto mb-4 text-white/60"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1}
                      d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z"
                    />
                  </svg>
                  <h3 className="text-2xl font-bold text-white/90 line-clamp-3">
                    {mainArticle.title}
                  </h3>
                  {mainArticle.excerpt && (
                    <p className="mt-2 text-sm text-white/70 line-clamp-2 max-w-md mx-auto">
                      {mainArticle.excerpt}
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* Gradient overlay — visual only */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />

            {/* Content overlay — wrapped in Link for navigation */}
            <div className="absolute bottom-0 left-0 right-0 p-4 md:p-8">
              <Link href={`/articles/${mainArticle.slug}`} className="block">
                {mainArticle.category && (
                  <span className="inline-block px-3 py-1 mb-3 text-xs font-medium text-white bg-blue-600/80 backdrop-blur-sm rounded-full">
                    {mainArticle.category.name}
                  </span>
                )}
                <h2 className="text-xl md:text-3xl lg:text-4xl font-bold text-white mb-2 line-clamp-2">
                  {mainArticle.title}
                </h2>
                <p className="text-sm md:text-base text-white/80 line-clamp-2 mb-3">
                  {mainArticle.excerpt}
                </p>
                <div className="flex items-center gap-4 text-xs md:text-sm text-white/60">
                  <span>{mainArticle.author?.name}</span>
                  {/* TODO: Restore published date display — hidden to avoid showing outdated dates */}
                  {/* <span>·</span>
                  <span>
                    {new Date(mainArticle.publishedAt).toLocaleDateString()}
                  </span> */}
                  <span>·</span>
                  <span>{mainArticle.views} views</span>
                </div>
              </Link>
            </div>
          </div>

          {/* Dot indicators */}
          {heroArticles.length > 1 && (
            <div className="absolute bottom-4 right-4 md:bottom-8 md:right-8 flex gap-2 z-20">
              {heroArticles.map((_, i) => (
                <button
                  key={i}
                  onClick={(e) => {
                    e.preventDefault();
                    setActiveIndex(i);
                  }}
                  className={`w-2 h-2 md:w-3 md:h-3 rounded-full transition-all ${
                    i === activeIndex
                      ? 'bg-white scale-110'
                      : 'bg-white/40 hover:bg-white/60'
                  }`}
                  aria-label={`Slide ${i + 1}`}
                />
              ))}
            </div>
          )}
        </div>

        {/* Side articles grid */}
        <div className="flex flex-col gap-4">
          {sideArticles.slice(0, 2).map((article) => {
            const sideHasHls = !!article.meta?.video?.hlsUrl;
            const sideHasVideo = isVideoUrl(article.coverImage);
            const videoDuration = article.meta?.video?.duration;
            return (
              <div
                key={article.id}
                className="group relative flex-1 rounded-xl overflow-hidden bg-white dark:bg-slate-800 shadow-lg min-h-[140px] md:min-h-[180px]"
              >
                <div className="absolute inset-0">
                  {sideHasHls ? (
                    <HlsVideoPlayer
                      hlsUrl={article.meta!.video!.hlsUrl}
                      poster={
                        article.meta?.video?.poster ||
                        (!isVideoUrl(article.coverImage)
                          ? article.coverImage
                          : undefined)
                      }
                      posterWebp={article.meta?.video?.posterWebp}
                      className="w-full h-full"
                      videoClassName="object-cover"
                      muted
                      autoPlay={false}
                    />
                  ) : sideHasVideo ? (
                    <video
                      src={article.coverImage}
                      className="w-full h-full object-cover"
                      muted
                      playsInline
                      preload="metadata"
                    />
                  ) : article.coverImage ? (
                    <BlurhashImage
                      src={article.coverImage}
                      alt={article.title}
                      fill
                      blurhash={article.meta?.images?.blurhash}
                      sizes="(max-width: 1024px) 100vw, 33vw"
                      className="w-full h-full"
                    />
                  ) : (
                    <div className="w-full h-full bg-gradient-to-br from-blue-500 via-indigo-500 to-purple-600 flex items-center justify-center p-4">
                      <svg
                        className="w-10 h-10 text-white/50"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
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
                  {/* Duration badge for video content */}
                  {videoDuration && videoDuration > 0 && (
                    <span className="absolute top-2 right-2 z-20 px-1.5 py-0.5 bg-black/70 backdrop-blur-sm text-white text-[10px] font-medium rounded">
                      {formatDuration(videoDuration)}
                    </span>
                  )}
                </div>
                <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
                <div className="absolute bottom-0 left-0 right-0 p-3 md:p-4">
                  <Link href={`/articles/${article.slug}`}>
                    {article.category && (
                      <span className="inline-block px-2 py-0.5 mb-2 text-[10px] font-medium text-white bg-blue-600/80 backdrop-blur-sm rounded-full">
                        {article.category.name}
                      </span>
                    )}
                    <h3 className="text-sm md:text-base font-semibold text-white line-clamp-2">
                      {article.title}
                    </h3>
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/**
 * Skeleton loader for HeroSection
 */
export function HeroSectionSkeleton() {
  return (
    <section className="mb-12 md:mb-16">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6">
        {/* Main skeleton */}
        <div className="lg:col-span-2 rounded-xl overflow-hidden bg-slate-200 dark:bg-slate-700 animate-pulse">
          <div className="h-[300px] sm:h-[400px] lg:h-[500px]" />
        </div>

        {/* Side skeletons */}
        <div className="flex flex-col gap-4">
          <div className="flex-1 rounded-xl overflow-hidden bg-slate-200 dark:bg-slate-700 animate-pulse min-h-[140px] md:min-h-[180px]" />
          <div className="flex-1 rounded-xl overflow-hidden bg-slate-200 dark:bg-slate-700 animate-pulse min-h-[140px] md:min-h-[180px]" />
          <div className="h-12 rounded-xl bg-slate-200 dark:bg-slate-700 animate-pulse" />
        </div>
      </div>
    </section>
  );
}
