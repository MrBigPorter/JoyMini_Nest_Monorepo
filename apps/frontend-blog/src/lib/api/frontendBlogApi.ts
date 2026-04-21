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
  BookmarkedArticle,
  BookmarkResponse,
  BookmarkStatusResponse,
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
    lang?: string;
  }) =>
    http.get<FrontendPaginatedResponse<FrontendArticle>>(
      '/v1/frontend/blog/articles',
      params,
    ),

  /**
   * 根据 Slug 获取文章详情（简化版）
   */
  getArticleBySlug: (slug: string, lang?: string) =>
    http.get<FrontendArticle>(`/v1/frontend/blog/articles/${slug}`, { lang }),

  /**
   *
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
  getCategories: (lang?: string) =>
    http.get<FrontendCategory[]>('/v1/frontend/blog/categories', { lang }),

  /**
   * 获取分类详情（简化版）
   */
  getCategoryBySlug: (
    slug: string,
    params?: {
      page?: number;
      pageSize?: number;
      lang?: string;
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
  getTags: (lang?: string) =>
    http.get<FrontendTag[]>('/v1/frontend/blog/tags', { lang }),

  /**
   * 获取标签详情（简化版）
   */
  getTagBySlug: (
    slug: string,
    params?: {
      page?: number;
      pageSize?: number;
      lang?: string;
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

  // ================= 收藏接口 =================

  /**
   * 获取用户收藏列表
   */
  getBookmarks: (params?: {
    page?: number;
    pageSize?: number;
    locale?: string;
  }) =>
    http.get<FrontendPaginatedResponse<BookmarkedArticle>>(
      '/v1/frontend/blog/bookmarks',
      params,
    ),

  /**
   * 收藏文章
   */
  addBookmark: (articleId: string) =>
    http.post<BookmarkResponse>(
      `/v1/frontend/blog/articles/${articleId}/bookmark`,
    ),

  /**
   * 取消收藏
   */
  removeBookmark: (articleId: string) =>
    http.delete<BookmarkResponse>(
      `/v1/frontend/blog/articles/${articleId}/bookmark`,
    ),

  /**
   * 检查收藏状态
   */
  checkBookmarkStatus: (articleId: string) =>
    http.get<BookmarkStatusResponse>(
      `/v1/frontend/blog/articles/${articleId}/bookmark-status`,
    ),

  /**
   * 批量查询收藏状态
   */
  batchCheckBookmarkStatus: (articleIds: string[]) =>
    http.post<{
      results: Array<{
        articleId: string;
        isBookmarked: boolean;
        bookmarkedAt?: string;
      }>;
      total: number;
      batchSize: number;
    }>('/v1/frontend/blog/articles/batch-bookmark-status', {
      articleIds,
    }),

  // ================= 评论接口 =================
  // 注意：评论接口暂时使用原有接口，因为评论逻辑相对简单
  // 如果需要简化，可以在后续版本中迁移

  /**
   * 获取文章评论列表
   * 注意：后端返回的评论有status字段，前端需要转换为approved字段
   */
  getComments: (
    articleId: string,
    params?: {
      page?: number;
      pageSize?: number;
    },
  ) =>
    http
      .get<
        PaginatedResponse<any>
      >(`/v1/frontend/blog/articles/${articleId}/comments`, params)
      .then((response) => {
        // 转换数据：将status字段映射为approved字段
        if (response && response.items) {
          const transformedItems = response.items.map((item: any) => ({
            ...item,
            approved: item.status === 'APPROVED',
            // 确保所有必需字段都存在
            email: item.email || null,
            website: item.website || null,
            likes: item.likes || 0,
            children: item.children || [],
          }));

          return {
            ...response,
            items: transformedItems,
          };
        }
        return response;
      }),

  /**
   * 获取评论状态
   * 用于检查单个评论的审核状态（PENDING/APPROVED/REJECTED）
   */
  getCommentStatus: (commentId: string) =>
    http.get<{
      id: string;
      status: string;
      articleId: string;
      createdAt: Date;
      updatedAt: Date;
    }>(`/v1/frontend/blog/comments/${commentId}/status`),

  /**
   * 获取评论的回复列表
   * 用于检查是否有自动回复
   */
  getCommentReplies: (commentId: string) =>
    http.get<{
      commentId: string;
      replies: Array<{
        id: string;
        author: string;
        email: string;
        content: string;
        isAiGenerated: boolean;
        createdAt: Date;
      }>;
    }>(`/v1/frontend/blog/comments/${commentId}/replies`),

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
    http.post<Comment>(
      `/v1/frontend/blog/articles/${articleId}/comments`,
      data,
    ),
};

export default frontendBlogApi;
