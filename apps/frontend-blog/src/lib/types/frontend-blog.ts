/**
 * 前端博客专用类型定义
 * 对应后端 /v1/frontend/blog/* 接口返回的简化数据结构
 */

/**
 * 前端博客文章（简化版）
 */
export interface FrontendArticle {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  content?: string; // 可选，只在详情页返回
  contentMd?: string; // 可选，只在详情页返回
  coverImage: string;
  views: number;
  likes: number;
  commentsCount: number;
  publishedAt: string;
  updatedAt: string;
  category?: {
    id: string;
    name: string;
    slug: string;
  };
  tags?: Array<{
    id: string;
    name: string;
    slug: string;
  }>;
  author?: {
    id: string;
    name: string;
    avatar: string;
  };
  relatedArticles?: FrontendArticle[]; // 可选，只在详情页返回
}

/**
 * 前端博客分类（简化版）
 */
export interface FrontendCategory {
  id: string;
  name: string;
  slug: string;
  description: string;
  coverImage: string;
  articleCount: number;
}

/**
 * 前端博客标签（简化版）
 */
export interface FrontendTag {
  id: string;
  name: string;
  slug: string;
  articleCount: number;
}

/**
 * 带文章的分类详情
 */
export interface FrontendCategoryWithArticles extends FrontendCategory {
  articles: {
    items: FrontendArticle[];
    total: number;
    page: number;
    pageSize: number;
  };
}

/**
 * 带文章的标签详情
 */
export interface FrontendTagWithArticles extends FrontendTag {
  articles: {
    items: FrontendArticle[];
    total: number;
    page: number;
    pageSize: number;
  };
}

/**
 * 博客统计
 */
export interface FrontendBlogStats {
  totalArticles: number;
  totalCategories: number;
  totalTags: number;
  totalComments: number;
  totalViews: number;
  totalLikes: number;
}

/**
 * 文章归档项
 */
export interface FrontendArchiveItem {
  year: number;
  month: number;
  count: number;
  articles: FrontendArticle[];
}

/**
 * 分页响应
 */
export interface FrontendPaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}
