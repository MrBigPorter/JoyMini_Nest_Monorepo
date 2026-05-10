import type { ImageLoaderProps } from 'next/image';

/**
 * Standalone utility to transform an image URL through Cloudflare Image Resizing.
 *
 * Unlike the default export (`cloudflareImageLoader`), which is designed for
 * Next.js `<Image>` component's `loaderFile` config, this function can be used
 * anywhere — e.g., for `<video poster>`, `<img>` tags in markdown/HTML content,
 * or SSR preload `<link>` tags.
 *
 * The function:
 * 1. Checks the URL is on our CDN domain (`img.joyminis.com`)
 * 2. Builds a `/cdn-cgi/image/width=...,quality=...,f=auto,fit=scale-down/` URL
 * 3. Cloudflare's edge nodes handle format conversion (AVIF > WebP > JPEG)
 *    and resizing — no Node.js sharp module needed (unavailable in Workers).
 *
 * @param src    - Original image URL (must be on img.joyminis.com)
 * @param width  - Desired width in pixels (e.g., 640, 800, 1200)
 * @param quality - Image quality (1-100, default: 75)
 * @returns Transformed CDN URL, or original `src` if not applicable
 *
 * @example
 * ```ts
 * getOptimizedImageUrl({ src: 'https://img.joyminis.com/photo.jpg', width: 1200 })
 * // => 'https://img.joyminis.com/cdn-cgi/image/width=1200,quality=75,f=auto,fit=scale-down/photo.jpg'
 * ```
 */
export function getOptimizedImageUrl({
  src,
  width,
  quality,
}: {
  src: string;
  width: number;
  quality?: number;
}): string {
  // Skip non-http(s) URLs (data URIs, blobs) and SVGs
  if (
    src.startsWith('data:') ||
    src.startsWith('blob:') ||
    src.endsWith('.svg')
  ) {
    return src;
  }

  try {
    const url = new URL(src);

    // Only apply Cloudflare transforms to our own CDN domain
    if (url.hostname !== 'img.joyminis.com') {
      return src;
    }

    // Avoid double-processing if already a /cdn-cgi/image/ URL
    if (url.pathname.startsWith('/cdn-cgi/image/')) {
      return src;
    }

    // Assemble Cloudflare Image Resizing parameters
    // - width: requested width in pixels
    // - quality: 75 (Next.js default, accepted by CDN)
    // - f=auto: automatic format selection (AVIF > WebP > JPEG)
    // - fit=scale-down: scale down only (preserve aspect ratio, no cropping)
    const cfParams = `width=${width},quality=${quality ?? 75},f=auto,fit=scale-down`;

    return `${url.protocol}//${url.host}/cdn-cgi/image/${cfParams}${url.pathname}`;
  } catch {
    // Fallback: return original source if URL parsing fails
    return src;
  }
}

/**
 * Custom Next.js image loader for the `loaderFile` config in `next.config.ts`.
 *
 * This replaces the default `/_next/image` endpoint which requires `sharp`
 * (a native C++ module) — unavailable in Cloudflare Workers (V8 isolates).
 *
 * Instead, delegates to `getOptimizedImageUrl()` which generates
 * `/cdn-cgi/image/` URLs processed by Cloudflare's edge CDN nodes.
 *
 * @see getOptimizedImageUrl
 * @see JoyMini_Flutter_App/lib/utils/media/remote_url_builder.dart
 */
export default function cloudflareImageLoader({
  src,
  width,
  quality,
}: ImageLoaderProps): string {
  return getOptimizedImageUrl({
    src,
    width,
    quality: quality ?? 75,
  });
}
