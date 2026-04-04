/**
 * DashboardStatsSkeleton — Suspense fallback
 * 在 DashboardStats Server Component 流式渲染完成前显示骨架屏。
 */
import React from 'react';
import { Card } from '@/components/UIComponents';

export function DashboardStatsSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-5">
      {Array.from({ length: 4 }).map((_, i) => (
        <Card key={i} className="flex flex-col gap-3">
          <div className="flex items-start justify-between">
            <div className="w-11 h-11 rounded-xl bg-gray-100 dark:bg-white/10 animate-pulse" />
            <div className="h-4 w-24 rounded-lg bg-gray-100 dark:bg-white/10 animate-pulse" />
          </div>
          <div className="h-8 w-28 rounded-lg bg-gray-100 dark:bg-white/10 animate-pulse" />
          <div className="h-4 w-20 rounded-lg bg-gray-100 dark:bg-white/10 animate-pulse" />
        </Card>
      ))}
    </div>
  );
}
