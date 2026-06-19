'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { decode } from 'blurhash';
import { getOptimizedImageUrl } from '@/lib/utils/cloudflareImageLoader';

interface BlurhashImageProps {
  src?: string;
  alt: string;
  blurhash?: string;
  width?: number;
  height?: number;
  className?: string;
  fill?: boolean;
  priority?: boolean;
  quality?: number;
  sizes?: string;
}

/**
 * Global LRU cache for decoded blurhash data URLs.
 * Avoids re-decoding blurhash on every component remount (e.g. category switch).
 * Limited to 100 entries to prevent memory leaks.
 */
const blurhashCache = new Map<string, string>();
const BLURHASH_CACHE_MAX = 100;

/**
 * Module-level cache for "image has been loaded" state.
 * Keyed by the CDN-optimized image URL.
 *
 * When BlurhashImage is remounted (e.g. React reconciliation switching
 * displayArticles from initialData to allArticles), the component's
 * useState(isLoaded=false) resets, causing the blurhash overlay to
 * reappear over an already-loaded image. This cache persists across
 * mounts within the same page session so we can restore isLoaded=true
 * immediately.
 *
 * Limited to 200 entries to prevent memory leaks. Uses LRU eviction.
 */
const loadedImageCache = new Map<string, boolean>();
const LOADED_IMAGE_CACHE_MAX = 200;

function getCachedBlurhashUrl(
  hash: string,
  width: number,
  height: number,
): string {
  const cacheKey = `${hash}:${width}:${height}`;
  const cached = blurhashCache.get(cacheKey);
  if (cached) {
    // Move to end (LRU)
    blurhashCache.delete(cacheKey);
    blurhashCache.set(cacheKey, cached);
    return cached;
  }
  return '';
}

function setCachedBlurhashUrl(
  hash: string,
  width: number,
  height: number,
  url: string,
): void {
  const cacheKey = `${hash}:${width}:${height}`;
  if (blurhashCache.size >= BLURHASH_CACHE_MAX) {
    // Delete oldest entry (LRU)
    const firstKey = blurhashCache.keys().next().value;
    if (firstKey) blurhashCache.delete(firstKey);
  }
  blurhashCache.set(cacheKey, url);
}

/**
 * Decode a blurhash string into a small data URL (CSS background).
 * Runs synchronously on the calling thread (blurhash decode is fast for small sizes).
 */
function blurhashToDataUrl(
  hash: string,
  width: number,
  height: number,
): string {
  const cached = getCachedBlurhashUrl(hash, width, height);
  if (cached) return cached;

  try {
    const pixels = decode(hash, width, height);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';

    const imageData = ctx.createImageData(width, height);
    imageData.data.set(pixels);
    ctx.putImageData(imageData, 0, 0);

    const url = canvas.toDataURL('image/png');
    setCachedBlurhashUrl(hash, width, height, url);
    return url;
  } catch {
    return '';
  }
}

/**
 * BlurhashImage - client component that handles progressive image loading.
 *
 * Uses plain <img> elements instead of Next.js <Image> for ALL cases because:
 * 1. Next.js 15.2.4+ has a bug where suppressHydrationWarning is not forwarded
 *    to the rendered <img> element, making hydration errors inevitable when
 *    Turbopack's SSR and browser bundles get out of sync.
 * 2. Using <img> with a custom Cloudflare Image Resizing URL avoids the dual
 *    code path problem entirely — both 'fill' and '!fill' branches produce the
 *    same <img> element, so even if SSR and browser bundles are out of sync,
 *    the rendered HTML is identical and no hydration mismatch occurs.
 * 3. Cloudflare Image Resizing provides equivalent optimization (format selection,
 *    resizing, CDN delivery) at the edge without Next.js server-side processing.
 *
 * Key features:
 * - Blurhash placeholder decoding (client-side, cached globally)
 * - Fade-in transition from blurhash overlay to actual image
 * - LRU cache for decoded blurhash data URLs (avoids re-decoding)
 * - Graceful error fallback with SVG placeholder
 * - Supports both fill (absolute positioning) and explicit dimensions modes
 */
const _componentName = 'BlurhashImage';
let _mountCounter = 0;

export function BlurhashImage({
  src,
  alt,
  blurhash,
  width = 800,
  height = 450,
  className = '',
  fill = false,
  priority = false,
  quality,
  sizes = '(max-width: 768px) 90vw, (max-width: 1024px) 45vw, 600px',
}: BlurhashImageProps) {
  // Hooks MUST be called before any early return (Rules of Hooks)

  // DEBUG: per-instance id for log correlation
  const instanceId = useRef(`bi-${++_mountCounter}`);
  const renderCount = useRef(0);
  renderCount.current++;

  // DEBUG: log mount / unmount
  useEffect(() => {
    console.log(
      `[${_componentName}:${instanceId.current}] MOUNT render#=${renderCount.current}`,
      { src, blurhash, quality, fill, priority, alt: alt?.slice(0, 30) },
    );
    return () => {
      console.log(
        `[${_componentName}:${instanceId.current}] UNMOUNT render#=${renderCount.current}`,
      );
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Pre-compute the CDN-optimized URL so we can use it as the cache key
  // and avoid computing it inline in the JSX below.
  const imageUrl = src
    ? getOptimizedImageUrl({
        src,
        width: fill ? 1280 : width,
        quality: quality ?? 75,
      })
    : undefined;

  // DEBUG: log when imageUrl changes
  const prevImageUrlRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (
      prevImageUrlRef.current !== undefined &&
      prevImageUrlRef.current !== imageUrl
    ) {
      console.log(
        `[${_componentName}:${instanceId.current}] imageUrl CHANGED`,
        {
          from: prevImageUrlRef.current,
          to: imageUrl,
        },
      );
    }
    prevImageUrlRef.current = imageUrl;
  }, [imageUrl]);

  // Check if this image was already loaded in a previous component instance.
  // The loadedImageCache persists across mounts within the same page session,
  // preventing the blurhash overlay from reappearing when React reconciliation
  // causes a remount (e.g. displayArticles switching from initialData to allArticles).
  const cacheHit = imageUrl ? loadedImageCache.has(imageUrl) : false;
  const [isLoaded, setIsLoaded] = useState(cacheHit);
  const [hasError, setHasError] = useState(false);
  const [placeholderUrl, setPlaceholderUrl] = useState<string>('');
  const imgRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // DEBUG: log loadedImageCache state
  console.log(
    `[${_componentName}:${instanceId.current}] RENDER render#=${renderCount.current}`,
    {
      cacheHit,
      isLoaded,
      hasError,
      hasPlaceholderUrl: !!placeholderUrl,
      imageUrl: imageUrl?.slice(-60),
      src: src?.slice(-40),
      blurhash: blurhash?.slice(0, 12),
      quality,
    },
  );

  // Helper to mark an image URL as loaded in the module-level cache
  const markLoaded = useCallback((url: string) => {
    if (loadedImageCache.size >= LOADED_IMAGE_CACHE_MAX) {
      const firstKey = loadedImageCache.keys().next().value;
      if (firstKey) loadedImageCache.delete(firstKey);
    }
    loadedImageCache.set(url, true);
    console.log(
      `[${_componentName}:${instanceId.current}] image LOADED & cached`,
      { url: url?.slice(-60) },
    );
  }, []);

  // Decode blurhash on mount (client-side only)
  // Uses global cache so re-mounts don't re-decode
  useEffect(() => {
    if (blurhash && typeof window !== 'undefined') {
      console.log(
        `[${_componentName}:${instanceId.current}] decoding blurhash`,
        { blurhash: blurhash?.slice(0, 12) },
      );
      const url = blurhashToDataUrl(blurhash, 32, 32);
      if (url) {
        setPlaceholderUrl(url);
        console.log(
          `[${_componentName}:${instanceId.current}] placeholderUrl set`,
        );
      } else {
        console.warn(
          `[${_componentName}:${instanceId.current}] blurhash decode returned empty`,
        );
      }
    } else {
      console.log(
        `[${_componentName}:${instanceId.current}] skipping blurhash decode`,
        { blurhash: !!blurhash, hasWindow: typeof window !== 'undefined' },
      );
    }
  }, [blurhash]);

  // DEBUG: log isLoaded changes
  const prevIsLoadedRef = useRef(isLoaded);
  useEffect(() => {
    if (prevIsLoadedRef.current !== isLoaded) {
      console.log(
        `[${_componentName}:${instanceId.current}] isLoaded CHANGED`,
        {
          from: prevIsLoadedRef.current,
          to: isLoaded,
        },
      );
    }
    prevIsLoadedRef.current = isLoaded;
  }, [isLoaded]);

  // Check if the <img> element already completed loading BEFORE React
  // attached the onLoad/onError handlers (e.g. SSR image loaded before
  // hydration JS arrived, or browser cache served instantly).
  // If img.complete is true, the load event already fired and was missed,
  // so we must mark it as loaded manually.
  useEffect(() => {
    if (imgRef.current?.complete && imageUrl) {
      console.log(
        `[${_componentName}:${instanceId.current}] img.complete=true on mount (load event was missed), marking loaded`,
      );
      setIsLoaded(true);
      markLoaded(imageUrl);
    }
  }, [imageUrl, markLoaded]);

  const handleLoad = useCallback(() => {
    console.log(`[${_componentName}:${instanceId.current}] <img> onLoad FIRED`);
    setIsLoaded(true);
    if (imageUrl) markLoaded(imageUrl);
  }, [imageUrl, markLoaded]);

  const handleError = useCallback(() => {
    console.error(
      `[${_componentName}:${instanceId.current}] <img> onError FIRED`,
      { imageUrl: imageUrl?.slice(-60) },
    );
    setHasError(true);
    setIsLoaded(true);
    if (imageUrl) markLoaded(imageUrl);
  }, [imageUrl, markLoaded]);

  // If no src is provided, render a gradient placeholder
  if (!src) {
    return (
      <div className={`relative overflow-hidden ${className}`}>
        <div className="flex items-center justify-center w-full h-full bg-gradient-to-br from-slate-100 to-slate-200 dark:from-slate-800 dark:to-slate-700 text-slate-400 dark:text-slate-500">
          <svg
            className="w-10 h-10"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
            />
          </svg>
        </div>
      </div>
    );
  }

  return (
    <div className={`relative overflow-hidden h-full w-full ${className}`}>
      {/* Hidden canvas for blurhash decoding (not rendered visually) */}
      <canvas ref={canvasRef} style={{ display: 'none' }} />

      {/* Actual image - always at full opacity, no transition needed */}
      {/* Blurhash overlay sits on top (z-20) and fades out when image loads */}
      {!hasError ? (
        <img
          ref={imgRef}
          src={imageUrl}
          alt={alt}
          width={fill ? undefined : width}
          height={fill ? undefined : height}
          sizes={sizes}
          className="object-cover"
          loading={priority ? 'eager' : 'lazy'}
          fetchPriority={priority ? 'high' : 'auto'}
          decoding="async"
          onLoad={handleLoad}
          onError={handleError}
          style={
            fill
              ? {
                  position: 'absolute',
                  height: '100%',
                  width: '100%',
                  left: 0,
                  top: 0,
                  right: 0,
                  bottom: 0,
                  objectFit: 'cover',
                  color: 'transparent',
                }
              : {
                  color: 'transparent',
                }
          }
        />
      ) : (
        <div className="flex items-center justify-center w-full h-full bg-slate-100 dark:bg-slate-800 text-slate-400 relative z-10">
          <svg
            className="w-8 h-8"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
            />
          </svg>
        </div>
      )}

      {/* Blurhash overlay — rendered on top of image (z-20), fades out on load */}
      {blurhash && placeholderUrl && (
        <div
          className="absolute inset-0 z-20 transition-opacity duration-300"
          style={{
            backgroundImage: `url(${placeholderUrl})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            opacity: isLoaded ? 0 : 1,
            pointerEvents: 'none',
          }}
          aria-hidden="true"
        />
      )}
    </div>
  );
}
