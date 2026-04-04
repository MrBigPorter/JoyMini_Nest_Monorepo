import type { MetadataRoute } from 'next';

/**
 * Admin panel robots policy.
 * Serves /robots.txt automatically via Next.js App Router.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
      },
    ],
    sitemap: 'https://admin.joyminis.com/sitemap.xml',
  };
}
