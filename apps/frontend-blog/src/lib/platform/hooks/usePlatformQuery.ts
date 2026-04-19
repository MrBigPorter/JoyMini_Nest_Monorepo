/**
 * 平台感知的React Query Hooks
 * 完全兼容React Query API，同时提供平台适配功能
 */

import {
  useQuery,
  useMutation,
  useInfiniteQuery,
  type UseQueryOptions,
  type UseQueryResult,
  type UseMutationOptions,
  type UseMutationResult,
  type UseInfiniteQueryOptions,
  type UseInfiniteQueryResult,
} from '@tanstack/react-query';

import {
  createPlatformQuery,
  createPlatformMutation,
  createPlatformInfiniteQuery,
  createSimplePlatformQuery,
  createSimplePlatformMutation,
} from '../factories/query-factory';
import type {
  PlatformQueryOptions,
  PlatformMutationOptions,
  PlatformInfiniteQueryOptions,
} from '../types';

/**
 * 平台感知的useQuery Hook
 * 完全兼容React Query的useQuery API
 */
export function usePlatformQuery<T>(
  options: PlatformQueryOptions<T>,
): UseQueryResult<T> {
  const queryOptions = createPlatformQuery(options);
  return useQuery(queryOptions as UseQueryOptions<T>);
}

/**
 * 平台感知的useMutation Hook
 */
export function usePlatformMutation<
  TData = unknown,
  TVariables = void,
  TContext = unknown,
>(
  options: PlatformMutationOptions<TData, TVariables, TContext>,
): UseMutationResult<TData, Error, TVariables, TContext> {
  const mutationOptions = createPlatformMutation(options);
  return useMutation(mutationOptions);
}

/**
 * 平台感知的useInfiniteQuery Hook
 */
export function usePlatformInfiniteQuery<T, TPageParam = unknown>(
  options: PlatformInfiniteQueryOptions<T, TPageParam>,
): UseInfiniteQueryResult<T> {
  const infiniteQueryOptions = createPlatformInfiniteQuery(options);
  return useInfiniteQuery(
    infiniteQueryOptions as UseInfiniteQueryOptions<T, Error, T>,
  );
}

/**
 * 简化版平台感知useQuery
 */
export function useSimplePlatformQuery<T>(
  queryKey: any[],
  apiCall: () => Promise<T>,
  options?: {
    serverAction?: () => Promise<T>;
    enabled?: boolean;
    staleTime?: number;
    gcTime?: number;
  },
): UseQueryResult<T> {
  const queryOptions = createSimplePlatformQuery(queryKey, apiCall, options);
  return useQuery(queryOptions as UseQueryOptions<T>);
}

/**
 * 简化版平台感知useMutation
 */
export function useSimplePlatformMutation<TData = unknown, TVariables = void>(
  apiCall: (variables: TVariables) => Promise<TData>,
  options?: {
    serverAction?: (variables: TVariables) => Promise<TData>;
    onSuccess?: (data: TData, variables: TVariables) => void;
    onError?: (error: Error, variables: TVariables) => void;
  },
): UseMutationResult<TData, Error, TVariables> {
  const mutationOptions = createSimplePlatformMutation(apiCall, options);
  return useMutation(mutationOptions);
}

/**
 * 平台感知的useQuery Hook（带自动语言处理）
 */
export function usePlatformQueryWithLocale<T>(
  options: PlatformQueryOptions<T> & { locale?: string },
): UseQueryResult<T> {
  const { locale, ...restOptions } = options;

  // 自动添加locale到queryKey
  const queryKeyWithLocale = locale
    ? [...restOptions.queryKey, { locale }]
    : restOptions.queryKey;

  const queryOptions = createPlatformQuery({
    ...restOptions,
    queryKey: queryKeyWithLocale,
  });

  return useQuery(queryOptions as UseQueryOptions<T>);
}

/**
 * 平台感知的useQuery Hook（带自动重试配置）
 */
export function usePlatformQueryWithRetry<T>(
  options: PlatformQueryOptions<T> & {
    retry?: number;
    retryDelay?: (attemptIndex: number) => number;
  },
): UseQueryResult<T> {
  const { retry, retryDelay, ...restOptions } = options;

  const queryOptions = createPlatformQuery(restOptions);

  // 覆盖重试配置
  if (retry !== undefined) {
    queryOptions.retry = retry;
  }
  if (retryDelay !== undefined) {
    queryOptions.retryDelay = retryDelay;
  }

  return useQuery(queryOptions as UseQueryOptions<T>);
}

/**
 * 平台感知的useQuery Hook（带离线缓存支持）
 */
export function usePlatformQueryWithOfflineSupport<T>(
  options: PlatformQueryOptions<T> & {
    useCacheWhenOffline?: boolean;
  },
): UseQueryResult<T> {
  const { useCacheWhenOffline = true, ...restOptions } = options;

  const queryOptions = createPlatformQuery({
    ...restOptions,
    platformOptions: {
      ...restOptions.platformOptions,
      useCacheWhenOffline,
    },
  });

  return useQuery(queryOptions as UseQueryOptions<T>);
}

/**
 * 平台感知的useQuery Hook（带预取支持）
 */
export function usePlatformQueryWithPrefetch<T>(
  options: PlatformQueryOptions<T> & {
    prefetch?: boolean;
  },
): UseQueryResult<T> {
  const { prefetch = false, ...restOptions } = options;

  const queryOptions = createPlatformQuery({
    ...restOptions,
    platformOptions: {
      ...restOptions.platformOptions,
      prefetch,
    },
  });

  return useQuery(queryOptions as UseQueryOptions<T>);
}

// ================= 工具Hooks =================

/**
 * 获取当前平台适配器
 */
import { getPlatformAdapter as getAdapter } from '../factories/adapter-factory';

export function usePlatformAdapter() {
  // 注意：这里不能使用useMemo，因为平台可能在运行时变化
  return getAdapter();
}

/**
 * 检查当前平台是否支持特定功能
 */
import { supportsFeature } from '../detectors/runtime.detector';

export function usePlatformFeature(feature: string): boolean {
  return supportsFeature(feature);
}

/**
 * 获取设备信息
 */
import { getDeviceInfo } from '../detectors/runtime.detector';

export function useDeviceInfo() {
  return getDeviceInfo();
}

/**
 * 获取网络状态
 */
import { useState, useEffect } from 'react';

export function useNetworkStatus() {
  const adapter = usePlatformAdapter();
  const [status, setStatus] = useState(adapter.network.getNetworkStatus());

  useEffect(() => {
    const cleanup = adapter.network.addNetworkStatusListener(setStatus);
    return cleanup;
  }, [adapter]);

  return status;
}

/**
 * 检查是否在线
 */
export function useIsOnline(): boolean {
  const status = useNetworkStatus();
  return status === 'online';
}

/**
 * 检查是否离线
 */
export function useIsOffline(): boolean {
  const status = useNetworkStatus();
  return status === 'offline';
}

// ================= 导出 =================

// 注意：函数已经在顶部声明为export，这里不需要重复导出
