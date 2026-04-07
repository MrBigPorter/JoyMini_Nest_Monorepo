'use client';

import { ReactNode } from 'react';
import { useClientOnly } from '../hooks/useEnvironment';

/**
 * 🔒 仅客户端渲染组件
 *
 * 服务端和构建时渲染 fallback 内容
 * Hydrate完成后自动渲染children
 * 完美解决Hydration不匹配问题
 *
 *
 * 用法:
 * ```tsx
 * <ClientOnly fallback={<Skeleton />}>
 *   <InteractiveButton />
 * </ClientOnly>
 * ```
 */
interface ClientOnlyProps {
  children: ReactNode;
  fallback?: ReactNode;
}

export default function ClientOnly({
  children,
  fallback = null,
}: ClientOnlyProps) {
  const isClient = useClientOnly();
  return isClient ? children : fallback;
}

export { ClientOnly };
