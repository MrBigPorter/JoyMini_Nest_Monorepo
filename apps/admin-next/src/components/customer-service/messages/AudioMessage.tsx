'use client';

import { useRef, useState } from 'react';
import { Play, Pause } from 'lucide-react';
import {
  resolveMediaUrl,
  formatDuration,
  generateWaveform,
} from '@/lib/media-utils';

export function AudioMessage({
  msgId,
  content,
  meta,
}: {
  msgId: string;
  content: string;
  meta: Record<string, unknown> | null;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const duration = meta?.duration as number | undefined;
  const bars = generateWaveform(msgId);
  const minW = 140;
  const dynW = Math.min(280, minW + Math.round((duration ?? 0) / 1000) * 5);

  const toggle = () => {
    if (!audioRef.current) return;
    if (playing) {
      audioRef.current.pause();
    } else {
      void audioRef.current.play();
    }
  };

  return (
    <div
      className="flex items-center gap-2 px-3 py-2 rounded-2xl"
      style={{ width: dynW }}
    >
      <button
        onClick={toggle}
        className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center bg-white/20 hover:bg-white/30 transition-colors"
      >
        {playing ? <Pause size={12} /> : <Play size={12} fill="currentColor" />}
      </button>
      {/* 波形 */}
      <div className="flex items-center gap-[2px] flex-1">
        {bars.map((h, i) => (
          <div
            key={i}
            className={`rounded-full transition-all ${playing ? 'bg-white animate-pulse' : 'bg-white/70'}`}
            style={{
              width: 3,
              height: `${Math.round(h * 20)}px`,
              animationDelay: `${(i * 80) % 500}ms`,
            }}
          />
        ))}
      </div>
      <span className="text-xs opacity-75 flex-shrink-0">
        {formatDuration(duration)}
      </span>
      <audio
        ref={audioRef}
        src={resolveMediaUrl(content)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        className="hidden"
      />
    </div>
  );
}
