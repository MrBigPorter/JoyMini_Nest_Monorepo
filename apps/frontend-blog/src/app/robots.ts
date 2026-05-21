import { MetadataRoute } from 'next';
import { getEnabledLocales } from '@/lib/i18n/config';

/**
 * Robots.txt 生成器
 * 控制搜索引擎爬取行为
 *
 * 访问路径: /robots.txt
 * 缓存策略: 静态生成
 *
 * 改进：显式列出所有 locale sitemap，帮助 Google 更快发现所有语言页面
 */
export default function robots(): MetadataRoute.Robots {
  const baseUrl =
    process.env.NEXT_PUBLIC_SITE_URL || 'https://blog.joyminis.com';
  const locales = getEnabledLocales();

  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: [
        '/admin/',
        '/api/',
        '/_next/',
        '/oauth/',
        '/login/',
        '/register/',
        '/bookmarks/', // 需要登录的页面
        '/dashboard/',
        '/settings/',
        '/node_modules/',
        '/.git/',
        '/.env',
        '/.env.*',
      ],
    },
    // 显式列出所有 locale sitemap，帮助搜索引擎更快发现所有语言页面
    sitemap: [
      `${baseUrl}/sitemap.xml`,
      ...locales.map((l) => `${baseUrl}/${l}/sitemap.xml`),
    ],
    host: baseUrl,
  };
}

// 静态生成，无需重新验证
export const dynamic = 'force-static';
export const revalidate = false;
