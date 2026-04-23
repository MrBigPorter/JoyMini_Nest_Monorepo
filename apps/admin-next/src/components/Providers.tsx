'use client';

import React, { useEffect, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAppStore } from '@/store/useAppStore';
import { ToastContainer } from '@/components/UIComponents';
import { useToastStore } from '@/store/useToastStore';
import { LanguageProvider } from '@/hooks/LanguageProvider';
import ChunkReloadHandler from './ChunkReloadHandler';

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
 */
export const Providers: React.FC<any> = ({ children, initialLocale, initialTranslations }) => {
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
      {/* pass server-detected initialLocale to LanguageProvider to keep SSR/CSR in sync */}
      <LanguageProvider initialLocale={initialLocale as any} initialTranslations={initialTranslations}>
        <ChunkReloadHandler />
        <ToastContainer toasts={toasts} removeToastAction={removeToast} />
        {children}
      </LanguageProvider>
    </QueryClientProvider>
  );
};
