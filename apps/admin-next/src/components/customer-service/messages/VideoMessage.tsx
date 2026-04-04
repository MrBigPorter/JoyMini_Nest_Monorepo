'use client';

import { useState, useRef } from 'react';
import { Play, X } from 'lucide-react';
import { resolveMediaUrl, formatDuration } from '@/lib/media-utils';

export function VideoMessage({
  content,
  meta,
}: {
  content: string;
  meta: Record<string, unknown> | null;
}) {
  const [playerOpen, setPlayerOpen] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const videoUrl = resolveMediaUrl(content);
  const duration = meta?.duration as number | undefined;
  const w = meta?.w as number | undefined;
  const h = meta?.h as number | undefined;
  const thumbnail = meta?.thumbnail as string | undefined;
  const aspect = w && h ? Math.min(2, Math.max(0.5, w / h)) : 16 / 9;

  return (
    <>
      <button
        onClick={() => setPlayerOpen(true)}
        className="relative overflow-hidden rounded-xl cursor-pointer group bg-black"
        style={{ width: 200, aspectRatio: String(aspect) }}
      >
        {/* Thumbnail or placeholder */}
        {thumbnail ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={resolveMediaUrl(thumbnail)}
            alt="video thumbnail"
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full bg-gray-800 flex items-center justify-center">
            <Play size={32} className="text-white/50" />
          </div>
        )}

        {/* Play button overlay */}
        <div className="absolute inset-0 flex items-center justify-center bg-black/30 group-hover:bg-black/40 transition-colors">
          <div className="w-10 h-10 rounded-full bg-white/90 flex items-center justify-center shadow-lg">
            <Play
              size={18}
              className="text-gray-800 ml-0.5"
              fill="currentColor"
            />
          </div>
        </div>

        {/* Duration badge */}
        {duration && (
          <div className="absolute bottom-1.5 right-1.5 px-1.5 py-0.5 bg-black/70 rounded text-xs text-white">
            {formatDuration(duration)}
          </div>
        )}
      </button>

      {/* Video player modal */}
      {playerOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/95 flex items-center justify-center"
          onClick={() => setPlayerOpen(false)}
        >
          <button
            onClick={() => setPlayerOpen(false)}
            className="absolute top-4 right-4 text-white hover:text-gray-300 p-2 z-10"
          >
            <X size={24} />
          </button>

          <div
            className="relative max-w-[90vw] max-h-[90vh]"
            onClick={(e) => e.stopPropagation()}
          >
            <video
              ref={videoRef}
              src={videoUrl}
              className="max-w-full max-h-[90vh] rounded-lg"
              controls
              autoPlay
            />
          </div>
        </div>
      )}
    </>
  );
}
