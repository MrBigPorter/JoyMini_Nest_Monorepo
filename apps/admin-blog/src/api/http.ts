import axios, {
  AxiosInstance,
  AxiosRequestConfig,
  AxiosResponse,
  CanceledError,
  InternalAxiosRequestConfig,
} from 'axios';
import type { ApiResponse, RequestConfig, RequestTraceConfig } from './types';
import { useToastStore } from '@/store/useToastStore';

/* eslint-disable @typescript-eslint/no-explicit-any */
class HttpClient {
  private readonly instance: AxiosInstance;
  private requestQueue = new Set<string>();
  private pendingControllers = new Map<string, AbortController>();
  private inflightGetRequests = new Map<string, Promise<unknown>>();
  /** 防止多个并发 401 重复触发 toast + redirect */
  private _unauthorizedHandling = false;
  /** 单飞 refresh：并发 401 时只刷新一次 */
  private refreshPromise: Promise<string | null> | null = null;

  // 重试配置
  private readonly retryConfig = {
    maxRetries: process.env.NODE_ENV === 'test' ? 0 : 3,
    retryDelay: (attemptIndex: number) =>
      process.env.NODE_ENV === 'test'
        ? 0
        : Math.min(1000 * 2 ** attemptIndex, 30000),
    retryCondition: (error: any) => {
      if (process.env.NODE_ENV === 'test') return false;
      // 网络错误或 5xx 服务器错误时重试；4xx 业务错误（含 403）不重试
      return (
        !error.response ||
        (error.response.status >= 500 && error.response.status < 600)
      );
    },
  };

  constructor() {
    const baseURL =
      typeof window === 'undefined'
        ? process.env.INTERNAL_API_URL ||
          process.env.API_BASE_URL ||
          'http://localhost:3000/api'
        : process.env.NEXT_PUBLIC_API_BASE_URL || '/api';

    this.instance = axios.create({
      baseURL,
      timeout: typeof window === 'undefined' ? 5_000 : 30_000,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    this.setupInterceptors();
    this.suppressHandledRejections();
  }

  /**
   * 全局屏蔽已被 toast 处理过的 HTTP 错误（如 403）触发 Next.js 错误遮罩。
   * - 已在 handleHttpError / handleBizError 中弹出 toast 通知用户。
   * - 阻止 unhandledrejection 事件上报，避免出现红色代码错误弹窗。
   * - 收到真正未处理的其他错误仍会正常上报。
   */
  private suppressHandledRejections() {
    if (typeof window === 'undefined') return;

    window.addEventListener('unhandledrejection', (event) => {
      const err = event.reason;

      // AxiosError：已在拦截器中弹 toast 的 HTTP 状态码
      const handledStatuses = new Set([400, 403, 404, 422, 429]);
      if (err?.isAxiosError && handledStatuses.has(err?.response?.status)) {
        event.preventDefault();
        return;
      }

      // 业务错误（ApiResponse 格式，code 非 200/10000 且非 401）
      if (
        typeof err?.code === 'number' &&
        err.code !== 200 &&
        err.code !== 10000 &&
        err.code !== 401 &&
        err.code !== 40100
      ) {
        event.preventDefault();
      }
    });
  }

  private setupInterceptors() {
    // 请求拦截
    this.instance.interceptors.request.use(
      (config: InternalAxiosRequestConfig) => {
        const skipRefresh = config.headers['x-skip-auth-refresh'];
        const method = (config.method || 'get').toLowerCase();

        // 1. token
        const token = this.getToken();
        if (token && !skipRefresh) {
          config.headers.Authorization = `Bearer ${token}`;
        }

        // 2. 语言
        const lang = this.getLanguage();
        if (lang) {
          config.headers['Accept-Language'] = lang;
        }

        // 3. 去重请求 key
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

        // 4. dev 日志
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
        if (data.code === 10000 || data.code === 200) {
          return res;
        }

        // 业务错误
        if (data.code === 401 || data.code === 40100) {
          const retryConfig = res.config as InternalAxiosRequestConfig & {
            _retry?: boolean;
          };
          if (retryConfig._retry) {
            await this.handleUnauthorized();
            return Promise.reject(data);
          }
          return this.handle401AndRetry(retryConfig);
        }

        this.handleBizError(
          data,
          res.config as InternalAxiosRequestConfig & RequestConfig,
        );
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

          const config = error.config as InternalAxiosRequestConfig & {
            _retry?: boolean;
          };
          if (
            error.response?.status === 401 &&
            !config._retry &&
            !config.headers['x-skip-auth-refresh']
          ) {
            return this.handle401AndRetry(config);
          }
        }
        this.handleHttpError(error);
        const httpRejection = Promise.reject(error);
        httpRejection.catch(() => {});
        return httpRejection;
      },
    );
  }

  private genKey(config: AxiosRequestConfig) {
    const { method, url, params, data } = config;
    return `${method}-${url}-${JSON.stringify(params)}-${JSON.stringify(data)}`;
  }

  private getToken(): string | null {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem('auth_token');
  }

  private getRefreshToken(): string | null {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem('refresh_token');
  }

  private setAuthTokens(accessToken: string, refreshToken?: string) {
    if (typeof window === 'undefined') return;
    localStorage.setItem('auth_token', accessToken);
    if (refreshToken) {
      localStorage.setItem('refresh_token', refreshToken);
    }
  }

  private getLanguage(): string {
    if (typeof window === 'undefined') return 'en';
    return localStorage.getItem('lang') || 'en';
  }

  private handleBizError(
    data: ApiResponse,
    config?: InternalAxiosRequestConfig & RequestConfig,
  ) {
    if (data.code === 401 || data.code === 40100) {
      void this.handleUnauthorized();
      return;
    }

    if (config?.showError === false) return;

    const fallbackMap: Record<number, string> = {
      400: 'Bad Request',
      403: 'Forbidden',
      404: 'Not Found',
      500: 'Internal Server Error',
    };

    const msg =
      data.message || fallbackMap[data.code] || `业务错误（${data.code}）`;

    this.toastError(msg);
  }

  private handleHttpError(error: any) {
    if (axios.isCancel(error) || error instanceof CanceledError) {
      console.log('[HTTP] request cancelled:', error.message);
      return;
    }

    const reqConfig = error.config as
      | (InternalAxiosRequestConfig & RequestConfig)
      | undefined;
    if (reqConfig?.showError === false) return;

    if (error.response) {
      const { status, data } = error.response;

      if (status === 401) {
        if (!error.config?.headers?.['x-skip-auth-refresh']) {
          void this.handleUnauthorized();
        } else {
          void this.handleUnauthorized();
        }
        return;
      }

      // 403 权限错误：VIEWER 写操作预期会被拒绝，静默处理，不弹 toast 不打印
      // （在 withRetry 中弹 toast 并返回空值，不抛错）
      if (status === 403) return;

      const msg = data?.message || `Server Error: ${error.message}`;
      this.toastError(msg);
    } else if (error.request) {
      this.toastError('No response from server, please check your network');
    } else {
      this.toastError(error.message || 'Unexpected error occurred');
    }

    console.error('[HTTP Error]', error);
  }

  private async handleUnauthorized() {
    if (this._unauthorizedHandling) return;
    this._unauthorizedHandling = true;

    localStorage.removeItem('auth_token');
    localStorage.removeItem('refresh_token');

    if (window.location.pathname !== '/login') {
      this.toastError('Unauthorized, please log in again');
      await this.instance
        .post(
          '/v1/auth/admin/clear-cookie',
          {},
          { headers: { 'x-skip-auth-refresh': '1' } },
        )
        .catch(() => {});
      window.location.href = '/login';
    }

    queueMicrotask(() => {
      this._unauthorizedHandling = false;
    });
  }

  private async handle401AndRetry(
    config: InternalAxiosRequestConfig & { _retry?: boolean },
  ) {
    const accessToken = await this.refreshAccessToken();
    if (!accessToken) {
      if (!this._unauthorizedHandling) {
        await this.handleUnauthorized();
      }
      return Promise.reject(new Error('Unauthorized'));
    }

    config._retry = true;
    config.headers.Authorization = `Bearer ${accessToken}`;
    return this.instance.request(config);
  }

  private async refreshAccessToken(): Promise<string | null> {
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    const refreshToken = this.getRefreshToken();
    if (!refreshToken) {
      return null;
    }

    this.refreshPromise = (async () => {
      try {
        const refreshRes = await this.instance.post<
          ApiResponse<{
            tokens: { accessToken: string; refreshToken: string };
          }>
        >(
          '/v1/auth/admin/refresh',
          { refreshToken },
          {
            headers: {
              'x-skip-auth-refresh': '1',
            },
          },
        );

        const newAccessToken = refreshRes.data.data.tokens.accessToken;
        const newRefreshToken = refreshRes.data.data.tokens.refreshToken;
        this.setAuthTokens(newAccessToken, newRefreshToken);

        await this.instance
          .post(
            '/v1/auth/admin/set-cookie',
            { token: newAccessToken },
            { headers: { 'x-skip-auth-refresh': '1' } },
          )
          .catch((e) => {
            console.warn('[HTTP] set-cookie after refresh failed', e);
          });

        return newAccessToken;
      } catch {
        return null;
      } finally {
        this.refreshPromise = null;
      }
    })();

    return this.refreshPromise;
  }

  private toastError(message: string) {
    const { addToast } = useToastStore.getState();
    addToast('error', message);
  }

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

        // 403 权限错误：VIEWER 写操作预期会被拒绝，弹 toast 提示并返回空，不抛错
        if ((error as any)?.response?.status === 403) {
          const data = (error as any)?.response?.data;
          const msg = data?.message || 'Forbidden';
          this.toastError(msg);
          return undefined as unknown as T;
        }

        if (
          attempt === retryConfig.maxRetries ||
          !retryConfig.retryCondition(error)
        ) {
          throw error;
        }

        const delay = retryConfig.retryDelay(attempt);
        await new Promise((resolve) => setTimeout(resolve, delay));

        console.log(
          `[HTTP] Retrying request (attempt ${attempt + 1}/${retryConfig.maxRetries})`,
        );
      }
    }

    throw lastError;
  }

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

    const requestPromise = this.withRetry(() =>
      this.instance
        .get<ApiResponse<T>>(url, mergedConfig)
        .then((res) => res.data.data),
    ).finally(() => {
      this.inflightGetRequests.delete(key);
    });

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
    if (!res) return undefined as unknown as T;
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
    if (!res) return undefined as unknown as T;
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
    if (!res) return undefined as unknown as T;
    return res.data.data;
  }

  public async delete<T = any>(
    url: string,
    config?: AxiosRequestConfig & RequestConfig,
  ): Promise<T> {
    const res = await this.withRetry(() =>
      this.instance.delete<ApiResponse<T>>(url, config),
    );
    if (!res) return undefined as unknown as T;
    return res.data.data;
  }

  public async upload<T = any>(
    url: string,
    file: File | FormData,
    onProgress?: (percent: number) => void,
    config?: RequestConfig & { extraFields?: Record<string, string> },
  ): Promise<T> {
    const formData = file instanceof FormData ? file : new FormData();
    if (file instanceof File) formData.append('file', file);

    if (config?.extraFields) {
      for (const [key, value] of Object.entries(config.extraFields)) {
        if (value) formData.append(key, value);
      }
    }

    const res = await this.instance.post<ApiResponse<T>>(url, formData, {
      ...config,
      timeout: 600_000, // 10 minutes for large file uploads
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress: (e) => {
        if (onProgress && e.total) {
          const percent = Math.round((e.loaded * 100) / e.total);
          onProgress(percent);
        }
      },
    });
    return res.data.data;
  }

  /**
   * Direct browser-to-R2 upload via presigned URL.
   *
   * Flow:
   * 1. Requests a presigned PUT URL from the backend
   * 2. PUTs the file directly to R2 (bypasses NestJS — no Multer memory bottleneck)
   * 3. Confirms the upload so the backend triggers media processing (BullMQ)
   *
   * Returns the final CDN URL of the uploaded file.
   */
  public async uploadDirect<T = { url: string; key: string }>(
    presignedUrlEndpoint: string,
    confirmEndpoint: string,
    file: File,
    onProgress?: (percent: number) => void,
    extraFields?: Record<string, string>,
  ): Promise<T> {
    // Step 1: Request presigned URL
    const presignedRes = await this.instance.post<
      ApiResponse<{ url: string; key: string; cdnUrl: string | null }>
    >(presignedUrlEndpoint, { fileName: file.name, fileType: file.type });
    const { url: uploadUrl, key, cdnUrl } = presignedRes.data.data;

    // Step 2: PUT file directly to R2 using XMLHttpRequest
    // Native XHR avoids axios interceptors that add non-signed headers (Authorization, Accept-Language)
    // which would cause 400 Bad Request from R2 (signature mismatch)
    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', uploadUrl);
      xhr.setRequestHeader('Content-Type', file.type);

      xhr.upload.onprogress = (e) => {
        if (onProgress && e.lengthComputable) {
          const percent = Math.round((e.loaded * 100) / e.total);
          onProgress(percent);
        }
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve();
        } else {
          reject(new Error(`Upload failed with status ${xhr.status}`));
        }
      };

      xhr.onerror = () => reject(new Error('Upload failed: network error'));
      xhr.send(file);
    });

    // Step 3: Confirm upload (enqueue media processing)
    const confirmPayload: Record<string, unknown> = {
      key,
      originalName: file.name,
      mimeType: file.type,
      ...(extraFields ?? {}),
    };

    // Avoid sending empty strings as fields (keeps DTO optional semantics)
    for (const [k, v] of Object.entries(confirmPayload)) {
      if (v === '') delete confirmPayload[k];
    }

    const confirmRes = await this.instance.post<
      ApiResponse<{ url: string; key: string }>
    >(confirmEndpoint, confirmPayload);

    return confirmRes.data.data as T;
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
