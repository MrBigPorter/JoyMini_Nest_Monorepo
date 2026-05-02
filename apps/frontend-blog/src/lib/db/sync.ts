import {
  db,
  type ArticleRecord,
  type CategoryRecord,
  type TagRecord,
} from './db';
import type {
  FrontendArticle,
  FrontendCategory,
  FrontendTag,
  FrontendPaginatedResponse,
} from '@/lib/types/frontend-blog';

// ──────────────────────────────────────────────────
// Article Sync
// ──────────────────────────────────────────────────

/**
 * Write API article responses into IndexedDB.
 * Uses `bulkPut` to upsert — existing records with the same `id` are overwritten.
 */
export async function syncArticles(
  articles: FrontendArticle[],
  locale: string,
  page: number,
  categoryId?: string,
): Promise<void> {
  if (!articles.length) return;

  const records: ArticleRecord[] = articles.map((a) => ({
    id: a.id,
    slug: a.slug,
    title: a.title,
    coverImage: a.coverImage,
    excerpt: a.excerpt,
    category: a.category,
    tags: a.tags,
    createdAt: a.publishedAt,
    updatedAt: a.updatedAt,
    locale,
    page,
    categoryId,
    summary: a.excerpt,
    viewCount: a.views,
    commentCount: a.commentsCount,
  }));

  await db.articles.bulkPut(records);
}

/**
 * Read cached articles from IndexedDB for a given locale + page + optional category.
 */
export async function getCachedArticles(
  locale: string,
  page: number,
  categoryId?: string,
): Promise<FrontendArticle[]> {
  const records = categoryId
    ? await db.articles
        .where(['locale+page'])
        .equals([locale, page])
        .filter((a) => a.categoryId === categoryId)
        .toArray()
    : await db.articles.where(['locale+page']).equals([locale, page]).toArray();

  // Map back to FrontendArticle shape
  return records.map((r) => ({
    id: r.id,
    slug: r.slug,
    title: r.title,
    excerpt: r.summary || r.excerpt || '',
    coverImage: r.coverImage || '',
    views: r.viewCount || 0,
    likes: 0,
    commentsCount: r.commentCount || 0,
    publishedAt: r.createdAt,
    updatedAt: r.updatedAt,
    category: r.category,
    tags: r.tags,
  })) as FrontendArticle[];
}

/**
 * Remove stale article entries (e.g. different page numbers for same locale).
 * Call this after a full re-sync to keep IndexedDB lean.
 */
export async function pruneStaleArticles(
  locale: string,
  keepPages: number[],
  categoryId?: string,
): Promise<void> {
  const allRecords = categoryId
    ? await db.articles.where({ locale, categoryId }).toArray()
    : await db.articles.where({ locale }).toArray();

  const toDelete = allRecords
    .filter((r) => !keepPages.includes(r.page))
    .map((r) => r.id);

  if (toDelete.length > 0) {
    await db.articles.bulkDelete(toDelete);
  }
}

// ──────────────────────────────────────────────────
// Article Content Sync (detail page)
// ──────────────────────────────────────────────────

/**
 * Cache full article content (from detail page) into IndexedDB.
 */
export async function syncArticleContent(
  article: FrontendArticle,
  locale: string,
): Promise<void> {
  await Promise.all([
    // 1. 存储文章正文内容
    db.articleContents.put({
      slug: article.slug,
      content: article.content,
      contentMd: article.contentMd,
      updatedAt: article.updatedAt,
      locale,
    }),
    // 2. 同时存储文章元数据到 articles 表，确保 getCachedArticleContent
    //    能通过 baseArticle 获取完整元数据（title, excerpt, coverImage 等）。
    //    upsert 不影响已有的 viewCount/commentCount 等字段。
    db.articles.put({
      id: article.id,
      slug: article.slug,
      title: article.title || '',
      coverImage: article.coverImage || '',
      excerpt: article.excerpt || '',
      category: article.category,
      tags: article.tags,
      createdAt: article.publishedAt || article.updatedAt,
      updatedAt: article.updatedAt,
      locale,
      page: 0,
    }),
  ]);
}

/**
 * Retrieve cached article content by slug.
 */
export async function getCachedArticleContent(
  slug: string,
  locale: string,
): Promise<FrontendArticle | null> {
  const record = await db.articleContents.where({ slug, locale }).first();

  if (!record) return null;

  // Also fetch the base article metadata from the articles table
  const baseArticle = await db.articles.where({ slug, locale }).first();

  return {
    id: baseArticle?.id || slug,
    slug: record.slug,
    title: baseArticle?.title || '',
    excerpt: baseArticle?.summary || '',
    coverImage: baseArticle?.coverImage || '',
    content: record.content,
    contentMd: record.contentMd,
    views: baseArticle?.viewCount || 0,
    likes: 0,
    commentsCount: baseArticle?.commentCount || 0,
    publishedAt: baseArticle?.createdAt || record.updatedAt,
    updatedAt: record.updatedAt,
    category: baseArticle?.category,
    tags: baseArticle?.tags,
  } as FrontendArticle;
}

// ──────────────────────────────────────────────────
// Category Sync
// ──────────────────────────────────────────────────

/**
 * Write categories into IndexedDB.
 */
export async function syncCategories(
  categories: FrontendCategory[],
  locale: string,
): Promise<void> {
  if (!categories.length) return;

  const records: CategoryRecord[] = categories.map((c) => ({
    id: c.id,
    name: c.name,
    slug: c.slug,
    locale,
    description: c.description,
    coverImage: c.coverImage,
    articleCount: c.articleCount,
  }));

  await db.categories.bulkPut(records);
}

/**
 * Read cached categories from IndexedDB.
 */
export async function getCachedCategories(
  locale: string,
): Promise<FrontendCategory[]> {
  const records = await db.categories.where({ locale }).toArray();

  return records.map((r) => ({
    id: r.id,
    name: r.name,
    slug: r.slug,
    description: r.description || '',
    coverImage: r.coverImage || '',
    articleCount: r.articleCount || 0,
  })) as FrontendCategory[];
}

// ──────────────────────────────────────────────────
// Tag Sync
// ──────────────────────────────────────────────────

/**
 * Write tags into IndexedDB.
 */
export async function syncTags(
  tags: FrontendTag[],
  locale: string,
): Promise<void> {
  if (!tags.length) return;

  const records: TagRecord[] = tags.map((t) => ({
    id: t.id,
    name: t.name,
    slug: t.slug,
    locale,
    articleCount: t.articleCount,
  }));

  await db.tags.bulkPut(records);
}

/**
 * Read cached tags from IndexedDB.
 */
export async function getCachedTags(locale: string): Promise<FrontendTag[]> {
  const records = await db.tags.where({ locale }).toArray();

  return records.map((r) => ({
    id: r.id,
    name: r.name,
    slug: r.slug,
    articleCount: r.articleCount || 0,
  })) as FrontendTag[];
}

// ──────────────────────────────────────────────────
// Metadata Helpers
// ──────────────────────────────────────────────────

/**
 * Store a metadata key-value pair.
 */
export async function setMetadata(key: string, value: unknown): Promise<void> {
  await db.metadata.put({
    key,
    value: JSON.stringify(value),
    updatedAt: Date.now(),
  });
}

/**
 * Read a metadata value by key.
 */
export async function getMetadata<T = unknown>(key: string): Promise<T | null> {
  const record = await db.metadata.get(key);
  if (!record) return null;
  try {
    return JSON.parse(record.value) as T;
  } catch {
    return null;
  }
}

/**
 * Get the total number of pages cached for a given locale.
 * Falls back to the articles table count if metadata is not set.
 */
export async function getCachedTotalPages(locale: string): Promise<number> {
  const stored = await getMetadata<number>(`totalPages_${locale}`);
  if (stored !== null) return stored;

  // Fallback: estimate from distinct pages in articles table
  const records = await db.articles.where({ locale }).toArray();

  const distinctPages = new Set(records.map((r) => r.page));
  return distinctPages.size || 1;
}

// ──────────────────────────────────────────────────
// Clear & Reset
// ──────────────────────────────────────────────────

/**
 * Clear all data from IndexedDB (for debugging or user-initiated cache clear).
 */
export async function clearAllCachedData(): Promise<void> {
  await Promise.all([
    db.articles.clear(),
    db.articleContents.clear(),
    db.categories.clear(),
    db.tags.clear(),
    db.metadata.clear(),
  ]);
}

/**
 * Clear only stale article data (keeps categories and metadata).
 */
export async function clearArticlesCache(): Promise<void> {
  await Promise.all([db.articles.clear(), db.articleContents.clear()]);
}
