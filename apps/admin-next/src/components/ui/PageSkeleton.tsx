/**
 * PageSkeleton — 通用页面骨架屏
 * Stage 5: 供 9 个"裸页"在 Suspense fallback 中复用
 * 纯 Server-safe，无 'use client'
 */
import React from 'react';

/**
 * 顶部标题 + 操作栏骨架
 */
function HeaderSkeleton() {
  return (
    <div className="flex items-center justify-between mb-6 animate-pulse">
      <div className="space-y-2">
        <div className="h-7 w-40 rounded-lg bg-gray-200 dark:bg-white/10" />
        <div className="h-4 w-64 rounded bg-gray-100 dark:bg-white/5" />
      </div>
      <div className="h-9 w-28 rounded-lg bg-gray-200 dark:bg-white/10" />
    </div>
  );
}

/**
 * 搜索/过滤栏骨架
 */
function FilterSkeleton() {
  return (
    <div className="flex gap-3 mb-4 animate-pulse">
      <div className="h-9 w-48 rounded-lg bg-gray-100 dark:bg-white/5" />
      <div className="h-9 w-32 rounded-lg bg-gray-100 dark:bg-white/5" />
      <div className="h-9 w-24 rounded-lg bg-gray-100 dark:bg-white/5" />
    </div>
  );
}

/**
 * 表格骨架（默认 6 行）
 */
function TableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="animate-pulse space-y-2">
      {/* 表头 */}
      <div className="flex gap-4 px-4 py-3 rounded-lg bg-gray-100 dark:bg-white/5">
        {[40, 120, 80, 100, 80, 80].map((w, i) => (
          <div
            key={i}
            className="h-4 rounded bg-gray-200 dark:bg-white/10 flex-shrink-0"
            style={{ width: w }}
          />
        ))}
      </div>
      {/* 数据行 */}
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="flex gap-4 px-4 py-4 rounded-lg bg-white dark:bg-white/[0.02] border border-gray-100 dark:border-white/5"
        >
          {[40, 120, 80, 100, 80, 80].map((w, j) => (
            <div
              key={j}
              className="h-4 rounded bg-gray-100 dark:bg-white/5 flex-shrink-0"
              style={{ width: w }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * 完整页面骨架 = Header + Filter + Table
 */
export function PageSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="space-y-4 p-1">
      <HeaderSkeleton />
      <FilterSkeleton />
      <TableSkeleton rows={rows} />
    </div>
  );
}
