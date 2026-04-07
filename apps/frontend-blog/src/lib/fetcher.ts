/**
 * 🎯 多模式 Fetcher 适配层 - 整个架构的核心
 *
 * 设计目标:
 *  所有三种模式使用完全相同的业务代码
 *  业务代码不需要关心运行环境
 *  写操作自动在服务端跳过
 *  缓存策略自动适配环境
 *
 * 这是唯一知道环境差异的文件，所有其他代码都只使用这个统一接口
 */

import {
  detectEnvironment,
  isClient,
  isServer,
  isBuildTime,
  isRuntimeServer,
} from './env';

/**
 * Fetcher 请求选项
 */
export interface FetchOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  headers?: Record<string, string>;
  body?: any;
  cache?: RequestCache;
  next?: NextFetchRequestConfig;

  /**
   * 接口类型标记
   * - read: 只读接口，支持所有环境
   * - write: 写操作接口，仅客户端执行
   */
  type?: 'read' | 'write';

  /**
   * 缓存时间 (秒)
   * 自动根据环境适配
   */
  ttl?: number;
}

/**
 * Fetcher 响应
 */
export interface FetchResponse<T = any> {
  data: T;
  status: number;
  ok: boolean;
  error?: string;
  fromCache?: boolean;
  environment: string;
}

/**
 * 通用Fetcher接口 - 所有环境的统一入口
 */
async function universalFetcher<T = any>(
  url: string,
  options: FetchOptions = {},
): Promise<FetchResponse<T>> {
  const env = detectEnvironment();

  //  写操作接口: 服务端直接返回，不执行
  if (options.type === 'write' && isServer()) {
    console.log(`[${env}] 写操作接口在服务端跳过: ${url}`);
    return {
      data: null as T,
      status: 202,
      ok: true,
      error: '写操作仅在客户端执行',
      environment: env,
    };
  }

  try {
    // 根据环境选择不同的底层实现
    switch (env) {
      case 'csr':
        return await clientFetch<T>(url, options);

      case 'ssg':
        return await buildTimeFetch<T>(url, options);

      case 'ssr':
        return await serverFetch<T>(url, options);

      default:
        return await clientFetch<T>(url, options);
    }
  } catch (error) {
    console.error(`[${env}] 请求失败: ${url}`, error);

    return {
      data: null as T,
      status: 500,
      ok: false,
      error: error instanceof Error ? error.message : '未知错误',
      environment: env,
    };
  }
}

/**
 * 🖥️ 客户端浏览器 Fetch 实现
 */
async function clientFetch<T>(
  url: string,
  options: FetchOptions,
): Promise<FetchResponse<T>> {
  const fullUrl = `${process.env.NEXT_PUBLIC_API_URL || ''}${url}`;

  const response = await fetch(fullUrl, {
    method: options.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    credentials: 'include',
  });

  const data = await response.json();

  return {
    data,
    status: response.status,
    ok: response.ok,
    environment: 'csr',
  };
}

/**
 * 🏗️ 构建时 SSG Fetch 实现
 */
async function buildTimeFetch<T>(
  url: string,
  options: FetchOptions,
): Promise<FetchResponse<T>> {
  const fullUrl = `${process.env.NEXT_PUBLIC_API_URL || ''}${url}`;

  const cacheTtl = options.ttl || 3600;

  const response = await fetch(fullUrl, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    next: {
      revalidate: cacheTtl,
    },
  });

  const data = await response.json();

  return {
    data,
    status: response.status,
    ok: response.ok,
    environment: 'ssg',
  };
}

/**
 * 🚀 服务端 SSR Fetch 实现
 *
 * 未来会替换为内部 gRPC 直接调用，不走HTTP网络
 */
async function serverFetch<T>(
  url: string,
  options: FetchOptions,
): Promise<FetchResponse<T>> {
  const fullUrl = `${process.env.INTERNAL_API_URL || process.env.NEXT_PUBLIC_API_URL || ''}${url}`;

  const cacheTtl = options.ttl || 60;

  const response = await fetch(fullUrl, {
    method: options.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    cache: 'force-cache',
    next: {
      revalidate: cacheTtl,
    },
  });

  const data = await response.json();

  return {
    data,
    status: response.status,
    ok: response.ok,
    environment: 'ssr',
  };
}

// 导出快捷方法
export const fetcher = {
  get: <T>(url: string, options?: Omit<FetchOptions, 'method' | 'body'>) =>
    universalFetcher<T>(url, { ...options, method: 'GET', type: 'read' }),

  post: <T>(
    url: string,
    body?: any,
    options?: Omit<FetchOptions, 'method' | 'body'>,
  ) =>
    universalFetcher<T>(url, {
      ...options,
      method: 'POST',
      body,
      type: 'write',
    }),

  put: <T>(
    url: string,
    body?: any,
    options?: Omit<FetchOptions, 'method' | 'body'>,
  ) =>
    universalFetcher<T>(url, {
      ...options,
      method: 'PUT',
      body,
      type: 'write',
    }),

  delete: <T>(url: string, options?: Omit<FetchOptions, 'method' | 'body'>) =>
    universalFetcher<T>(url, { ...options, method: 'DELETE', type: 'write' }),

  patch: <T>(
    url: string,
    body?: any,
    options?: Omit<FetchOptions, 'method' | 'body'>,
  ) =>
    universalFetcher<T>(url, {
      ...options,
      method: 'PATCH',
      body,
      type: 'write',
    }),

  // 原始通用接口
  request: universalFetcher,
};

export default fetcher;
