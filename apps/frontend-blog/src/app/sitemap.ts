import { MetadataRoute } from 'next';
import { getEnabledLocales } from '@/lib/i18n/config';

/**
 * 主sitemap生成器
 * 为每种语言生成sitemap入口
 *
 * 访问路径: /sitemap.xml
 * 缓存策略: ISR 60分钟
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const locales = getEnabledLocales();
  const baseUrl =
    process.env.NEXT_PUBLIC_SITE_URL || 'https://blog.joyminis.com';

  const sitemaps: MetadataRoute.Sitemap = [];

  // 为每种语言生成sitemap入口
  for (const locale of locales) {
    sitemaps.push({
      url: `${baseUrl}/${locale}/sitemap.xml`,
      lastModified: new Date(),
      changeFrequency: 'daily' as const,
      priority: 0.8,
    });
  }

  // 添加robots.txt入口
  sitemaps.push({
    url: `${baseUrl}/robots.txt`,
    lastModified: new Date(),
    changeFrequency: 'monthly' as const,
    priority: 0.1,
  });

  return sitemaps;
}

// ISR配置：60分钟重新生成
export const revalidate = 3600; // 1小时
export const dynamic = 'auto';
