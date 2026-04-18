/**
 * 平台感知的Query工厂
 * 将平台适配器配置转换为React Query配置
 */

import type {
  PlatformQueryOptions,
  PlatformMutationOptions,
  PlatformInfiniteQueryOptions,
} from '../types';
import { getPlatformAdapter } from './adapter-factory';

/**
 * 创建平台感知的Query配置
 */
export function createPlatformQuery<T>(options: PlatformQueryOptions<T>) {
  const adapter = getPlatformAdapter();
  
  return {
    // 1. Query Key处理（添加平台前缀）
    queryKey: adapter.query.buildQueryKey(options.queryKey),
    
    // 2. Query Function处理（Server Actions降级）
    queryFn: async () => {
      // 支持Server Actions的平台
      if (adapter.network.supportsServerActions() && options.serverAction) {
        try {
          return await options.serverAction();
        } catch (error) {
          adapter.logger.warn('Server Action失败，降级到API调用:', error);
          return await options.apiCall();
        }
      }
      
      // 不支持Server Actions的平台
      return await options.apiCall();
    },
    
    // 3. 缓存配置（平台感知）
    staleTime: adapter.query.getStaleTime(),
    gcTime: adapter.query.getGcTime(),
    
    // 4. 重试配置（平台感知）
    retry: adapter.query.getRetryConfig().retry,
    retryDelay: adapter.query.getRetryConfig().retryDelay,
    
    // 5. 其他配置透传
    enabled: options.enabled,
    refetchOnWindowFocus: adapter.query.supportsBackgroundRefetch(),
    refetchOnReconnect: adapter.query.supportsBackgroundRefetch(),
    
    // 6. 平台特定的初始数据
    initialData: options.initialData,
    
    // 7. 选择器（可选）
    select: options.select,
    
    // 8. 平台特定的选项
    meta: {
      platform: adapter.platform,
      platformOptions: options.platformOptions,
    },
  };
}

/**
 * 创建平台感知的Mutation配置
 */
export function createPlatformMutation<TData, TVariables, TContext = unknown>(
  options: PlatformMutationOptions<TData, TVariables, TContext>
) {
  const adapter = getPlatformAdapter();
  
  return {
    // Mutation Function处理（Server Actions降级）
    mutationFn: async (variables: TVariables) => {
      if (adapter.network.supportsServerActions() && options.serverAction) {
        try {
          return await options.serverAction(variables);
        } catch (error) {
          adapter.logger.warn('Server Action失败，降级到API调用:', error);
          return await options.apiCall(variables);
        }
      }
      
      return await options.apiCall(variables);
    },
    
    // 乐观更新配置
    onMutate: options.onMutate,
    onSuccess: options.onSuccess,
    onError: options.onError,
    onSettled: options.onSettled,
    
    // 重试配置
    retry: adapter.query.getRetryConfig().retry,
    retryDelay: adapter.query.getRetryConfig().retryDelay,
    
    // 平台特定的选项
    meta: {
      platform: adapter.platform,
      platformOptions: options.platformOptions,
    },
  };
}

/**
 * 创建平台感知的Infinite Query配置
 */
export function createPlatformInfiniteQuery<T, TPageParam = unknown>(
  options: PlatformInfiniteQueryOptions<T, TPageParam>
) {
  const adapter = getPlatformAdapter();
  
  return {
    // Query Key处理
    queryKey: adapter.query.buildQueryKey(options.queryKey),
    
    // Query Function处理
    queryFn: async ({ pageParam = options.initialPageParam }) => {
      if (adapter.network.supportsServerActions() && options.serverAction) {
        try {
          return await options.serverAction({ pageParam });
        } catch (error) {
          adapter.logger.warn('Server Action失败，降级到API调用:', error);
          return await options.apiCall({ pageParam });
        }
      }
      
      return await options.apiCall({ pageParam });
    },
    
    // 分页参数处理
    getNextPageParam: options.getNextPageParam,
    getPreviousPageParam: options.getPreviousPageParam,
    initialPageParam: options.initialPageParam,
    
    // 缓存配置
    staleTime: adapter.query.getStaleTime(),
    gcTime: adapter.query.getGcTime(),
    
    // 重试配置
    retry: adapter.query.getRetryConfig().retry,
    retryDelay: adapter.query.getRetryConfig().retryDelay,
    
    // 平台特定的选项
    meta: {
      platform: adapter.platform,
    },
  };
}

/**
 * 创建平台感知的Query配置（简化版）
 */
export function createSimplePlatformQuery<T>(
  queryKey: any[],
  apiCall: () => Promise<T>,
  options?: {
    serverAction?: () => Promise<T>;
    enabled?: boolean;
    staleTime?: number;
    gcTime?: number;
  }
) {
  const adapter = getPlatformAdapter();
  
  return {
    queryKey: adapter.query.buildQueryKey(queryKey),
    queryFn: async () => {
      if (adapter.network.supportsServerActions() && options?.serverAction) {
        try {
          return await options.serverAction();
        } catch (error) {
          adapter.logger.warn('Server Action失败，降级到API调用:', error);
          return await apiCall();
        }
      }
      
      return await apiCall();
    },
    enabled: options?.enabled,
    staleTime: options?.staleTime ?? adapter.query.getStaleTime(),
    gcTime: options?.gcTime ?? adapter.query.getGcTime(),
    retry: adapter.query.getRetryConfig().retry,
    retryDelay: adapter.query.getRetryConfig().retryDelay,
    meta: {
      platform: adapter.platform,
    },
  };
}

/**
 * 创建平台感知的Mutation配置（简化版）
 */
export function createSimplePlatformMutation<TData, TVariables>(
  apiCall: (variables: TVariables) => Promise<TData>,
  options?: {
    serverAction?: (variables: TVariables) => Promise<TData>;
    onSuccess?: (data: TData, variables: TVariables) => void;
    onError?: (error: Error, variables: TVariables) => void;
  }
) {
  const adapter = getPlatformAdapter();
  
  return {
    mutationFn: async (variables: TVariables) => {
      if (adapter.network.supportsServerActions() && options?.serverAction) {
        try {
          return await options.serverAction(variables);
        } catch (error) {
          adapter.logger.warn('Server Action失败，降级到API调用:', error);
          return await apiCall(variables);
        }
      }
      
      return await apiCall(variables);
    },
    onSuccess: options?.onSuccess,
    onError: options?.onError,
    retry: adapter.query.getRetryConfig().retry,
    retryDelay: adapter.query.getRetryConfig().retryDelay,
    meta: {
      platform: adapter.platform,
    },
  };
}

// ================= 导出 =================

// 注意：函数已经在顶部声明为export，这里不需要重复导出
