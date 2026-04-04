import React from 'react';

export function AnalyticsOverviewSkeleton() {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-4 animate-pulse">
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="rounded-xl border border-gray-100 dark:border-white/5 bg-white dark:bg-white/5 p-5 flex flex-col gap-3"
        >
          <div className="w-10 h-10 rounded-xl bg-gray-100 dark:bg-white/10" />
          <div className="h-7 w-20 rounded bg-gray-100 dark:bg-white/10" />
          <div className="h-4 w-28 rounded bg-gray-100 dark:bg-white/5" />
        </div>
      ))}
    </div>
  );
}
