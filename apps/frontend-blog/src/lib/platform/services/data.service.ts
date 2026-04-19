import { detectPlatform } from '../detectors/runtime.detector';
import { frontendBlogApi } from '@/lib/api/frontendBlogApi';

import type {
  FrontendArticle,
  FrontendCategory,
  FrontendPaginatedResponse,
} from '@/lib/types/frontend-blog';

export interface PlatformArticlesParams {
  locale: string;
  page: number;
  pageSize: number;
  categoryId?: string;
  tagId?: string;
  search?: string;
}

export interface PlatformArticlesResponse {
  items: FrontendArticle[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/**
 * 平台感知数据服务
 * 根据运行环境选择最佳数据获取策略：
 * - Web/SSR: 直接API调用 + ISR缓存
 * - App: SQLite缓存优先 + 后台更新
 * - H5: 内存缓存 + 网络请求
 */
/**
 * 平台感知分类数据获取
 */
export async function getPlatformCategories(
  locale: string,
): Promise<FrontendCategory[]> {
  const platform = detectPlatform();

  try {
    switch (platform) {
      case 'server':
      case 'web':
      case 'h5':
        // All browser environments use direct API call
        // React Query handles client side caching
        return await frontendBlogApi.getCategories(locale);
      case 'capacitor':
        // App environment: SQLite cache will be implemented here
        return await frontendBlogApi.getCategories(locale);

      default:
        return await frontendBlogApi.getCategories(locale);
    }
  } catch (error) {
    console.error(`Platform categories service error (${platform}):`, error);
    throw error;
  }
}

/**
 * Platform aware article detail data fetching
 */
export async function getPlatformArticle(
  slug: string,
  locale: string,
): Promise<FrontendArticle> {
  const platform = detectPlatform();

  try {
    switch (platform) {
      case 'server':
      case 'web':
      case 'h5':
        // All browser environments use direct API call
        return await frontendBlogApi.getArticleBySlug(slug, locale);

      case 'capacitor':
        // App environment: SQLite cache will be implemented here
        return await frontendBlogApi.getArticleBySlug(slug, locale);

      default:
        return await frontendBlogApi.getArticleBySlug(slug, locale);
    }
  } catch (error) {
    console.error(`Platform article service error (${platform}):`, error);
    throw error;
  }
}

/**
 * Platform aware comments data fetching
 */
export async function getPlatformComments(
  articleId: string,
  params: { page: number; pageSize: number },
): Promise<any> {
  const platform = detectPlatform();

  try {
    switch (platform) {
      case 'server':
      case 'web':
      case 'h5':
        // All browser environments use direct API call
        return await frontendBlogApi.getComments(articleId, params);

      case 'capacitor':
        // App environment: SQLite cache will be implemented here
        return await frontendBlogApi.getComments(articleId, params);

      default:
        return await frontendBlogApi.getComments(articleId, params);
    }
  } catch (error) {
    console.error(`Platform comments service error (${platform}):`, error);
    throw error;
  }
}

/**
 * Platform aware bookmarks data fetching
 */
export async function getPlatformBookmarks(
  accessToken: string | undefined,
  params: { page: number; pageSize: number },
): Promise<any> {
  const platform = detectPlatform();

  try {
    switch (platform) {
      case 'server':
      case 'web':
      case 'h5':
        if (!accessToken) {
          return {
            items: [],
            total: 0,
            page: 1,
            pageSize: params.pageSize,
            totalPages: 0,
          };
        }
        // All browser environments use direct API call
        return await frontendBlogApi.getBookmarks(params);

      case 'capacitor':
        // App environment: SQLite cache will be implemented here
        return await frontendBlogApi.getBookmarks(params);

      default:
        return await frontendBlogApi.getBookmarks(params);
    }
  } catch (error) {
    console.error(`Platform bookmarks service error (${platform}):`, error);
    throw error;
  }
}

/**
 * Platform aware tags data fetching
 */
export async function getPlatformTags(locale: string): Promise<any[]> {
  const platform = detectPlatform();

  try {
    switch (platform) {
      case 'server':
      case 'web':
      case 'h5':
        // All browser environments use direct API call
        return await frontendBlogApi.getTags();

      case 'capacitor':
        // App environment: SQLite cache will be implemented here
        return await frontendBlogApi.getTags();

      default:
        return await frontendBlogApi.getTags();
    }
  } catch (error) {
    console.error(`Platform tags service error (${platform}):`, error);
    throw error;
  }
}

export async function getPlatformArticles(
  params: PlatformArticlesParams,
): Promise<PlatformArticlesResponse> {
  const platform = detectPlatform();

  try {
    switch (platform) {
      case 'server':
      case 'web':
      case 'h5':
        // Web/SSR环境：直接API调用，利用ISR缓存
        return await getWebArticles(params);
      case 'capacitor':
        // App环境：SQLite缓存优先
        return await getAppArticles(params);

      default:
        // 默认使用Web策略
        return await getWebArticles(params);
    }
  } catch (error) {
    console.error(`Platform data service error (${platform}):`, error);

    // 降级策略：尝试使用Web策略
    try {
      return await getWebArticles(params);
    } catch (fallbackError) {
      console.error('Fallback strategy also failed:', fallbackError);
      throw new Error(
        `Failed to fetch articles: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }
}

/**
 * Web/SSR环境数据获取
 * 直接API调用，利用Next.js ISR缓存
 */
async function getWebArticles(
  params: PlatformArticlesParams,
): Promise<PlatformArticlesResponse> {
  const response = await frontendBlogApi.getArticles({
    page: params.page,
    pageSize: params.pageSize,
    categoryId: params.categoryId,
    tagId: params.tagId,
    lang: params.locale,
  });

  return {
    items: response.items || [],
    total: response.total || 0,
    page: params.page,
    pageSize: params.pageSize,
    totalPages: Math.ceil((response.total || 0) / params.pageSize),
  };
}

/**
 * H5环境数据获取
 * 内存缓存优先，网络请求降级
 */
async function getH5Articles(
  params: PlatformArticlesParams,
): Promise<PlatformArticlesResponse> {
  // 检查内存缓存
  const cacheKey = `h5_articles_${params.locale}_${params.page}_${params.pageSize}`;
  const cached = getH5Cache(cacheKey);

  if (cached) {
    // 返回缓存数据，后台静默更新
    setTimeout(() => {
      updateH5Cache(cacheKey, params).catch(console.error);
    }, 0);

    return cached;
  }

  // 无缓存，直接API调用
  return await getWebArticles(params);
}

/**
 * App环境数据获取
 * SQLite缓存优先，后台静默更新
 */
async function getAppArticles(
  params: PlatformArticlesParams,
): Promise<PlatformArticlesResponse> {
  try {
    // 尝试从SQLite获取缓存数据
    const cached = await getSQLiteCache(params);

    if (cached) {
      // 返回缓存数据，后台静默更新
      setTimeout(() => {
        updateSQLiteCache(params).catch(console.error);
      }, 0);

      return cached;
    }

    // 无缓存，直接API调用
    return await getWebArticles(params);
  } catch (sqliteError) {
    console.error('SQLite cache error, falling back to web:', sqliteError);
    // SQLite失败，降级到Web策略
    return await getWebArticles(params);
  }
}

// H5内存缓存实现
const h5Cache = new Map<
  string,
  { data: PlatformArticlesResponse; timestamp: number }
>();
const H5_CACHE_TTL = 5 * 60 * 1000; // 5分钟

function getH5Cache(key: string): PlatformArticlesResponse | null {
  const cached = h5Cache.get(key);
  if (!cached) return null;

  // 检查缓存是否过期
  if (Date.now() - cached.timestamp > H5_CACHE_TTL) {
    h5Cache.delete(key);
    return null;
  }

  return cached.data;
}

async function updateH5Cache(
  key: string,
  params: PlatformArticlesParams,
): Promise<void> {
  try {
    const data = await getWebArticles(params);
    h5Cache.set(key, {
      data,
      timestamp: Date.now(),
    });
  } catch (error) {
    console.error('Failed to update H5 cache:', error);
  }
}

// SQLite缓存实现（App环境）
async function getSQLiteCache(
  params: PlatformArticlesParams,
): Promise<PlatformArticlesResponse | null> {
  // 这里需要集成SQLite实现
  // 暂时返回null，后续实现
  return null;
}

async function updateSQLiteCache(
  params: PlatformArticlesParams,
): Promise<void> {
  // 这里需要集成SQLite实现
  // 暂时空实现，后续实现
}

/**
 * 平台感知的错误处理
 */
export function handlePlatformError(error: unknown, platform: string): string {
  const errorMessage = error instanceof Error ? error.message : 'Unknown error';

  switch (platform) {
    case 'capacitor':
      return `App端数据获取失败: ${errorMessage}`;
    case 'h5':
      return `H5端数据获取失败: ${errorMessage}`;
    case 'server':
    case 'web':
    default:
      return `数据获取失败: ${errorMessage}`;
  }
}
