'use client';

import { useState } from 'react';
import { Play, X } from 'lucide-react';
import { resolveImageUrl } from '@/lib/media-utils';

export function ImageMessage({
  content,
  meta,
}: {
  content: string;
  meta: Record<string, unknown> | null;
}) {
  const [lightbox, setLightbox] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const thumbUrl = resolveImageUrl(content, 240);
  const fullUrl = resolveImageUrl(content, 1200);
  const w = meta?.w as number | undefined;
  const h = meta?.h as number | undefined;
  const aspect = w && h ? Math.min(2, Math.max(0.5, w / h)) : 1;

  return (
    <>
      <button
        onClick={() => setLightbox(true)}
        className="relative overflow-hidden rounded-xl cursor-pointer group"
        style={{ width: 200, aspectRatio: String(aspect) }}
      >
        {/* 占位 */}
        {!loaded && (
          <div className="absolute inset-0 bg-gray-200 dark:bg-white/10 animate-pulse rounded-xl" />
        )}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={thumbUrl}
          alt="image"
          onLoad={() => setLoaded(true)}
          className={`w-full h-full object-cover rounded-xl transition-opacity group-hover:opacity-90 ${loaded ? 'opacity-100' : 'opacity-0'}`}
        />
        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/20 rounded-xl">
          <Play size={20} className="text-white drop-shadow-lg" fill="white" />
        </div>
      </button>

      {/* Lightbox */}
      {lightbox && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center"
          onClick={() => setLightbox(false)}
        >
          <button
            onClick={() => setLightbox(false)}
            className="absolute top-4 right-4 text-white hover:text-gray-300 p-2"
          >
            <X size={24} />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={fullUrl}
            alt="preview"
            className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </>
  );
}
