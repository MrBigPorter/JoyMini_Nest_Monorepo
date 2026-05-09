import Dexie, { type Table } from 'dexie';

// ──────────────────────────────────────────────────
// IndexedDB Record Types
// ──────────────────────────────────────────────────

export interface ArticleRecord {
  id: string;
  slug: string;
  title: string;
  coverImage?: string;
  excerpt?: string;
  category?: { id: string; name: string; slug: string };
  tags?: { id: string; name: string; slug: string }[];
  createdAt: string;
  updatedAt: string;
  locale: string;
  /** Pagination page number this record came from */
  page: number;
  /** Category filter used when fetching */
  categoryId?: string;
  summary?: string;
  viewCount?: number;
  commentCount?: number;
}

export interface ArticleContentRecord {
  slug: string;
  content?: string;
  contentMd?: string;
  meta?: unknown;
  updatedAt: string;
  locale: string;
}

export interface CategoryRecord {
  id: string;
  name: string;
  slug: string;
  locale: string;
  description?: string;
  coverImage?: string;
  articleCount?: number;
}

export interface TagRecord {
  id: string;
  name: string;
  slug: string;
  locale: string;
  description?: string;
  articleCount?: number;
}

export interface MetadataRecord {
  key: string;
  /** JSON-stringified value */
  value: string;
  updatedAt: number;
}

// ──────────────────────────────────────────────────
// Dexie Database Class
// ──────────────────────────────────────────────────

class BlogDB extends Dexie {
  articles!: Table<ArticleRecord, string>;
  articleContents!: Table<ArticleContentRecord, string>;
  categories!: Table<CategoryRecord, string>;
  tags!: Table<TagRecord, string>;
  metadata!: Table<MetadataRecord, string>;

  constructor() {
    super('JoyMiniBlog');

    this.version(1).stores({
      // Primary key: id
      // Indexes: slug, locale, categoryId, composite [locale+page]
      articles: 'id, slug, locale, categoryId, [locale+page]',

      // Primary key: slug
      // Indexes: locale
      articleContents: 'slug, locale',

      // Primary key: id
      // Indexes: slug, locale
      categories: 'id, slug, locale',

      // Primary key: key
      metadata: 'key',
    });

    this.version(2).stores({
      // Primary key: id
      // Indexes: slug, locale
      tags: 'id, slug, locale',
    });
  }
}

export const db = new BlogDB();
