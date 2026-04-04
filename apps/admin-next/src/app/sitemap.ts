import type { MetadataRoute } from 'next';

const DEFAULT_BASE_URL = 'https://admin.joyminis.com';

const PUBLIC_SITEMAP_ROUTES: Array<{
  path: string;
  changeFrequency: MetadataRoute.Sitemap[number]['changeFrequency'];
  priority: number;
}> = [
  { path: '/login', changeFrequency: 'yearly', priority: 0.8 },
  { path: '/register-apply', changeFrequency: 'yearly', priority: 0.5 },
  { path: '/privacy-policy', changeFrequency: 'yearly', priority: 0.4 },
];

function normalizeBaseUrl(rawBaseUrl?: string): string {
  const candidate = (rawBaseUrl ?? DEFAULT_BASE_URL).trim();
  return candidate.endsWith('/') ? candidate.slice(0, -1) : candidate;
}

function resolveLastModified(): Date {
  const deployedAt = process.env.NEXT_PUBLIC_DEPLOYED_AT;
  if (!deployedAt) {
    return new Date();
  }

  const parsed = new Date(deployedAt);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

/**
 * Sitemap — public routes only.
 * App Router 会自动暴露为 /sitemap.xml。
 *
 * 可选环境变量：
 * - NEXT_PUBLIC_ADMIN_SITE_URL: 用于 dev/staging 生成正确域名
 * - NEXT_PUBLIC_DEPLOYED_AT: 复用部署时间作为 lastModified
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = normalizeBaseUrl(process.env.NEXT_PUBLIC_ADMIN_SITE_URL);
  const lastModified = resolveLastModified();

  return PUBLIC_SITEMAP_ROUTES.map((route) => ({
    url: `${baseUrl}${route.path}`,
    lastModified,
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }));
}
