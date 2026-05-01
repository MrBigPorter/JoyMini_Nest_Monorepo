import type { ImageLoaderProps } from 'next/image';

/**
 * Custom Next.js image loader that generates Cloudflare `/cdn-cgi/image/` URLs.
 *
 * This replaces the default `/_next/image` endpoint which requires `sharp`
 * (a native C++ module) — unavailable in Cloudflare Workers (V8 isolates).
 *
 * Instead, we delegate image resizing/format conversion to Cloudflare's
 * edge network via `/cdn-cgi/image/`, which runs on Cloudflare's CDN
 * nodes (not Workers), supports AVIF/WebP, and requires no Node.js modules.
 *
 * Mirrors the approach used in the Flutter app's `RemoteUrlBuilder`.
 *
 * @see JoyMini_Flutter_App/lib/utils/media/remote_url_builder.dart
 */
export default function cloudflareImageLoader({
  src,
  width,
  quality,
}: ImageLoaderProps): string {
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
