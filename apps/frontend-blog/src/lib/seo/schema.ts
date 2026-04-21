/**
 * SEO结构化数据生成器
 * 生成JSON-LD Schema标记，增强搜索引擎理解
 */

import type {
  FrontendArticle,
  FrontendCategory,
  FrontendTag,
  FrontendCategoryWithArticles,
} from '@/lib/types/frontend-blog';

/**
 * 生成文章页面的结构化数据
 */
export function generateArticleSchema(
  article: FrontendArticle,
  locale: string,
) {
  const baseUrl =
    process.env.NEXT_PUBLIC_SITE_URL || 'https://blog.joyminis.com';

  const schema = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: article.title,
    description: article.excerpt || article.content?.substring(0, 200),
    image: article.coverImage ? [article.coverImage] : [],
    datePublished: article.publishedAt,
    dateModified: article.updatedAt,
    author: {
      '@type': 'Person',
      name: article.author?.name || 'Tarsier Labs',
    },
    publisher: {
      '@type': 'Organization',
      name: 'Tarsier Labs',
      logo: {
        '@type': 'ImageObject',
        url: `${baseUrl}/logo.png`,
        width: 512,
        height: 512,
      },
    },
    mainEntityOfPage: {
      '@type': 'WebPage',
      '@id': `${baseUrl}/${locale}/articles/${article.slug}`,
    },
    inLanguage: locale,
    keywords: article.tags?.map((tag) => tag.name).join(', ') || '',
    wordCount: article.content?.length || 0,
    articleSection: article.category?.name || 'Technology',
  };

  return schema;
}

/**
 * 生成分类页面的结构化数据
 */
export function generateCategorySchema(
  category: FrontendCategory | FrontendCategoryWithArticles,
  locale: string,
) {
  const baseUrl =
    process.env.NEXT_PUBLIC_SITE_URL || 'https://blog.joyminis.com';

  const schema = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: category.name,
    description: category.description || `Articles about ${category.name}`,
    url: `${baseUrl}/${locale}/categories/${category.slug}`,
    mainEntity: {
      '@type': 'ItemList',
      numberOfItems: 'articleCount' in category ? category.articleCount : 0,
    },
  };

  return schema;
}

/**
 * 生成组织结构化数据
 */
export function generateOrganizationSchema() {
  const baseUrl =
    process.env.NEXT_PUBLIC_SITE_URL || 'https://blog.joyminis.com';

  const schema = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'Tarsier Labs',
    url: baseUrl,
    logo: `${baseUrl}/logo.png`,
    description: 'Tech innovation lab from Bohol, Philippines',
    foundingLocation: {
      '@type': 'Place',
      name: 'Bohol, Philippines',
    },
    sameAs: [
      'https://twitter.com/tarsierlabs',
      'https://github.com/tarsierlabs',
    ],
  };

  return schema;
}

/**
 * 生成面包屑导航结构化数据
 */
export function generateBreadcrumbSchema(
  items: Array<{
    name: string;
    url: string;
  }>,
) {
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: item.url,
    })),
  };

  return schema;
}

/**
 * 生成标签页面的结构化数据
 */
export function generateTagSchema(tag: FrontendTag, locale: string) {
  const baseUrl =
    process.env.NEXT_PUBLIC_SITE_URL || 'https://blog.joyminis.com';

  const schema = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: `#${tag.name}`,
    description: `Articles tagged with ${tag.name}`,
    url: `${baseUrl}/${locale}/tags/${tag.slug}`,
    about: {
      '@type': 'Thing',
      name: tag.name,
    },
  };

  return schema;
}

/**
 * 在页面中安全地注入结构化数据
 */
export function injectStructuredData(schema: object): string {
  return JSON.stringify(schema, null, 2);
}
