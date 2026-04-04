'use client';

import { Wifi, WifiOff, RefreshCw } from 'lucide-react';
import type { SocketStatus } from '@/hooks/useChatSocket';

export function SocketIndicator({ status }: { status: SocketStatus }) {
  if (status === 'connected') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-500/10 px-2.5 py-1 rounded-full">
        <Wifi size={11} />
        Live
      </span>
    );
  }
  if (status === 'connecting') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-yellow-600 dark:text-yellow-400 bg-yellow-50 dark:bg-yellow-500/10 px-2.5 py-1 rounded-full">
        <RefreshCw size={11} className="animate-spin" />
        Connecting…
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-white/5 px-2.5 py-1 rounded-full">
      <WifiOff size={11} />
      Polling
    </span>
  );
}
