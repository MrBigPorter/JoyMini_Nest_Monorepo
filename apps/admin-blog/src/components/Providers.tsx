'use client';

import React, { useEffect, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAppStore } from '@/store/useAppStore';
import { ToastContainer } from '@/components/UIComponents';
import { useToastStore } from '@/store/useToastStore';
import ChunkReloadHandler from './ChunkReloadHandler';

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: 1,
      },
    },
  });
}

let browserQueryClient: QueryClient | undefined;

function getQueryClient() {
  if (typeof window === 'undefined') {
    return makeQueryClient();
  }
  if (!browserQueryClient) browserQueryClient = makeQueryClient();
  return browserQueryClient;
}

export const Providers: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [queryClient] = useState(() => getQueryClient());
  const theme = useAppStore((s) => s.theme);
  const { toasts, removeToast } = useToastStore();

  useEffect(() => {
    document.documentElement.classList.remove('light', 'dark');
    document.documentElement.classList.add(theme);
  }, [theme]);

  return (
    <QueryClientProvider client={queryClient}>
      <ChunkReloadHandler />
      <ToastContainer toasts={toasts} removeToastAction={removeToast} />
      {children}
    </QueryClientProvider>
  );
};
