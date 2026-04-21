import { MetadataRoute } from 'next';

/**
 * Robots.txt 生成器
 * 控制搜索引擎爬取行为
 *
 * 访问路径: /robots.txt
 * 缓存策略: 静态生成
 */
export default function robots(): MetadataRoute.Robots {
  const baseUrl =
    process.env.NEXT_PUBLIC_SITE_URL || 'https://blog.joyminis.com';

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
    sitemap: `${baseUrl}/sitemap.xml`,
    host: baseUrl,
  };
}

// 静态生成，无需重新验证
export const dynamic = 'force-static';
export const revalidate = false;
