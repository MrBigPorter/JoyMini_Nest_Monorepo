'use client';

import { useState, useEffect } from 'react';
import { detectEnvironment, getEnvironmentName, isClient } from '../env';

/**
 * 🎣 React Hook 版本的环境检测
 *
 * 完美解决Hydration不匹配问题:
 * - 第一次渲染永远返回服务端状态
 * - Hydrate完成后才切换到客户端状态
 * - 不会有Hydration mismatch警告
 *
 */
export function useEnvironment() {
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
  }, []);

  const env = detectEnvironment();

  return {
    environment: hydrated ? env : 'ssr',
    isServer: !hydrated || !isClient(),
    isClient: hydrated && isClient(),
    isHydrated: hydrated,
    environmentName: getEnvironmentName(),
  };
}

/**
 * 仅在客户端渲染的Hook
 * 服务端永远返回false，Hydrate完成后返回true
 */
export function useClientOnly() {
  const [isClientReady, setIsClientReady] = useState(false);

  useEffect(() => {
    setIsClientReady(true);
  }, []);

  return isClientReady;
}

export default useEnvironment;
