'use client';

import { Button } from '@repo/ui';

export function AiErrorBanner({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
      <span>{message}</span>
      {onRetry ? (
        <Button size="sm" variant="outline" onClick={onRetry}>
          重试
        </Button>
      ) : null}
    </div>
  );
}
