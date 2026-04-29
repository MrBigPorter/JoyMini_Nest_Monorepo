'use client';

/**
 * Minimal Skeleton component for loading states.
 * Pattern already used inline in PageSkeleton.tsx — extracted for reuse.
 */
function Skeleton({
  className = '',
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { className?: string }) {
  return (
    <div
      className={`animate-pulse bg-slate-200 dark:bg-slate-700 rounded ${className}`}
      {...props}
    />
  );
}

export { Skeleton };
