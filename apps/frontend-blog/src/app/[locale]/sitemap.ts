import { MetadataRoute } from 'next';
import { frontendBlogApi } from '@/lib/api/frontendBlogApi';
import { getEnabledLocales } from '@/lib/i18n/config';
import type { Locale } from '@/lib/i18n/config';

/**
 * 语言特定sitemap生成器
 * 为每种语言生成详细的页面sitemap
 *
 * 访问路径: /[locale]/sitemap.xml
 * 缓存策略: ISR 60分钟
 */
export default async function sitemap({
  params,
}: {
  params: { locale: string };
}): Promise<MetadataRoute.Sitemap> {
  // App模式下跳过sitemap生成，避免构建错误
  if (process.env.BUILD_TARGET === 'app') {
    console.log('App模式：跳过sitemap生成');
    return [];
  }

  // 安全解构参数，提供默认值
  const { locale } = params || { locale: 'zh' };
  const baseUrl =
    process.env.NEXT_PUBLIC_SITE_URL || 'https://blog.joyminis.com';

  const sitemapEntries: MetadataRoute.Sitemap = [];

  // 静态页面 - 高优先级
  sitemapEntries.push({
    url: `${baseUrl}/${locale}/`,
    lastModified: new Date(),
    changeFrequency: 'daily' as const,
    priority: 1.0,
  });

  sitemapEntries.push({
    url: `${baseUrl}/${locale}/about/`,
    lastModified: new Date(),
    changeFrequency: 'monthly' as const,
    priority: 0.7,
  });

  sitemapEntries.push({
    url: `${baseUrl}/${locale}/categories/`,
    lastModified: new Date(),
    changeFrequency: 'weekly' as const,
    priority: 0.8,
  });

  sitemapEntries.push({
    url: `${baseUrl}/${locale}/tags/`,
    lastModified: new Date(),
    changeFrequency: 'weekly' as const,
    priority: 0.8,
  });

  sitemapEntries.push({
    url: `${baseUrl}/${locale}/search/`,
    lastModified: new Date(),
    changeFrequency: 'daily' as const,
    priority: 0.6,
  });

  try {
    // 动态获取文章 - 中高优先级
    const articlesResponse = await frontendBlogApi.getArticles({
      lang: locale,
      page: 1,
      pageSize: 1000, // 获取足够多的文章
    });

    articlesResponse.items?.forEach((article) => {
      sitemapEntries.push({
        url: `${baseUrl}/${locale}/articles/${article.slug}/`,
        lastModified: new Date(article.updatedAt),
        changeFrequency: 'weekly' as const,
        priority: 0.9,
      });
    });

    // 获取分类
    const categories = await frontendBlogApi.getCategories(locale);
    categories.forEach((category) => {
      sitemapEntries.push({
        url: `${baseUrl}/${locale}/categories/${category.slug}/`,
        lastModified: new Date(),
        changeFrequency: 'weekly' as const,
        priority: 0.8,
      });
    });

    // 获取标签
    const tags = await frontendBlogApi.getTags(locale);
    tags.forEach((tag) => {
      sitemapEntries.push({
        url: `${baseUrl}/${locale}/tags/${tag.slug}/`,
        lastModified: new Date(),
        changeFrequency: 'weekly' as const,
        priority: 0.7,
      });
    });
  } catch (error) {
    console.error('Failed to fetch dynamic content for sitemap:', error);
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
export const revalidate = 3600; // 1小时
export const dynamic = 'auto';
