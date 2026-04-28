/**
 * HTTP 请求相关类型定义
 */

export interface ApiResponse<T = unknown> {
  code: number;
  message: string;
  data: T;
  timestamp?: number;
}

export interface ApiError {
  code: number;
  message: string;
  details?: unknown;
}

export type TraceAttributeValue = string | number | boolean | null | undefined;

export interface RequestTraceConfig {
  /** false = disable tracing for this request */
  enabled?: boolean;
  /** Optional custom span name */
  name?: string;
  /** Optional extra attributes merged with default http.method/http.route */
  attributes?: Record<string, TraceAttributeValue>;
}

export interface PaginationParams {
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface PaginatedResponse<T> {
  list: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface RequestConfig {
  showLoading?: boolean;
  showError?: boolean;
  customErrorHandler?: (error: ApiError) => void;
  trace?: boolean | RequestTraceConfig;
}
