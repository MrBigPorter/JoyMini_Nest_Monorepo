import axios, {
  AxiosInstance,
  AxiosRequestConfig,
  AxiosResponse,
  CanceledError,
  InternalAxiosRequestConfig,
} from 'axios';

import type { ApiResponse, RequestConfig } from './types';
import { useAuthStore } from '@/lib/stores/auth.store';
import { withLocale } from '@/lib/utils/locale';
import { detectLocale } from '@/lib/utils/locale';

/* eslint-disable @typescript-eslint/no-explicit-any */
class HttpClient {
  private readonly instance: AxiosInstance;

  private requestQueue = new Set<string>();
  private pendingControllers = new Map<string, AbortController>();
  private inflightGetRequests = new Map<string, Promise<unknown>>();

  // 重试配置
  private readonly retryConfig = {
    maxRetries: process.env.NODE_ENV === 'test' ? 0 : 3, // 测试环境不重试
    retryDelay: (attemptIndex: number) =>
      process.env.NODE_ENV === 'test'
        ? 0 // 测试环境无延迟
        : Math.min(1000 * 2 ** attemptIndex, 30000),
    retryCondition: (error: any) => {
      // 测试环境不重试
      if (process.env.NODE_ENV === 'test') return false;
      // 网络错误或5xx服务器错误时重试
      return (
        !error.response ||
        (error.response.status >= 500 && error.response.status < 600)
      );
    },
  };

  constructor() {
    // 在SSR环境下，需要使用完整的URL
    const baseURL =
      typeof window === 'undefined'
        ? process.env.INTERNAL_API_URL ||
          process.env.API_BASE_URL ||
          'http://localhost:3000/api'
        : process.env.NEXT_PUBLIC_API_BASE_URL || '/api';

    this.instance = axios.create({
      baseURL,
      timeout: typeof window === 'undefined' ? 5_000 : 30_000, // SSR环境使用更短的超时
      headers: {
        'Content-Type': 'application/json',
      },
    });

    this.setupInterceptors();
  }

  // ================= 拦截器 =================

  private setupInterceptors() {
    // 请求拦截
    this.instance.interceptors.request.use(
      (config: InternalAxiosRequestConfig) => {
        const method = (config.method || 'get').toLowerCase();

        // 1. 语言
        // ✅ 关键修复：如果请求已经显式传递了lang参数，不应该覆盖它！
        // 这是所有语言闪烁问题的根源：拦截器强制覆盖所有请求的lang参数
        const explicitLang = config.params?.lang;

        // 🔴 调试日志
        console.log('[HTTP LANG DEBUG]', config.url, {
          explicitLang,
          params: config.params,
          getLanguage: this.getLanguage(),
        });

        if (explicitLang) {
          // 使用显式传递的语言参数
          config.headers['Accept-Language'] = explicitLang;
          console.log('[HTTP LANG DEBUG] ✅ 使用显式传递的lang:', explicitLang);
        } else {
          // 没有显式传递时，才使用自动检测
          const lang = this.getLanguage();
          if (lang) {
            config.headers['Accept-Language'] = lang;
            config.params = {
              ...config.params,
              lang: lang,
            };
            console.log('[HTTP LANG DEBUG] ⚠️ 使用自动检测的lang:', lang);
          }
        }

        // 2. 认证 token
        const { accessToken } = useAuthStore.getState();
        if (accessToken) {
          config.headers.Authorization = `Bearer ${accessToken}`;
        }

        // 3. CSRF token（对于非GET请求）
        const csrfToken = this.getCsrfToken();
        if (csrfToken && ['post', 'put', 'patch', 'delete'].includes(method)) {
          config.headers['X-CSRF-Token'] = csrfToken;
        }

        // 4. 去重请求 key
        if (method !== 'get') {
          const key = this.genKey(config);
          if (this.requestQueue.has(key)) {
            const oldController = this.pendingControllers.get(key);
            if (oldController) {
              oldController.abort();
            }
            console.warn('[HTTP] duplicate request replaced:', key);
          }

          const controller = new AbortController();
          config.signal = controller.signal;
          this.pendingControllers.set(key, controller);
          this.requestQueue.add(key);
        }

        // 5. dev 日志
        if (process.env.NODE_ENV === 'development') {
          console.log(
            `[HTTP Request] ${config.method?.toUpperCase()} ${config.url}`,
            config.params || config.data || '',
          );
        }

        return config;
      },
      (error) => {
        console.error('[HTTP Request Error]', error);
        return Promise.reject(error);
      },
    );

    // 响应拦截
    this.instance.interceptors.response.use(
      async (res: AxiosResponse<ApiResponse>) => {
        const method = (res.config.method || 'get').toLowerCase();
        if (method !== 'get') {
          const key = this.genKey(res.config);
          this.requestQueue.delete(key);
          this.pendingControllers.delete(key);
        }

        if (process.env.NODE_ENV === 'development') {
          console.log(
            `[HTTP Response] ${res.config.method?.toUpperCase()} ${res.config.url}`,
            res.data,
          );
        }

        const { data } = res;
        // 这里按你的后台约定调整：10000 / 200 / 0 等
        if (data.code === 10000 || data.code === 200) {
          return res;
        }

        // 业务错误
        this.handleBizError(
          data,
          res.config as InternalAxiosRequestConfig & RequestConfig,
        );
        // 防止 unhandledrejection 事件被 Next.js dev overlay 捕获显示为红色堆栈。
        const bizRejection = Promise.reject(data);
        bizRejection.catch(() => {});
        return bizRejection;
      },
      async (error) => {
        if (error.config) {
          const method = (error.config.method || 'get').toLowerCase();
          if (method !== 'get') {
            const key = this.genKey(error.config);
            this.requestQueue.delete(key);
            this.pendingControllers.delete(key);
          }
        }

        // 处理 token 过期
        if (error.response?.status === 401 && !error.config._retry) {
          try {
            return await this.handleTokenRefresh(error);
          } catch (refreshError) {
            // 刷新失败，清除认证状态
            useAuthStore.getState().logout();
            // 如果是客户端环境，重定向到登录页（带语言前缀）
            if (typeof window !== 'undefined') {
              window.location.href = withLocale('/login');
            }
            return Promise.reject(refreshError);
          }
        }

        this.handleHttpError(error);
        // 防止 unhandledrejection 事件被 Next.js dev overlay 捕获显示为红色堆栈。
        const httpRejection = Promise.reject(error);
        httpRejection.catch(() => {});
        return httpRejection;
      },
    );
  }

  // ================= 工具函数 =================

  private genKey(config: AxiosRequestConfig) {
    const { method, url, params, data } = config;
    return `${method}-${url}-${JSON.stringify(params)}-${JSON.stringify(data)}`;
  }

  /**
   * 获取CSRF token
   * 从cookie中读取csrf_token（后端设置）或XSRF-TOKEN
   */
  private getCsrfToken(): string | null {
    if (typeof document === 'undefined') return null;

    // 优先读取后端设置的csrf_token（下划线）
    const csrfToken = this.getCookie('csrf_token');
    if (csrfToken) return csrfToken;

    // 尝试读取XSRF-TOKEN（常见于Spring Security）
    const xsrfToken = this.getCookie('XSRF-TOKEN');
    if (xsrfToken) return decodeURIComponent(xsrfToken);

    // 尝试读取csrfToken（驼峰式）
    const csrfTokenCamel = this.getCookie('csrfToken');
    if (csrfTokenCamel) return csrfTokenCamel;

    return null;
  }

  private getLanguage(): string {
    // ✅ 全局单点统一语言检测
    // 整个系统只有这一个语言检测数据源
    // 禁止在任何地方重复实现语言检测逻辑
    return detectLocale();
  }

  /**
   * 从cookie中获取指定名称的值
   */
  private getCookie(name: string): string | null {
    if (typeof document === 'undefined') return null;

    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) {
      const cookieValue = parts.pop()?.split(';').shift();
      return cookieValue || null;
    }
    return null;
  }

  /**
   * 规范化语言代码
   * 将各种语言变体映射到标准代码
   */
  private normalizeLanguageCode(code: string): string {
    const mappings: Record<string, string> = {
      'zh-CN': 'zh',
      'zh-Hans': 'zh',
      'zh-Hant': 'zh', // 繁体中文也映射到简体
      'en-US': 'en',
      'en-GB': 'en',
      'en-CA': 'en',
      'ja-JP': 'ja',
      'ko-KR': 'ko',
      'fr-FR': 'fr',
      'de-DE': 'de',
      'es-ES': 'es',
    };

    // 移除地区后缀，如 zh-CN -> zh
    const baseCode = code.split('-')[0].toLowerCase();
    return mappings[code] || baseCode;
  }

  // ================= 错误处理 =================

  private handleBizError(
    data: ApiResponse,
    config?: InternalAxiosRequestConfig & RequestConfig,
  ) {
    // showError: false → 静默请求，不弹 toast
    if (config?.showError === false) return;

    const fallbackMap: Record<number, string> = {
      400: 'Bad Request',
      403: 'Forbidden',
      404: 'Not Found',
      500: 'Internal Server Error',
    };

    const msg =
      data.message || fallbackMap[data.code] || `业务错误（${data.code}）`;

    console.error('[HTTP Biz Error]', msg);
  }

  private handleHttpError(error: any) {
    if (axios.isCancel(error) || error instanceof CanceledError) {
      console.log('[HTTP] request cancelled:', error.message);
      return;
    }

    // showError: false → 静默请求，不弹 toast
    const reqConfig = error.config as
      | (InternalAxiosRequestConfig & RequestConfig)
      | undefined;
    if (reqConfig?.showError === false) return;

    if (error.response) {
      const { status, data } = error.response;
      const msg = data?.message || `Server Error: ${error.message}`;
      console.error('[HTTP Error]', status, msg);
    } else if (error.request) {
      console.error(
        '[HTTP Error] No response from server, please check your network',
      );
    } else {
      console.error(
        '[HTTP Error]',
        error.message || 'Unexpected error occurred',
      );
    }
  }

  /**
   * 处理 token 刷新
   */
  private async handleTokenRefresh(error: any): Promise<any> {
    const originalRequest = error.config;
    originalRequest._retry = true;

    const { refreshToken } = useAuthStore.getState();
    if (!refreshToken) {
      throw new Error('No refresh token available');
    }

    try {
      // 调用刷新 token 接口
      const response = await this.instance.post('/v1/auth/refresh', {
        refreshToken,
      });

      const { data } = response.data;
      const { accessToken, refreshToken: newRefreshToken } = data;

      // 更新 store 中的 token
      useAuthStore.getState().setTokens({
        accessToken,
        refreshToken: newRefreshToken,
      });

      // 更新原始请求的 Authorization header
      originalRequest.headers.Authorization = `Bearer ${accessToken}`;

      // 重试原始请求
      return this.instance(originalRequest);
    } catch (refreshError) {
      console.error('[HTTP] Token refresh failed:', refreshError);
      throw refreshError;
    }
  }

  // ================= 重试逻辑 =================

  private async withRetry<T>(
    operation: () => Promise<T>,
    retryConfig = this.retryConfig,
  ): Promise<T> {
    let lastError: any;

    for (let attempt = 0; attempt <= retryConfig.maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;

        // 检查是否应该重试
        if (
          attempt === retryConfig.maxRetries ||
          !retryConfig.retryCondition(error)
        ) {
          throw error;
        }

        // 等待重试延迟
        const delay = retryConfig.retryDelay(attempt);
        await new Promise((resolve) => setTimeout(resolve, delay));

        console.log(
          `[HTTP] Retrying request (attempt ${attempt + 1}/${retryConfig.maxRetries})`,
        );
      }
    }

    throw lastError;
  }

  // ================= 对外 HTTP 方法 =================

  public async get<T = any>(
    url: string,
    params?: any,
    config?: AxiosRequestConfig & RequestConfig,
  ): Promise<T> {
    const mergedConfig = {
      params,
      ...config,
    };
    const key = this.genKey({
      method: 'get',
      url,
      params: mergedConfig.params,
      data: mergedConfig.data,
    });

    const existing = this.inflightGetRequests.get(key);
    if (existing) {
      return existing as Promise<T>;
    }

    const requestPromise = (async () => {
      return this.withRetry(() =>
        this.instance
          .get<ApiResponse<T>>(url, mergedConfig)
          .then((res) => res.data.data),
      ).finally(() => {
        this.inflightGetRequests.delete(key);
      });
    })();

    // 防止 unhandledrejection 事件被 Next.js dev overlay 捕获显示为红色堆栈。
    requestPromise.catch(() => {});

    this.inflightGetRequests.set(key, requestPromise);
    return requestPromise;
  }

  public async post<T = any>(
    url: string,
    data?: any,
    config?: AxiosRequestConfig & RequestConfig,
  ): Promise<T> {
    const res = await this.withRetry(() =>
      this.instance.post<ApiResponse<T>>(url, data, config),
    );
    return res.data.data;
  }

  public async put<T = any>(
    url: string,
    data?: any,
    config?: AxiosRequestConfig & RequestConfig,
  ): Promise<T> {
    const res = await this.withRetry(() =>
      this.instance.put<ApiResponse<T>>(url, data, config),
    );
    return res.data.data;
  }

  public async patch<T = any>(
    url: string,
    data?: any,
    config?: AxiosRequestConfig & RequestConfig,
  ): Promise<T> {
    const res = await this.withRetry(() =>
      this.instance.patch<ApiResponse<T>>(url, data, config),
    );
    return res.data.data;
  }

  public async delete<T = any>(
    url: string,
    config?: AxiosRequestConfig & RequestConfig,
  ): Promise<T> {
    const res = await this.withRetry(() =>
      this.instance.delete<ApiResponse<T>>(url, config),
    );
    return res.data.data;
  }

  public async upload<T = any>(
    url: string,
    file: File | FormData,
    onProgress?: (percent: number) => void,
    config?: RequestConfig,
  ): Promise<T> {
    const formData = file instanceof FormData ? file : new FormData();
    if (file instanceof File) formData.append('file', file);

    const res = await this.instance.post<ApiResponse<T>>(url, formData, {
      ...config,
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress: (e_1) => {
        if (onProgress && e_1.total) {
          const percent_1 = Math.round((e_1.loaded * 100) / e_1.total);
          onProgress(percent_1);
        }
      },
    });
    return res.data.data;
  }

  public async download(
    url: string,
    filename = 'download',
    config?: RequestConfig,
  ): Promise<void> {
    const res = await this.instance.get(url, {
      responseType: 'blob',
      ...config,
    });
    const blob = new Blob([res.data]);
    const link = document.createElement('a');
    link.href = window.URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    window.URL.revokeObjectURL(link.href);
  }
}

export const http = new HttpClient();
export default http;
