/**
 * 文章数据缓存函数
 *
 * 使用 React.cache() 确保同一个 SSR 请求中，
 * generateMetadata() 和 ArticlePage() 共享同一个 API 调用结果，
 * 避免重复请求后端 API。
 */
import { cache } from 'react';
import { serverGet } from '@/lib/serverFetch';
import type { FrontendArticle } from '@/lib/types/frontend-blog';

export const getCachedArticle = cache(
  async (slug: string, locale: string): Promise<FrontendArticle | null> => {
    try {
      return await serverGet<FrontendArticle>(
        `/v1/frontend/blog/articles/${slug}`,
        { lang: locale },
      );
    } catch (error) {
      console.error('[getCachedArticle] Failed to fetch article:', error);
      return null;
    }
  },
);
