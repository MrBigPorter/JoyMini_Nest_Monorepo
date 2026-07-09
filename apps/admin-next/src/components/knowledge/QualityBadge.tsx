'use client';

import React from 'react';

interface QualityBadgeProps {
  score: number | null | undefined;
}

/**
 * QualityBadge — 质量评分徽章
 *
 * 分数范围  颜色     标签
 * 90-100    🟢 绿色   Excellent
 * 70-89     🟡 琥珀色  Good
 * 50-69     🟠 橙色   Fair
 * 0-49      🔴 红色   Suspicious
 * null      ⚪ 灰色   Unchecked
 */
export function QualityBadge({ score }: QualityBadgeProps) {
  if (score === null || score === undefined) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-400 dark:bg-gray-800">
        <span className="h-1.5 w-1.5 rounded-full bg-gray-300" />
        Unchecked
      </span>
    );
  }

  let colorClass: string;
  let label: string;

  if (score >= 90) {
    colorClass = 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400';
    label = `🟢 ${score}`;
  } else if (score >= 70) {
    colorClass = 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400';
    label = `🟡 ${score}`;
  } else if (score >= 50) {
    colorClass = 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400';
    label = `🟠 ${score}`;
  } else {
    colorClass = 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400';
    label = `🔴 ${score}`;
  }

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${colorClass}`}
      title={`Quality score: ${score}/100`}
    >
      {label}
    </span>
  );
}
