/**
 * 平台适配器核心类型定义
 * 专为React Query集成优化设计
 */

// ================= 基础类型 =================

/** 支持的平台类型 */
export type PlatformType = 'web' | 'h5' | 'capacitor' | 'server';

/** 运行时环境类型 */
export type RuntimeEnvironment = 'csr' | 'ssr' | 'ssg';

/** 设备信息 */
export interface DeviceInfo {
  platform: PlatformType;
  isMobile: boolean;
  isTablet: boolean;
  isDesktop: boolean;
  os: string;
  browser: string;
  screenSize: {
    width: number;
    height: number;
  };
}

/** 网络状态 */
export type NetworkStatus = 'online' | 'offline' | 'slow';

/** 重试配置 */
export interface RetryConfig {
  retry: number;
  retryDelay: (attemptIndex: number) => number;
}

/** 缓存策略 */
export interface CacheStrategy {
  type: 'memory' | 'persistent' | 'hybrid';
  ttl: number; // 生存时间（毫秒）
  maxSize?: number; // 最大缓存大小
}

/** 导航选项 */
export interface NavigationOptions {
  replace?: boolean;
  scroll?: boolean;
  prefetch?: boolean;
}

/** 路由信息 */
export interface RouteInfo {
  path: string;
  query: Record<string, string>;
  hash?: string;
}

// ================= 平台适配器接口 =================

/**
 * 平台适配器统一接口
 * 专为React Query集成优化设计
 */
export interface IPlatformAdapter {
  // === 平台基本信息 ===
  readonly platform: PlatformType;
  readonly version: string;
  
  // === Query配置 === (React Query集成核心)
  query: {
    /** 为queryKey添加平台/语言前缀 */
    buildQueryKey: (baseKey: any[]) => any[];
    
    /** 获取平台特定的staleTime（毫秒） */
    getStaleTime: () => number;
    
    /** 获取平台特定的gcTime（毫秒） */
    getGcTime: () => number;
    
    /** 是否支持后台重获取 */
    supportsBackgroundRefetch: () => boolean;
    
    /** 获取重试配置 */
    getRetryConfig: () => RetryConfig;
    
    /** 获取默认的查询选项 */
    getDefaultQueryOptions: () => Partial<PlatformQueryOptions<any>>;
  };
  
  // === 网络系统 === (Server Actions降级核心)
  network: {
    /** 执行Server Action（自动降级到API调用） */
    executeAction<T>(action: () => Promise<T>): Promise<T>;
    
    /** 带fallback的Server Action */
    executeActionWithFallback<T>(
      action: () => Promise<T>,
      fallback: () => Promise<T>
    ): Promise<T>;
    
    /** 检查是否支持Server Actions */
    supportsServerActions: () => boolean;
    
    /** 获取网络状态 */
    getNetworkStatus: () => NetworkStatus;
    
    /** 添加网络状态监听器 */
    addNetworkStatusListener: (callback: (status: NetworkStatus) => void) => () => void;
  };
  
  // === 缓存系统 ===
  cache: {
    /** 获取平台缓存策略 */
    getStrategy: () => CacheStrategy;
    
    /** 检查是否支持持久化缓存 */
    supportsPersistentCache: () => boolean;
    
    /** 获取缓存版本（用于缓存失效） */
    getCacheVersion: () => string;
    
    /** 清除平台缓存 */
    clearCache: () => Promise<void>;
  };
  
  // === 存储系统 ===
  storage: {
    /** 获取存储项 */
    get: (key: string) => Promise<string | null>;
    
    /** 设置存储项 */
    set: (key: string, value: string) => Promise<void>;
    
    /** 删除存储项 */
    remove: (key: string) => Promise<void>;
    
    /** 清空存储 */
    clear: () => Promise<void>;
  };
  
  // === 导航系统 ===
  navigation: {
    /** 跳转到指定URL */
    goTo: (url: string, options?: NavigationOptions) => Promise<void> | void;
    
    /** 返回上一页 */
    back: () => Promise<void> | void;
    
    /** 获取当前路由信息 */
    getCurrentRoute: () => Promise<RouteInfo> | RouteInfo;
    
    /** 预取页面 */
    prefetch: (url: string) => Promise<void>;
  };
  
  // === 设备功能 ===
  device: {
    /** 获取设备信息 */
    getInfo: () => DeviceInfo;
    
    /** 检查是否支持推送通知 */
    supportsPush: () => boolean;
    
    /** 检查是否支持相机 */
    supportsCamera: () => boolean;
    
    /** 检查是否支持地理位置 */
    supportsGeolocation: () => boolean;
    
    /** 获取设备唯一标识 */
    getDeviceId: () => Promise<string>;
  };
  
  // === 日志系统 ===
  logger: {
    info: (message: string, data?: any) => void;
    warn: (message: string, data?: any) => void;
    error: (message: string, data?: any) => void;
    debug: (message: string, data?: any) => void;
  };
}

// ================= React Query集成类型 =================

/** 平台感知的Query选项 */
export interface PlatformQueryOptions<T = unknown> {
  /** 基础queryKey（平台适配器会自动添加前缀） */
  queryKey: any[];
  
  /** API调用函数（所有平台都支持） */
  apiCall: () => Promise<T>;
  
  /** Server Action函数（仅支持Server Actions的平台使用） */
  serverAction?: () => Promise<T>;
  
  /** 是否启用查询 */
  enabled?: boolean;
  
  /** 初始数据 */
  initialData?: T;
  
  /** 数据选择器 */
  select?: (data: T) => any;
  
  /** 平台特定的额外选项 */
  platformOptions?: {
    /** 离线时是否使用缓存 */
    useCacheWhenOffline?: boolean;
    
    /** 网络慢时是否降级 */
    degradeOnSlowNetwork?: boolean;
    
    /** 是否预取数据 */
    prefetch?: boolean;
  };
}

/** 平台感知的Mutation选项 */
export interface PlatformMutationOptions<TData = unknown, TVariables = void, TContext = unknown> {
  /** API调用函数（所有平台都支持） */
  apiCall: (variables: TVariables) => Promise<TData>;
  
  /** Server Action函数（仅支持Server Actions的平台使用） */
  serverAction?: (variables: TVariables) => Promise<TData>;
  
  /** 乐观更新：在mutation执行前更新UI */
  onMutate?: (variables: TVariables) => Promise<TContext> | TContext;
  
  /** 成功回调 */
  onSuccess?: (data: TData, variables: TVariables, context: TContext) => Promise<void> | void;
  
  /** 错误回调 */
  onError?: (error: Error, variables: TVariables, context: TContext | undefined) => Promise<void> | void;
  
  /** 完成回调（无论成功或失败） */
  onSettled?: (data: TData | undefined, error: Error | null, variables: TVariables, context: TContext | undefined) => Promise<void> | void;
  
  /** 平台特定的额外选项 */
  platformOptions?: {
    /** 是否在离线时排队 */
    queueWhenOffline?: boolean;
    
    /** 是否显示加载状态 */
    showLoading?: boolean;
    
    /** 重试策略 */
    retryStrategy?: 'immediate' | 'exponential' | 'none';
  };
}

/** 平台感知的Infinite Query选项 */
export interface PlatformInfiniteQueryOptions<T = unknown, TPageParam = unknown> {
  /** 基础queryKey */
  queryKey: any[];
  
  /** API调用函数 */
  apiCall: (context: { pageParam?: TPageParam }) => Promise<T>;
  
  /** Server Action函数 */
  serverAction?: (context: { pageParam?: TPageParam }) => Promise<T>;
  
  /** 获取下一页参数 */
  getNextPageParam: (lastPage: T, allPages: T[]) => TPageParam | undefined;
  
  /** 获取上一页参数 */
  getPreviousPageParam?: (firstPage: T, allPages: T[]) => TPageParam | undefined;
  
  /** 初始页参数 */
  initialPageParam?: TPageParam;
}

// ================= 平台运行时信息 =================

/** 平台运行时信息 */
export interface PlatformRuntime {
  type: PlatformType;
  environment: RuntimeEnvironment;
  capabilities: PlatformCapability[];
  features: PlatformFeature[];
}

/** 平台能力 */
export type PlatformCapability = 
  | 'ssr'           // 服务端渲染
  | 'ssg'           // 静态生成
  | 'csr'           // 客户端渲染
  | 'server-actions' // Server Actions
  | 'edge-cache'    // 边缘缓存
  | 'persistent-cache' // 持久化缓存
  | 'background-sync' // 后台同步
  | 'push-notifications' // 推送通知
  | 'native-storage' // 原生存储
  | 'camera'        // 相机访问
  | 'geolocation';  // 地理位置

/** 平台特性 */
export type PlatformFeature = 
  | 'fast-network'  // 快速网络
  | 'unlimited-data' // 无限流量
  | 'high-memory'   // 高内存
  | 'power-saving'  // 省电模式
  | 'dark-mode'     // 深色模式
  | 'accessibility' // 无障碍功能
  | 'offline-support'; // 离线支持

// ================= 错误类型 =================

/** 平台不支持错误 */
export class PlatformNotSupportedError extends Error {
  constructor(feature: string) {
    super(`Platform does not support: ${feature}`);
    this.name = 'PlatformNotSupportedError';
  }
}

/** 网络错误 */
export class NetworkError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = 'NetworkError';
  }
}

/** 缓存错误 */
export class CacheError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CacheError';
  }
}

// ================= 工具类型 =================

/** 平台配置 */
export interface PlatformConfig {
  /** 是否启用调试日志 */
  debug: boolean;
  
  /** 默认缓存时间（毫秒） */
  defaultCacheTime: number;
  
  /** 默认重试次数 */
  defaultRetryCount: number;
  
  /** 平台特定的配置 */
  platformSpecific: {
    web?: Record<string, any>;
    h5?: Record<string, any>;
    capacitor?: Record<string, any>;
  };
}

/** 平台事件 */
export type PlatformEvent = 
  | 'platform-change'     // 平台变化
  | 'network-status-change' // 网络状态变化
  | 'storage-change'      // 存储变化
  | 'app-foreground'      // 应用进入前台
  | 'app-background';     // 应用进入后台

/** 平台事件监听器 */
export type PlatformEventListener = (event: PlatformEvent, data?: any) => void;

// ================= 导出所有类型 =================

// 注意：所有类型和类已经在定义时自动导出
// 这里不需要重复导出
