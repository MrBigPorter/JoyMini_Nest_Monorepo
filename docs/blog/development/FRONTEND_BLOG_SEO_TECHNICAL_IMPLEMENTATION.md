# Frontend Blog SEO 技术实现指南 v2.0.0

> 前端博客SEO技术实现完整文档 - 面向开发者和技术架构师

---

## 📋 文档目标

**技术实现指南**：为开发者提供完整的前端博客SEO技术实现方案

## 🎯 核心目标

- 实现动态Sitemap.xml生成
- 配置智能Robots.txt规则
- 增强页面级Metadata管理
- 创建结构化数据（JSON-LD Schema）
- 支持多语言SEO优化

---

## 🏛️ 技术架构

### 1. SEO技术架构层次

```
┌─────────────────────────────────────────┐
│          Next.js App Router             │
├─────────────────────────────────────────┤
│  ┌─────────┐  ┌─────────┐  ┌─────────┐ │
│  │Sitemap  │  │Robots   │  │Metadata │ │
│  │生成器   │  │控制器   │  │管理器   │ │
│  └─────────┘  └─────────┘  └─────────┘ │
├─────────────────────────────────────────┤
│          API数据获取层                  │
├─────────────────────────────────────────┤
│          Prisma数据库层                 │
└─────────────────────────────────────────┘
```

### 2. 核心组件职责

- **Sitemap生成器**：动态生成XML站点地图，支持多语言
- **Robots控制器**：管理搜索引擎爬取规则，包含sitemap引用
- **Metadata管理器**：处理页面级SEO标签，支持动态生成
- **结构化数据生成器**：创建JSON-LD Schema，增强搜索结果展示
- **多语言处理器**：处理hreflang标签和语言alternate标记

---

## 📁 技术实施指引

### 1. Sitemap.xml 实施

#### 文件位置

```
apps/frontend-blog/src/app/
├── sitemap.ts                    # 主sitemap生成器
└── [locale]/sitemap.ts          # 语言特定sitemap
```

#### 1.1 主sitemap生成器 (`src/app/sitemap.ts`)

```typescript
import { MetadataRoute } from "next";
import { getEnabledLocales } from "@/lib/i18n/config";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const locales = getEnabledLocales();
  const baseUrl =
    process.env.NEXT_PUBLIC_SITE_URL || "https://blog.joyminis.com";

  const sitemaps: MetadataRoute.Sitemap = [];

  // 为每种语言生成sitemap入口
  for (const locale of locales) {
    sitemaps.push({
      url: `${baseUrl}/${locale}/sitemap.xml`,
      lastModified: new Date(),
      changeFrequency: "daily" as const,
      priority: 0.8,
    });
  }

  // 添加robots.txt入口
  sitemaps.push({
    url: `${baseUrl}/robots.txt`,
    lastModified: new Date(),
    changeFrequency: "monthly" as const,
    priority: 0.1,
  });

  return sitemaps;
}

// ISR配置：60分钟重新生成
export const revalidate = 3600;
export const dynamic = "auto";
```

#### 1.2 语言特定sitemap (`src/app/[locale]/sitemap.ts`)

```typescript
import { MetadataRoute } from "next";
import { frontendBlogApi } from "@/lib/api/frontendBlogApi";
import { getEnabledLocales } from "@/lib/i18n/config";
import type { Locale } from "@/lib/i18n/config";

export default async function sitemap({
  params,
}: {
  params: { locale: string };
}): Promise<MetadataRoute.Sitemap> {
  const { locale } = params;
  const baseUrl =
    process.env.NEXT_PUBLIC_SITE_URL || "https://blog.joyminis.com";

  const sitemapEntries: MetadataRoute.Sitemap = [];

  // 静态页面 - 高优先级
  sitemapEntries.push({
    url: `${baseUrl}/${locale}`,
    lastModified: new Date(),
    changeFrequency: "daily" as const,
    priority: 1.0,
  });

  sitemapEntries.push({
    url: `${baseUrl}/${locale}/about`,
    lastModified: new Date(),
    changeFrequency: "monthly" as const,
    priority: 0.7,
  });

  // 动态获取文章 - 中高优先级
  try {
    const articlesResponse = await frontendBlogApi.getArticles({
      lang: locale,
      page: 1,
      pageSize: 1000,
    });

    articlesResponse.items?.forEach((article) => {
      sitemapEntries.push({
        url: `${baseUrl}/${locale}/articles/${article.slug}`,
        lastModified: new Date(article.updatedAt),
        changeFrequency: "weekly" as const,
        priority: 0.9,
      });
    });

    // 获取分类
    const categories = await frontendBlogApi.getCategories(locale);
    categories.forEach((category) => {
      sitemapEntries.push({
        url: `${baseUrl}/${locale}/categories/${category.slug}`,
        lastModified: new Date(),
        changeFrequency: "weekly" as const,
        priority: 0.8,
      });
    });

    // 获取标签
    const tags = await frontendBlogApi.getTags(locale);
    tags.forEach((tag) => {
      sitemapEntries.push({
        url: `${baseUrl}/${locale}/tags/${tag.slug}`,
        lastModified: new Date(),
        changeFrequency: "weekly" as const,
        priority: 0.7,
      });
    });
  } catch (error) {
    console.error("Failed to fetch dynamic content for sitemap:", error);
    // 降级方案：只返回静态页面
  }

  return sitemapEntries;
}

// 为所有语言生成静态参数
export async function generateStaticParams() {
  const locales = getEnabledLocales();
  return locales.map((locale: Locale) => ({ locale }));
}

// ISR配置：60分钟重新生成
export const revalidate = 3600;
export const dynamic = "auto";
```

### 2. Robots.txt 实施

#### 文件位置

```
apps/frontend-blog/src/app/robots.ts
```

#### 实施代码

```typescript
import { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const baseUrl =
    process.env.NEXT_PUBLIC_SITE_URL || "https://blog.joyminis.com";

  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/admin/",
        "/api/",
        "/_next/",
        "/oauth/",
        "/login/",
        "/register/",
        "/bookmarks/", // 用户书签页面
      ],
    },
    sitemap: `${baseUrl}/sitemap.xml`,
    host: baseUrl,
  };
}

// 静态生成，无需重新验证
export const dynamic = "force-static";
```

### 3. Metadata 增强实施

#### 3.1 全局Layout增强 (`src/app/[locale]/layout.tsx`)

```typescript
import type { Metadata } from "next";
import { getEnabledLocales } from "@/lib/i18n/config";

export const metadata: Metadata = {
  title: {
    template: "%s | Tarsier Labs",
    default: "Tarsier Labs - Tech innovation lab from Bohol, Philippines",
  },
  description:
    "Tech innovation lab from Bohol, Philippines. Explore articles about software development, AI, and technology.",
  keywords: [
    "technology",
    "software development",
    "AI",
    "Bohol",
    "Philippines",
    "web development",
    "programming",
  ],

  // Open Graph
  openGraph: {
    type: "website",
    locale: "en_US",
    url: process.env.NEXT_PUBLIC_SITE_URL || "https://blog.joyminis.com",
    siteName: "Tarsier Labs",
    title: "Tarsier Labs - Tech innovation lab",
    description: "Tech innovation lab from Bohol, Philippines",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "Tarsier Labs",
      },
    ],
  },

  // Twitter
  twitter: {
    card: "summary_large_image",
    site: "@tarsierlabs",
    creator: "@tarsierlabs",
    title: "Tarsier Labs",
    description: "Tech innovation lab from Bohol, Philippines",
    images: ["/twitter-image.png"],
  },

  // 语言alternate标记
  alternates: {
    canonical: process.env.NEXT_PUBLIC_SITE_URL || "https://blog.joyminis.com",
    languages: Object.fromEntries(
      getEnabledLocales().map((locale) => [
        locale,
        `${process.env.NEXT_PUBLIC_SITE_URL || "https://blog.joyminis.com"}/${locale}`,
      ]),
    ),
  },

  // 其他重要meta
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },

  // 验证标记
  verification: {
    google: "google-site-verification-code-here", // 从Google Search Console获取
  },
};
```

#### 3.2 页面级Metadata (`src/app/[locale]/articles/[slug]/page.tsx`)

```typescript
import { frontendBlogApi } from "@/lib/api/frontendBlogApi";
import type { Metadata } from "next";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}): Promise<Metadata> {
  const { locale, slug } = await params;
  const baseUrl =
    process.env.NEXT_PUBLIC_SITE_URL || "https://blog.joyminis.com";

  try {
    const article = await frontendBlogApi.getArticleBySlug(slug, locale);

    // 构建文章描述
    const description =
      article.excerpt ||
      (article.content
        ? article.content.substring(0, 160) + "..."
        : "Read this article on Tarsier Labs");

    // 构建关键词
    const keywords = [
      ...(article.tags?.map((tag) => tag.name) || []),
      "technology",
      "software development",
      "AI",
      "Bohol",
      "Philippines",
    ];

    return {
      title: article.title,
      description,
      keywords,

      // Open Graph
      openGraph: {
        type: "article",
        title: article.title,
        description,
        publishedTime: article.publishedAt,
        modifiedTime: article.updatedAt,
        authors: [article.author?.name || "Tarsier Labs"],
        tags: article.tags?.map((tag) => tag.name) || [],
        images: article.coverImage
          ? [
              {
                url: article.coverImage,
                width: 1200,
                height: 630,
                alt: article.title,
              },
            ]
          : [],
      },

      // Twitter
      twitter: {
        card: "summary_large_image",
        title: article.title,
        description,
        images: article.coverImage ? [article.coverImage] : [],
      },

      // 规范URL
      alternates: {
        canonical: `${baseUrl}/${locale}/articles/${slug}`,
      },

      // 其他meta
      robots: {
        index: true,
        follow: true,
      },
    };
  } catch (error) {
    console.error("Failed to generate metadata for article:", error);

    // 降级方案：返回基础metadata
    return {
      title: "Article Not Found",
      description: "The requested article could not be found.",
      robots: {
        index: false,
        follow: false,
      },
    };
  }
}
```

### 4. 结构化数据实施

#### JSON-LD Schema生成器 (`src/lib/seo/schema.ts`)

```typescript
/**
 * SEO结构化数据生成器
 * 生成JSON-LD Schema标记，增强搜索引擎理解
 */

import type {
  FrontendArticle,
  FrontendCategory,
  FrontendTag,
  FrontendCategoryWithArticles,
} from "@/lib/types/frontend-blog";

/**
 * 生成文章页面的结构化数据
 */
export function generateArticleSchema(
  article: FrontendArticle,
  locale: string,
) {
  const baseUrl =
    process.env.NEXT_PUBLIC_SITE_URL || "https://blog.joyminis.com";

  const schema = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: article.title,
    description: article.excerpt || article.content?.substring(0, 200),
    image: article.coverImage ? [article.coverImage] : [],
    datePublished: article.publishedAt,
    dateModified: article.updatedAt,
    author: {
      "@type": "Person",
      name: article.author?.name || "Tarsier Labs",
      url: `${baseUrl}/${locale}/authors/${article.author?.id || "default"}`,
    },
    publisher: {
      "@type": "Organization",
      name: "Tarsier Labs",
      url: baseUrl,
      logo: {
        "@type": "ImageObject",
        url: `${baseUrl}/logo.png`,
        width: 600,
        height: 60,
      },
    },
    mainEntityOfPage: {
      "@type": "WebPage",
      "@id": `${baseUrl}/${locale}/articles/${article.slug}`,
    },
    keywords: article.tags?.map((tag) => tag.name).join(", ") || "",
    articleSection: article.category?.name || "Technology",
    wordCount: article.content?.length || 0,
  };

  return schema;
}

/**
 * 生成分类页面的结构化数据
 */
export function generateCategorySchema(
  category: FrontendCategoryWithArticles,
  locale: string,
) {
  const baseUrl =
    process.env.NEXT_PUBLIC_SITE_URL || "https://blog.joyminis.com";

  const schema = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: category.name,
    description: category.description || `Articles about ${category.name}`,
    url: `${baseUrl}/${locale}/categories/${category.slug}`,
    mainEntity: {
      "@type": "ItemList",
      itemListElement:
        category.articles?.map((article, index) => ({
          "@type": "ListItem",
          position: index + 1,
          item: {
            "@type": "BlogPosting",
            name: article.title,
            url: `${baseUrl}/${locale}/articles/${article.slug}`,
          },
        })) || [],
    },
  };

  return schema;
}

/**
 * 生成标签页面的结构化数据
 */
export function generateTagSchema(tag: FrontendTag, locale: string) {
  const baseUrl =
    process.env.NEXT_PUBLIC_SITE_URL || "https://blog.joyminis.com";

  const schema = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: `Tag: ${tag.name}`,
    description: `Articles tagged with ${tag.name}`,
    url: `${baseUrl}/${locale}/tags/${tag.slug}`,
    keywords: tag.name,
  };

  return schema;
}

/**
 * 生成网站结构化数据
 */
export function generateWebsiteSchema() {
  const baseUrl =
    process.env.NEXT_PUBLIC_SITE_URL || "https://blog.joyminis.com";

  const schema = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "Tarsier Labs",
    url: baseUrl,
    description: "Tech innovation lab from Bohol, Philippines",
    publisher: {
      "@type": "Organization",
      name: "Tarsier Labs",
      logo: {
        "@type": "ImageObject",
        url: `${baseUrl}/logo.png`,
      },
    },
    potentialAction: {
      "@type": "SearchAction",
      target: `${baseUrl}/search?q={search_term_string}`,
      "query-input": "required name=search_term_string",
    },
  };

  return schema;
}
```

---

## 🔧 技术验证

### 1. 本地验证命令

```bash
# 验证sitemap可访问性
curl -I http://localhost:3000/sitemap.xml
curl -I http://localhost:3000/zh/sitemap.xml

# 验证robots.txt可访问性
curl -I http://localhost:3000/robots.txt

# 验证页面metadata
curl -s http://localhost:3000/zh | grep -E "(title|description|canonical)"
```

### 2. 构建验证

```bash
# 运行构建检查
cd apps/frontend-blog && yarn build

# 检查构建错误
cd apps/frontend-blog && yarn type-check
```

### 3. 在线验证工具

1. **Google Rich Results Test**: https://search.google.com/test/rich-results
2. **Schema Markup Validator**: https://validator.schema.org/
3. **Lighthouse SEO Audit**: 使用Chrome DevTools

---

## 🚨 常见技术问题

### 1. Sitemap构建错误

**问题**: `Cannot destructure property 'locale' of 'a' as it is undefined`
**解决方案**: 确保sitemap函数正确接收params参数，使用Next.js 15的异步params处理

### 2. 类型错误

**问题**: TypeScript类型检查失败
**解决方案**: 确保所有导入类型正确，使用项目中的类型定义

### 3. 多语言路由问题

**问题**: 语言alternate标记不正确
**解决方案**: 使用`getEnabledLocales()`获取可用语言
