import http from './http';
import type { PaginatedResponse } from './types';
import type { Article, Category, Tag, Comment } from '@/lib/types/blog';

/**
 * 博客系统公开 API 接口
 * 对应后端 /v1/public/blog/* 端点
 */
export const blogApi = {
  // ================= 文章接口 =================

  /**
   * 获取文章列表
   */
  getArticles: (params?: {
    page?: number;
    pageSize?: number;
    categoryId?: string;
    tagId?: string;
    status?: string;
  }) =>
    http.get<PaginatedResponse<Article>>('/v1/public/blog/articles', params),

  /**
   * 根据 Slug 获取文章详情
   */
  getArticleBySlug: (slug: string) =>
    http.get<Article>(`/v1/public/blog/articles/${slug}`),

  /**
   * 获取热门文章
   */
  getPopularArticles: (limit = 10) =>
    http.get<Article[]>('/v1/public/blog/articles/popular', { limit }),

  /**
   * 获取相关文章
   */
  getRelatedArticles: (articleId: string, limit = 5) =>
    http.get<Article[]>(`/v1/public/blog/articles/${articleId}/related`, {
      limit,
    }),

  // ================= 分类接口 =================

  /**
   * 获取所有分类
   */
  getCategories: () => http.get<Category[]>('/v1/public/blog/categories'),

  /**
   * 获取分类详情
   */
  getCategoryBySlug: (slug: string) =>
    http.get<Category>(`/v1/public/blog/categories/${slug}`),

  // ================= 标签接口 =================

  /**
   * 获取所有标签
   */
  getTags: () => http.get<Tag[]>('/v1/public/blog/tags'),

  /**
   * 获取标签详情
   */
  getTagBySlug: (slug: string) => http.get<Tag>(`/v1/public/blog/tags/${slug}`),

  // ================= 评论接口 =================

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

  // ================= 搜索接口 =================

  /**
   * 搜索文章
   */
  searchArticles: (
    query: string,
    params?: {
      page?: number;
      pageSize?: number;
    },
  ) =>
    http.get<PaginatedResponse<Article>>('/v1/public/blog/search', {
      q: query,
      ...params,
    }),

  // ================= 系统配置接口 =================

  /**
   * 获取已启用的语言列表
   */
  getEnabledLocales: () =>
    http.get<{
      list: Array<{
        code: string;
        name: string;
        nativeName: string;
        enabled: boolean;
        isDefault: boolean;
      }>;
    }>('/v1/client/system-config/locales'),

  // ================= 收藏功能接口 =================

  /**
   * 获取用户收藏列表
   */
  getBookmarks: (params?: { page?: number; pageSize?: number }) =>
    http.get<PaginatedResponse<Article>>('/v1/frontend/blog/bookmarks', params),

  /**
   * 收藏文章
   */
  addBookmark: (articleId: string) =>
    http.post(`/v1/frontend/blog/articles/${articleId}/bookmark`),

  /**
   * 取消收藏
   */
  removeBookmark: (articleId: string) =>
    http.delete(`/v1/frontend/blog/articles/${articleId}/bookmark`),

  /**
   * 检查收藏状态
   */
  checkBookmarkStatus: (articleId: string) =>
    http.get<{ isBookmarked: boolean; bookmarkedAt?: string }>(
      `/v1/frontend/blog/articles/${articleId}/bookmark-status`,
    ),
};

export default blogApi;
