'use client';

import { useRef, useState } from 'react';

interface NativeVideoPlayerProps {
  src: string;
  poster?: string;
  className?: string;
}

/**
 * Click-to-play wrapper for regular mp4 / non-HLS videos.
 * Shows poster + play button overlay — only loads the video after user clicks.
 */
export function NativeVideoPlayer({
  src,
  poster,
  className = '',
}: NativeVideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [clicked, setClicked] = useState(false);

  const handleClick = () => {
    setClicked(true);
    // give React a tick to render the real <video>, then play
    setTimeout(() => {
      videoRef.current?.play().catch(() => {});
    }, 0);
  };

  /* ── After click: show native controls ── */
  if (clicked) {
    return (
      <video
        ref={videoRef}
        src={src}
        poster={poster}
        controls
        playsInline
        preload="metadata"
        autoPlay
        className={`w-full rounded-lg bg-black ${className}`}
      />
    );
  }

  /* ���─ Before click: poster + play button ── */
  return (
    <div
      className={`relative cursor-pointer overflow-hidden rounded-lg bg-black ${className}`}
      style={
        poster
          ? {
              backgroundImage: `url(${poster})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
            }
          : { background: 'linear-gradient(135deg,#1e293b 0%,#0f172a 100%)' }
      }
      onClick={handleClick}
    >
      {/* Tint overlay */}
      <div
        className={`absolute inset-0 ${poster ? 'bg-black/30' : 'bg-black/15'}`}
      />

      {/* Hidden video to give the container proper aspect-ratio height */}
      <video
        src={src}
        poster={poster}
        preload="none"
        className="w-full opacity-0 pointer-events-none"
        style={{ aspectRatio: '16/9' }}
      />

      {/* Play button */}
      <div className="absolute inset-0 flex items-center justify-center z-10">
        <div className="w-16 h-16 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center hover:bg-white/35 hover:scale-110 transition-all duration-200 shadow-lg">
          <svg
            className="w-8 h-8 text-white ml-1"
            fill="currentColor"
            viewBox="0 0 24 24"
          >
            <path d="M8 5v14l11-7z" />
          </svg>
        </div>
      </div>
    </div>
  );
}
