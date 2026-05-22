'use client';

import React, { useEffect, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ModalProvider } from '@repo/ui';
import { useAppStore } from '@/store/useAppStore';
import { ToastContainer } from '@/components/UIComponents';
import { useToastStore } from '@/store/useToastStore';
import ChunkReloadHandler from './ChunkReloadHandler';
import { AutoLoginHandler } from './AutoLoginHandler';

/**
 * 创建 QueryClient 单例（浏览器）/ 每次新建（服务器）
 * 遵循 @tanstack/react-query SSR 最佳实践
 */
function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000, // 30s 内不重新请求
        retry: 1,
      },
    },
  });
}

let browserQueryClient: QueryClient | undefined;

function getQueryClient() {
  if (typeof window === 'undefined') {
    // 服务端渲染：每次新建（避免跨请求共享状态）
    return makeQueryClient();
  }
  // 浏览器：复用同一个实例
  if (!browserQueryClient) browserQueryClient = makeQueryClient();
  return browserQueryClient;
}

/**
 * 客户端全局 Provider
 * - @tanstack/react-query QueryClientProvider
 * - 应用主题（dark/light）
 * - Toast 容器
 *
 * Note: Locale / i18n is now provided by <NextIntlClientProvider> in app/layout.tsx.
 */
export const Providers: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [queryClient] = useState(() => getQueryClient());
  const theme = useAppStore((s) => s.theme);
  const { toasts, removeToast } = useToastStore();

  // 应用主题
  useEffect(() => {
    document.documentElement.classList.remove('light', 'dark');
    document.documentElement.classList.add(theme);
  }, [theme]);

  return (
    <QueryClientProvider client={queryClient}>
      <ModalProvider />
      <AutoLoginHandler />
      <ChunkReloadHandler />
      <ToastContainer toasts={toasts} removeToastAction={removeToast} />
      {children}
    </QueryClientProvider>
  );
};
