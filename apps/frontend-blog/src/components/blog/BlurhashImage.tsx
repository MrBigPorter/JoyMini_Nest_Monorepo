'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import Image from 'next/image';
import { decode } from 'blurhash';

interface BlurhashImageProps {
  src?: string;
  alt: string;
  blurhash?: string;
  width?: number;
  height?: number;
  className?: string;
  fill?: boolean;
  priority?: boolean;
  sizes?: string;
}

/**
 * Decodes a BlurHash string into a data URL for use as a CSS background.
 * Uses the `blurhash` package's `decode` function directly (no react-blurhash dependency).
 */
function blurhashToDataUrl(
  hash: string,
  width: number,
  height: number,
): string {
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

    return canvas.toDataURL('image/png');
  } catch {
    return '';
  }
}

/**
 * Image component with BlurHash placeholder
 * Shows a blurred placeholder while the real image loads
 * Uses the `blurhash` package directly (no react-blurhash dependency)
 */
export function BlurhashImage({
  src,
  alt,
  blurhash,
  width = 800,
  height = 450,
  className = '',
  fill = false,
  priority = false,
  sizes = '(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw',
}: BlurhashImageProps) {
  // Hooks MUST be called before any early return (Rules of Hooks)
  const [isLoaded, setIsLoaded] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [placeholderUrl, setPlaceholderUrl] = useState<string>('');
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Decode blurhash on mount (client-side only)
  useEffect(() => {
    if (blurhash && typeof window !== 'undefined') {
      const url = blurhashToDataUrl(blurhash, 32, 32);
      if (url) {
        setPlaceholderUrl(url);
      }
    }
  }, [blurhash]);

  const handleLoad = useCallback(() => {
    setIsLoaded(true);
  }, []);

  const handleError = useCallback(() => {
    setHasError(true);
    setIsLoaded(true);
  }, []);

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

      {/* BlurHash placeholder via data URL background */}
      {placeholderUrl && !isLoaded && (
        <div
          className="absolute inset-0 z-10 bg-cover bg-center"
          style={{
            backgroundImage: `url(${placeholderUrl})`,
            backgroundSize: 'cover',
            filter: 'blur(8px)',
            transform: 'scale(1.1)',
          }}
        />
      )}

      {/* Gray placeholder when no blurhash */}
      {!placeholderUrl && !isLoaded && (
        <div className="absolute inset-0 z-10 bg-slate-200 dark:bg-slate-700 animate-pulse" />
      )}

      {/* Actual image */}
      {!hasError ? (
        fill ? (
          <Image
            src={src}
            alt={alt}
            fill
            priority={priority}
            sizes={sizes}
            className={`object-cover transition-opacity duration-500 ${
              isLoaded ? 'opacity-100' : 'opacity-0'
            }`}
            onLoad={handleLoad}
            onError={handleError}
          />
        ) : (
          <Image
            src={src}
            alt={alt}
            width={width}
            height={height}
            priority={priority}
            className={`object-cover transition-opacity duration-500 ${
              isLoaded ? 'opacity-100' : 'opacity-0'
            }`}
            onLoad={handleLoad}
            onError={handleError}
          />
        )
      ) : (
        <div className="flex items-center justify-center w-full h-full bg-slate-100 dark:bg-slate-800 text-slate-400">
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
    </div>
  );
}
