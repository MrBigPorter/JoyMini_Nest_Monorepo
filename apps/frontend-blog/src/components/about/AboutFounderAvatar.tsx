'use client';

import { BlurhashImage } from '@/components/blog/BlurhashImage';

interface AboutFounderAvatarProps {
  src: string;
  alt: string;
}

/**
 * Client component wrapper for the founder avatar on the About page.
 * Uses BlurhashImage to provide Next.js Image optimization and a smooth
 * loading placeholder (pulse animation when no blurhash is available).
 *
 * This is separated into a client component because:
 * - BlurhashImage is a 'use client' component
 * - The About page is a server component (async, uses getTranslations)
 */
export function AboutFounderAvatar({ src, alt }: AboutFounderAvatarProps) {
  return (
    <div className="relative w-64 h-64">
      {/* Gradient background glow */}
      <div className="absolute inset-0 bg-gradient-to-r from-primary/20 to-secondary/20 rounded-full blur-xl opacity-50" />

      {/* Avatar image with BlurhashImage */}
      <BlurhashImage
        src={src}
        alt={alt}
        fill
        priority
        className="rounded-full border-4 border-background object-cover shadow-2xl z-10"
        sizes="256px"
      />

      {/* Status indicator */}
      <div className="absolute bottom-4 right-4 w-6 h-6 bg-green-500 rounded-full border-2 border-background z-20" />
    </div>
  );
}
