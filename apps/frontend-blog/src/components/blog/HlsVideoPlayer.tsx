'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import Hls from 'hls.js';

interface HlsVideoPlayerProps {
  hlsUrl: string;
  poster?: string;
  className?: string;
  autoPlay?: boolean;
  muted?: boolean;
  /** When true, don't load video on mount — show poster + play button instead.
   *  Also coordinates across components: only one video plays at a time. */
  clickToPlay?: boolean;
}

/**
 * HLS Video Player component
 * Uses hls.js for HLS streaming with fallback to native <video> for Safari
 *
 * clickToPlay mode: defers loading until user clicks play button.
 * Also dispatches a 'hls-video-play' custom event on window so that
 * other clickToPlay instances stop when this one starts playing.
 */
export function HlsVideoPlayer({
  hlsUrl,
  poster,
  className = '',
  autoPlay = false,
  muted = true,
  clickToPlay = false,
}: HlsVideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [userClicked, setUserClicked] = useState(false);
  const hlsRef = useRef<Hls | null>(null);

  const handlePlay = useCallback(() => {
    setIsPlaying(true);
  }, []);

  const handlePause = useCallback(() => {
    setIsPlaying(false);
  }, []);

  const destroyVideo = useCallback(() => {
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.removeAttribute('src');
      videoRef.current.load();
    }
  }, []);

  // Initialize hls.js and start loading the stream
  // forcePlay: always call video.play() on MANIFEST_PARSED (used for clickToPlay)
  const initVideo = useCallback(
    (forcePlay = false) => {
      const video = videoRef.current;
      if (!video) return;

      setIsLoading(true);
      setHasError(false);

      if (Hls.isSupported()) {
        const hls = new Hls({
          enableWorker: true,
          lowLatencyMode: true,
          backBufferLength: 30,
        });
        hlsRef.current = hls;

        hls.loadSource(hlsUrl);
        hls.attachMedia(video);

        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          setIsLoading(false);
          if (autoPlay || forcePlay) {
            video.play().catch(() => {
              // Autoplay blocked, user interaction needed
            });
          }
        });

        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (data.fatal) {
            setHasError(true);
            setIsLoading(false);
          }
        });
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = hlsUrl;
        video.addEventListener('loadedmetadata', () => {
          setIsLoading(false);
          if (autoPlay || forcePlay) {
            video.play().catch(() => {});
          }
        });
        video.addEventListener('error', () => {
          setHasError(true);
          setIsLoading(false);
        });
      } else {
        setHasError(true);
        setIsLoading(false);
      }
    },
    [hlsUrl, autoPlay],
  );

  // ─── Normal mode: auto-load on mount ───
  useEffect(() => {
    if (clickToPlay) return;

    initVideo(false);

    return () => destroyVideo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hlsUrl, clickToPlay]);

  // ─── Click-to-play mode: listen for other videos starting ───
  useEffect(() => {
    if (!clickToPlay) return;

    const handleOtherVideoPlay = (e: CustomEvent) => {
      const otherHlsUrl = e.detail?.hlsUrl;
      if (otherHlsUrl === hlsUrl) return; // same video, ignore

      destroyVideo();
      setUserClicked(false);
      setIsPlaying(false);
    };

    window.addEventListener(
      'hls-video-play',
      handleOtherVideoPlay as EventListener,
    );
    return () => {
      window.removeEventListener(
        'hls-video-play',
        handleOtherVideoPlay as EventListener,
      );
    };
  }, [clickToPlay, hlsUrl, destroyVideo]);

  // Cleanup on unmount (for clickToPlay mode)
  useEffect(() => {
    if (!clickToPlay) return;
    return () => destroyVideo();
  }, [clickToPlay, destroyVideo]);

  const handlePlayClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      if (userClicked) return;

      // Notify other clickToPlay videos to stop
      window.dispatchEvent(
        new CustomEvent('hls-video-play', { detail: { hlsUrl } }),
      );

      setUserClicked(true);
      initVideo(true); // force play since user explicitly clicked
    },
    [hlsUrl, userClicked, initVideo],
  );

  const showPlayOverlay = clickToPlay && !userClicked && !hasError;

  return (
    <div
      className={`relative group overflow-hidden bg-black rounded-lg ${className}`}
      style={
        showPlayOverlay && poster
          ? {
              backgroundImage: `url(${poster})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
            }
          : undefined
      }
    >
      {/* Dark gradient overlay when showing poster */}
      {showPlayOverlay && (
        <div
          className={`absolute inset-0 z-10 transition-opacity duration-300 ${
            poster
              ? 'bg-black/30'
              : 'bg-gradient-to-br from-slate-800 to-slate-900'
          }`}
        />
      )}

      {isLoading && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/50">
          <div className="w-10 h-10 border-2 border-white/30 border-t-white rounded-full animate-spin" />
        </div>
      )}

      {hasError ? (
        <div className="flex items-center justify-center w-full h-full bg-slate-900 text-slate-400">
          <div className="text-center p-4">
            <svg
              className="w-10 h-10 mx-auto mb-2"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
              />
            </svg>
            <p className="text-sm">Video unavailable</p>
          </div>
        </div>
      ) : (
        <video
          ref={videoRef}
          className="w-full h-full object-contain"
          poster={poster}
          controls
          playsInline
          muted={muted}
          onPlay={handlePlay}
          onPause={handlePause}
          preload={clickToPlay ? 'none' : 'metadata'}
        />
      )}

      {/* Click-to-play overlay — shown before user clicks */}
      {showPlayOverlay && (
        <div
          className="absolute inset-0 flex items-center justify-center cursor-pointer z-20"
          onClick={handlePlayClick}
        >
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
      )}

      {/* Original play overlay — non-clickToPlay mode when paused */}
      {!clickToPlay && !isPlaying && !isLoading && !hasError && (
        <div
          className="absolute inset-0 flex items-center justify-center cursor-pointer"
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            videoRef.current?.play();
          }}
        >
          <div className="w-16 h-16 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center">
            <svg
              className="w-8 h-8 text-white ml-1"
              fill="currentColor"
              viewBox="0 0 24 24"
            >
              <path d="M8 5v14l11-7z" />
            </svg>
          </div>
        </div>
      )}
    </div>
  );
}
