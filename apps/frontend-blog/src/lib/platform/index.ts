/**
 * 平台适配器统一入口
 * 导出所有平台适配器相关功能
 */

// ================= 类型导入 =================
import type {
  QueryKey,
  PlatformQueryKey,
  LogData,
  PlatformType,
  RuntimeEnvironment,
  DeviceInfo,
  NetworkStatus,
  RetryConfig,
  CacheStrategy,
  NavigationOptions,
  RouteInfo,
  PlatformRuntime,
  PlatformCapability,
  PlatformFeature,
  PlatformConfig,
  PlatformEvent,
  PlatformEventListener,
  IPlatformAdapter,
  PlatformQueryOptions,
  PlatformMutationOptions,
  PlatformInfiniteQueryOptions,
} from './types';

// ================= 类型导出 =================
export type {
  PlatformType,
  RuntimeEnvironment,
  DeviceInfo,
  NetworkStatus,
  RetryConfig,
  CacheStrategy,
  NavigationOptions,
  RouteInfo,
  PlatformRuntime,
  PlatformCapability,
  PlatformFeature,
  PlatformConfig,
  PlatformEvent,
  PlatformEventListener,
  IPlatformAdapter,
  PlatformQueryOptions,
  PlatformMutationOptions,
  PlatformInfiniteQueryOptions,
} from './types';

export { PlatformNotSupportedError, NetworkError, CacheError } from './types';

// ================= 检测器导出 =================
export {
  detectPlatform,
  getDeviceInfo,
  getRuntimeInfo,
  supportsFeature,
  resetCache,
} from './detectors/runtime.detector';

// ================= 工厂导出 =================
export {
  getPlatformAdapter,
  clearAdapterCache,
} from './factories/adapter-factory';

export {
  createPlatformQuery,
  createPlatformMutation,
  createPlatformInfiniteQuery,
  createSimplePlatformQuery,
  createSimplePlatformMutation,
} from './factories/query-factory';

// ================= Hooks导出 =================
export {
  usePlatformQuery,
  usePlatformMutation,
  usePlatformInfiniteQuery,
  useSimplePlatformQuery,
  useSimplePlatformMutation,
  usePlatformQueryWithLocale,
  usePlatformQueryWithRetry,
  usePlatformQueryWithOfflineSupport,
  usePlatformQueryWithPrefetch,
  usePlatformAdapter,
  usePlatformFeature,
  useDeviceInfo,
  useNetworkStatus,
  useIsOnline,
  useIsOffline,
} from './hooks/usePlatformQuery';

// ================= 工具函数 =================

// 重新导入需要的函数
import { getPlatformAdapter } from './factories/adapter-factory';
import { getDeviceInfo } from './detectors/runtime.detector';
import { PlatformNotSupportedError } from './types';

/**
 * 获取当前平台信息
 */
export function getCurrentPlatformInfo() {
  const adapter = getPlatformAdapter();
  const deviceInfo = getDeviceInfo();

  return {
    platform: adapter.platform,
    version: adapter.version,
    deviceInfo,
    capabilities: {
      serverActions: adapter.network.supportsServerActions(),
      persistentCache: adapter.cache.supportsPersistentCache(),
      pushNotifications: adapter.device.supportsPush(),
      camera: adapter.device.supportsCamera(),
      geolocation: adapter.device.supportsGeolocation(),
    },
  };
}

/**
 * 检查是否支持Server Actions
 */
export function supportsServerActions(): boolean {
  return getPlatformAdapter().network.supportsServerActions();
}

/**
 * 执行平台感知的Server Action（自动降级）
 */
export async function executePlatformAction<T>(
  action: () => Promise<T>,
  fallback?: () => Promise<T>,
): Promise<T> {
  const adapter = getPlatformAdapter();

  if (adapter.network.supportsServerActions()) {
    try {
      return await action();
    } catch (error) {
      adapter.logger.warn('Server Action失败:', error);
      if (fallback) {
        return await fallback();
      }
      throw error;
    }
  }

  // 不支持Server Actions的平台
  if (fallback) {
    return await fallback();
  }

  throw new PlatformNotSupportedError('server-actions');
}

/**
 * 创建平台感知的Query Key
 */
export function createPlatformQueryKey(baseKey: QueryKey): PlatformQueryKey {
  return getPlatformAdapter().query.buildQueryKey(baseKey);
}

/**
 * 获取平台特定的缓存配置
 */
export function getPlatformCacheConfig() {
  const adapter = getPlatformAdapter();
  return {
    staleTime: adapter.query.getStaleTime(),
    gcTime: adapter.query.getGcTime(),
    strategy: adapter.cache.getStrategy(),
  };
}

/**
 * 平台感知的日志记录
 */
export const platformLogger = {
  info: (message: string, data?: LogData) => {
    getPlatformAdapter().logger.info(message, data);
  },
  warn: (message: string, data?: LogData) => {
    getPlatformAdapter().logger.warn(message, data);
  },
  error: (message: string, data?: LogData) => {
    getPlatformAdapter().logger.error(message, data);
  },
  debug: (message: string, data?: LogData) => {
    getPlatformAdapter().logger.debug(message, data);
  },
};

// ================= 默认导出 =================

// 导入所有需要的函数用于默认导出
import { getPlatformAdapter as adapterFunc } from './factories/adapter-factory';
import { getDeviceInfo as deviceInfoFunc } from './detectors/runtime.detector';
import { detectPlatform as detectPlatformFunc } from './detectors/runtime.detector';
import { getRuntimeInfo as getRuntimeInfoFunc } from './detectors/runtime.detector';
import { supportsFeature as supportsFeatureFunc } from './detectors/runtime.detector';
import { resetCache as resetCacheFunc } from './detectors/runtime.detector';
import { clearAdapterCache as clearAdapterCacheFunc } from './factories/adapter-factory';
import { createPlatformQuery as createPlatformQueryFunc } from './factories/query-factory';
import { createPlatformMutation as createPlatformMutationFunc } from './factories/query-factory';
import { createPlatformInfiniteQuery as createPlatformInfiniteQueryFunc } from './factories/query-factory';
import { createSimplePlatformQuery as createSimplePlatformQueryFunc } from './factories/query-factory';
import { createSimplePlatformMutation as createSimplePlatformMutationFunc } from './factories/query-factory';

// 导入Hooks函数
import {
  usePlatformQuery as usePlatformQueryFunc,
  usePlatformMutation as usePlatformMutationFunc,
  usePlatformInfiniteQuery as usePlatformInfiniteQueryFunc,
  useSimplePlatformQuery as useSimplePlatformQueryFunc,
  useSimplePlatformMutation as useSimplePlatformMutationFunc,
  usePlatformQueryWithLocale as usePlatformQueryWithLocaleFunc,
  usePlatformQueryWithRetry as usePlatformQueryWithRetryFunc,
  usePlatformQueryWithOfflineSupport as usePlatformQueryWithOfflineSupportFunc,
  usePlatformQueryWithPrefetch as usePlatformQueryWithPrefetchFunc,
  usePlatformAdapter as usePlatformAdapterFunc,
  usePlatformFeature as usePlatformFeatureFunc,
  useDeviceInfo as useDeviceInfoFunc,
  useNetworkStatus as useNetworkStatusFunc,
  useIsOnline as useIsOnlineFunc,
  useIsOffline as useIsOfflineFunc,
} from './hooks/usePlatformQuery';

// 导入错误类
import {
  PlatformNotSupportedError as PlatformNotSupportedErrorClass,
  NetworkError as NetworkErrorClass,
  CacheError as CacheErrorClass,
} from './types';

/**
 * 平台适配器默认导出
 */
const platform = {
  // 类型
  types: {
    PlatformType: {} as PlatformType,
    RuntimeEnvironment: {} as RuntimeEnvironment,
    DeviceInfo: {} as DeviceInfo,
    NetworkStatus: {} as NetworkStatus,
    RetryConfig: {} as RetryConfig,
    CacheStrategy: {} as CacheStrategy,
    NavigationOptions: {} as NavigationOptions,
    RouteInfo: {} as RouteInfo,
    PlatformRuntime: {} as PlatformRuntime,
    PlatformCapability: {} as PlatformCapability,
    PlatformFeature: {} as PlatformFeature,
    PlatformConfig: {} as PlatformConfig,
    PlatformEvent: {} as PlatformEvent,
    PlatformEventListener: {} as PlatformEventListener,
    IPlatformAdapter: {} as IPlatformAdapter,
    PlatformQueryOptions: {} as PlatformQueryOptions<unknown>,
    PlatformMutationOptions: {} as PlatformMutationOptions<
      unknown,
      unknown,
      unknown
    >,
    PlatformInfiniteQueryOptions: {} as PlatformInfiniteQueryOptions<
      unknown,
      unknown
    >,
  },

  // 错误
  errors: {
    PlatformNotSupportedError: PlatformNotSupportedErrorClass,
    NetworkError: NetworkErrorClass,
    CacheError: CacheErrorClass,
  },

  // 检测器
  detectors: {
    detectPlatform: detectPlatformFunc,
    getDeviceInfo: deviceInfoFunc,
    getRuntimeInfo: getRuntimeInfoFunc,
    supportsFeature: supportsFeatureFunc,
    resetCache: resetCacheFunc,
  },

  // 工厂
  factories: {
    getPlatformAdapter: adapterFunc,
    clearAdapterCache: clearAdapterCacheFunc,
    createPlatformQuery: createPlatformQueryFunc,
    createPlatformMutation: createPlatformMutationFunc,
    createPlatformInfiniteQuery: createPlatformInfiniteQueryFunc,
    createSimplePlatformQuery: createSimplePlatformQueryFunc,
    createSimplePlatformMutation: createSimplePlatformMutationFunc,
  },

  // Hooks
  hooks: {
    usePlatformQuery: usePlatformQueryFunc,
    usePlatformMutation: usePlatformMutationFunc,
    usePlatformInfiniteQuery: usePlatformInfiniteQueryFunc,
    useSimplePlatformQuery: useSimplePlatformQueryFunc,
    useSimplePlatformMutation: useSimplePlatformMutationFunc,
    usePlatformQueryWithLocale: usePlatformQueryWithLocaleFunc,
    usePlatformQueryWithRetry: usePlatformQueryWithRetryFunc,
    usePlatformQueryWithOfflineSupport: usePlatformQueryWithOfflineSupportFunc,
    usePlatformQueryWithPrefetch: usePlatformQueryWithPrefetchFunc,
    usePlatformAdapter: usePlatformAdapterFunc,
    usePlatformFeature: usePlatformFeatureFunc,
    useDeviceInfo: useDeviceInfoFunc,
    useNetworkStatus: useNetworkStatusFunc,
    useIsOnline: useIsOnlineFunc,
    useIsOffline: useIsOfflineFunc,
  },

  // 工具函数
  utils: {
    getCurrentPlatformInfo,
    supportsServerActions,
    executePlatformAction,
    createPlatformQueryKey,
    getPlatformCacheConfig,
    platformLogger,
  },

  // 快捷方式
  adapter: adapterFunc,
  logger: platformLogger,
};

export default platform;
