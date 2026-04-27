/**
 * Server Component 专用 fetch 工具
 * - 使用原生 fetch（Cloudflare Workers 兼容）
 * - 不依赖 axios / localStorage / document
 * - 自动从 NEXT_PUBLIC_API_BASE_URL 读取 API 地址
 */
import 'server-only';

export type ServerFetchParams = Record<
  string,
  string | number | boolean | undefined | null
>;

/**
 * GET 请求（Server Component 专用）
 * @example
 *   const articles = await serverGet<PaginatedResponse<Article>>('/v1/frontend/blog/articles', { lang: 'en', page: 1 });
 */
export async function serverGet<T>(
  path: string,
  params?: ServerFetchParams,
): Promise<T> {
  const base =
    process.env.INTERNAL_API_URL ||
    process.env.NEXT_PUBLIC_API_BASE_URL ||
    'http://localhost:3000/api';
  const url = new URL(`${base}${path}`);

  if (params) {
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    });
  }

  try {
    const res = await fetch(url.toString(), {
      headers: {
        'Content-Type': 'application/json',
      },
      next: { revalidate: 60 },
    } as RequestInit & { next?: { revalidate?: number } });

    if (!res.ok) {
      const errorText = await res.text().catch(() => '');
      throw new Error(
        `[serverFetch] ${path} → HTTP ${res.status}${errorText ? `: ${errorText.substring(0, 200)}` : ''}`,
      );
    }

    const json = await res.json();

    if (json.code !== 10000 && json.code !== 200) {
      throw new Error(
        `[serverFetch] ${path} → ${json.message ?? 'API error'} (code: ${json.code})`,
      );
    }

    return json.data as T;
  } catch (error) {
    if (error instanceof Error) {
      console.error(`[serverFetch] error for ${path}:`, error.message);
    } else {
      console.error(`[serverFetch] unknown error for ${path}:`, error);
    }
    throw error;
  }
}
