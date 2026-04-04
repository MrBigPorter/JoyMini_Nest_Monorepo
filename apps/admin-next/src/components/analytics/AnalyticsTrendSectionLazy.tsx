'use client';

import { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';

/**
 * Client-only lazy wrapper for recharts section.
 *
 * Kept in a client file so Server Component pages can import it
 * without using `dynamic(..., { ssr: false })` directly.
 */
const AnalyticsTrendSection = dynamic(
  () =>
    import('@/components/analytics/AnalyticsTrendSection').then(
      (mod) => mod.AnalyticsTrendSection,
    ),
  {
    ssr: false,
    loading: () => (
      <div className="h-[280px] rounded-xl bg-gray-100 animate-pulse dark:bg-gray-800" />
    ),
  },
);

export function AnalyticsTrendSectionLazy() {
  const [shouldMount, setShouldMount] = useState(false);
  const anchorRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const node = anchorRef.current;
    if (!node || shouldMount) return;

    if (typeof IntersectionObserver === 'undefined') {
      setShouldMount(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setShouldMount(true);
          observer.disconnect();
        }
      },
      { rootMargin: '200px 0px' },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [shouldMount]);

  return (
    <div ref={anchorRef}>
      {shouldMount ? (
        <AnalyticsTrendSection />
      ) : (
        <div className="h-[280px] rounded-xl bg-gray-100 animate-pulse dark:bg-gray-800" />
      )}
    </div>
  );
}
