/**
 * 前端博客专用类型定义
 * 对应后端 /v1/frontend/blog/* 接口返回的简化数据结构
 */

/**
 * 前端博客文章（简化版）
 */
/**
 * Rich media meta for blog articles
 * Contains blurhash, image variants, and video HLS info
 */

export interface ArticleMeta {
  blurhash?: string;
  images?: {
    blurhash: string;
    original: string;
    large: { webp: string; jpg: string };
    medium: { webp: string; jpg: string };
    thumbnail: { webp: string; jpg: string };
  };
  video?: {
    hlsUrl: string;
    duration: number;
    qualities: string[];
    poster?: string; // URL of extracted video thumbnail frame (JPEG)
  };
  /**
   * Array of video mappings for rich-text-embedded videos.
   * Populated by media.processor.ts after transcoding completes.
   * Frontend uses this to replace <video src="xxx.mp4"> with HLS m3u8 URL.
   */
  contentVideo?: Array<{
    videoKey: string; // R2 object key, e.g. "videos/uuid.mp4"
    hlsUrl: string; // Transcoded HLS URL, e.g. ".../master.m3u8"
    poster?: string; // Optional poster/thumbnail frame URL
  }>;
  [key: string]: unknown;
}

export interface FrontendArticle {
  id: string;
  slug: string;
  featured?: boolean;
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
  meta?: ArticleMeta; // Rich media meta (blurhash, image variants, video HLS)
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
 * 带收藏时间的文章
 */
export interface BookmarkedArticle extends FrontendArticle {
  bookmarkedAt: string;
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

/**
 * 收藏响应
 */
export interface BookmarkResponse {
  id: string;
  userId: string;
  articleId: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * 收藏状态响应
 */
export interface BookmarkStatusResponse {
  isBookmarked: boolean;
  bookmarkedAt?: string;
}

/**
 * 点赞响应
 */
export interface LikeResponse {
  likeCount: number;
}

/**
 * 点赞状态响应
 */
export interface LikeStatusResponse {
  liked: boolean;
}
