/**
 * 博客系统类型定义
 * 与后端 Prisma 模型保持一致
 */

export interface Article {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  content: string;
  coverImage: string | null;
  status: 'draft' | 'published' | 'archived';
  views: number;
  likes: number;
  commentsCount: number;
  categoryId: string | null;
  category: Category | null;
  tags: Tag[];
  authorId: string;
  author: {
    id: string;
    name: string;
    avatar: string | null;
  };
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Category {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  icon: string | null;
  color: string | null;
  articlesCount: number;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface Tag {
  id: string;
  slug: string;
  name: string;
  color: string | null;
  articlesCount: number;
  createdAt: string;
}

export interface Comment {
  id: string;
  articleId: string;
  author: string;
  email: string | null;
  website: string | null;
  content: string;
  parentId: string | null;
  approved: boolean;
  likes: number;
  createdAt: string;
  updatedAt: string;
  children?: Comment[];
}
