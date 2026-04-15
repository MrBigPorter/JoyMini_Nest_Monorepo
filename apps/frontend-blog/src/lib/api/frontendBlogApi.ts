import http from './http';
import type { PaginatedResponse } from './types';
import type { Comment } from '@/lib/types/blog';
import type {
  FrontendArticle,
  FrontendCategory,
  FrontendTag,
  FrontendCategoryWithArticles,
  FrontendTagWithArticles,
  FrontendBlogStats,
  FrontendArchiveItem,
  FrontendPaginatedResponse,
} from '@/lib/types/frontend-blog';

/**
 * 前端博客专用 API 接口
 * 对应后端 /v1/frontend/blog/* 端点
 * 特点：数据格式简化，多语言处理优化，只返回前端必需字段
 */
export const frontendBlogApi = {
  // ================= 文章接口 =================

  /**
   * 获取文章列表（简化版）
   */
  getArticles: (params?: {
    page?: number;
    pageSize?: number;
    categoryId?: string;
    tagId?: string;
  }) =>
    http.get<FrontendPaginatedResponse<FrontendArticle>>(
      '/v1/frontend/blog/articles',
      params,
    ),

  /**
   * 根据 Slug 获取文章详情（简化版）
   */
  getArticleBySlug: (slug: string) =>
    http.get<FrontendArticle>(`/v1/frontend/blog/articles/${slug}`),

  /**
   * 获取热门文章（简化版）
   */
  getPopularArticles: (limit = 10) =>
    http.get<FrontendArticle[]>('/v1/frontend/blog/articles/popular', {
      limit,
    }),

  /**
   * 获取相关文章（简化版）
   */
  getRelatedArticles: (articleId: string, limit = 5) =>
    http.get<FrontendArticle[]>(
      `/v1/frontend/blog/articles/${articleId}/related`,
      {
        limit,
      },
    ),

  // ================= 分类接口 =================

  /**
   * 获取所有分类（简化版）
   */
  getCategories: () =>
    http.get<FrontendCategory[]>('/v1/frontend/blog/categories'),

  /**
   * 获取分类详情（简化版）
   */
  getCategoryBySlug: (
    slug: string,
    params?: {
      page?: number;
      pageSize?: number;
    },
  ) =>
    http.get<FrontendCategoryWithArticles>(
      `/v1/frontend/blog/categories/${slug}`,
      params,
    ),

  // ================= 标签接口 =================

  /**
   * 获取所有标签（简化版）
   */
  getTags: () => http.get<FrontendTag[]>('/v1/frontend/blog/tags'),

  /**
   * 获取标签详情（简化版）
   */
  getTagBySlug: (
    slug: string,
    params?: {
      page?: number;
      pageSize?: number;
    },
  ) =>
    http.get<FrontendTagWithArticles>(`/v1/frontend/blog/tags/${slug}`, params),

  // ================= 搜索接口 =================

  /**
   * 搜索文章（简化版）
   */
  searchArticles: (
    query: string,
    params?: {
      page?: number;
      pageSize?: number;
    },
  ) =>
    http.get<FrontendPaginatedResponse<FrontendArticle>>(
      '/v1/frontend/blog/search',
      {
        q: query,
        ...params,
      },
    ),

  // ================= 统计接口 =================

  /**
   * 获取博客统计（简化版）
   */
  getBlogStats: () => http.get<FrontendBlogStats>('/v1/frontend/blog/stats'),

  /**
   * 获取文章归档（简化版）
   */
  getArticleArchive: () =>
    http.get<FrontendArchiveItem[]>('/v1/frontend/blog/archive'),

  /**
   * 获取热门标签（简化版）
   */
  getPopularTags: (limit = 20) =>
    http.get<FrontendTag[]>('/v1/frontend/blog/tags/popular', { limit }),

  // ================= 评论接口 =================
  // 注意：评论接口暂时使用原有接口，因为评论逻辑相对简单
  // 如果需要简化，可以在后续版本中迁移

  /**
   * 获取文章评论列表
   */
  getComments: (
    articleId: string,
    params?: {
      page?: number;
      pageSize?: number;
    },
  ) =>
    http.get<PaginatedResponse<Comment>>(
      `/v1/public/blog/articles/${articleId}/comments`,
      params,
    ),

  /**
   * 提交评论
   */

  postComment: (
    articleId: string,
    data: {
      author: string;
      email?: string;
      content: string;
      parentId?: string;
    },
  ) =>
    http.post<Comment>(`/v1/public/blog/articles/${articleId}/comments`, data),
};

export default frontendBlogApi;
