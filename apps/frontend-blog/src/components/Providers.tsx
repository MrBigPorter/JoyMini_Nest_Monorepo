'use client';

import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GoogleOAuthProvider } from '@/lib/components/GoogleOAuthProvider';
import { ThemeProvider } from './ThemeProvider';

/**
 * 统一的客户端 Providers 组件
 * 借鉴 admin-next 的成功架构，将所有客户端 Provider 打包在一起
 * 避免多层嵌套和重复渲染导致的 hydration 问题
 * 注意：I18nProvider 已从 Providers 中移除，因为它需要 NextIntlClientProvider 的上下文
 * I18nProvider 现在在 [locale]/layout.tsx 中，位于 NextIntlClientProvider 内部
 */
export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000, // 30秒内不重新请求
            retry: 1,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <GoogleOAuthProvider>
        <ThemeProvider>{children}</ThemeProvider>
      </GoogleOAuthProvider>
    </QueryClientProvider>
  );
}
