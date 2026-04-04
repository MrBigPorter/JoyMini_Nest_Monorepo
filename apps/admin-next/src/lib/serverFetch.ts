/**
 * Server Component 专用 fetch 工具
 * - 使用 Node.js 原生 fetch（不依赖 axios / localStorage）
 * - 自动从 HTTP-only Cookie 读取 auth_token
 * - INTERNAL_API_URL 优先（Docker 内网，跳过公网往返）
 *   回退到 NEXT_PUBLIC_API_BASE_URL（本地开发 / 非 Docker）
 */
import 'server-only';

import { cookies } from 'next/headers';
import type { ApiResponse } from '@/api/types';
import {
  SENTRY_SPAN_ATTR_KEY,
  SENTRY_SPAN_NAME,
  SENTRY_SPAN_OP,
} from '@/lib/sentry-span-constants';
import { withAppSpan } from '@/lib/sentry-span';

function getBase(): string {
  return (
    process.env.INTERNAL_API_URL ||
    process.env.NEXT_PUBLIC_API_BASE_URL ||
    'http://localhost:3000'
  );
}

async function buildHeaders(): Promise<Record<string, string>> {
  const cookieStore = await cookies();
  const token = cookieStore.get('auth_token')?.value;
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export type ServerFetchParams = Record<
  string,
  string | number | boolean | undefined | null
>;

export interface ServerFetchOptions {
  /** Next.js 增量静态再生（ISR）秒数，false = no-store */
  revalidate?: number | false;
  /** Next.js Data Cache 标签，用于 revalidateTag 精准失效 */
  tags?: string[];
}

/**
 * GET 请求（Server Component 专用）
 * @example
 *   const stats = await serverGet<FinanceStatistics>('/v1/admin/finance/statistics');
 */
export async function serverGet<T>(
  path: string,
  params?: ServerFetchParams,
  options?: ServerFetchOptions,
): Promise<T> {
  const revalidate =
    options?.revalidate === false ? 0 : (options?.revalidate ?? 30);
  const tags = options?.tags;

  return withAppSpan(
    {
      name: SENTRY_SPAN_NAME.SERVER_FETCH_REQUEST,
      op: SENTRY_SPAN_OP.HTTP_CLIENT,
      attributes: {
        [SENTRY_SPAN_ATTR_KEY.HTTP_METHOD]: 'GET',
        [SENTRY_SPAN_ATTR_KEY.HTTP_ROUTE]: path,
        [SENTRY_SPAN_ATTR_KEY.FETCH_REVALIDATE]: revalidate,
      },
    },
    async () => {
      const base = getBase();
      const url = new URL(`${base}${path}`);

      if (params) {
        Object.entries(params).forEach(([k, v]) => {
          if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
        });
      }

      try {
        const res = await fetch(url.toString(), {
          headers: await buildHeaders(),
          next: { revalidate, ...(tags ? { tags } : {}) },
        } as RequestInit & { next?: { revalidate?: number; tags?: string[] } });

        if (!res.ok) {
          const errorText = await res.text().catch(() => '');
          throw new Error(
            `[serverFetch] ${path} → HTTP ${res.status}${errorText ? `: ${errorText.substring(0, 200)}` : ''}`,
          );
        }

        const json: ApiResponse<T> = await res.json();

        if (json.code !== 10000 && json.code !== 200) {
          throw new Error(
            `[serverFetch] ${path} → ${json.message ?? 'API error'} (code: ${json.code})`,
          );
        }

        return json.data;
      } catch (error) {
        if (error instanceof Error) {
          // 401 未授权 / 403 无权限 → 返回 null，让页面降级渲染，不崩溃
          if (
            error.message.includes('HTTP 401') ||
            error.message.includes('HTTP 403')
          ) {
            console.warn(
              `serverFetch: ${error.message.includes('HTTP 401') ? '401 Unauthorized' : '403 Forbidden'} for ${path}, returning null`,
            );
            return null as T;
          }
          console.error(`serverFetch error for ${path}:`, error.message);
        } else {
          console.error(`serverFetch unknown error for ${path}:`, error);
        }
        throw error;
      }
    },
  );
}
