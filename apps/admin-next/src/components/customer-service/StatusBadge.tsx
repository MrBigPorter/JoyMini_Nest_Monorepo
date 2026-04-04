'use client';

import { CheckCircle, Clock } from 'lucide-react';

export function StatusBadge({ status }: { status: number }) {
  if (status === 2) {
    return (
      <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-gray-100 dark:bg-white/10 text-gray-500 dark:text-gray-400">
        <CheckCircle size={10} />
        Closed
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-green-100 dark:bg-green-500/20 text-green-600 dark:text-green-400">
      <Clock size={10} />
      Active
    </span>
  );
}
