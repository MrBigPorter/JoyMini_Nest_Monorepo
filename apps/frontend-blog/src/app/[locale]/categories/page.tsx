import { getTranslations } from 'next-intl/server';
import { getPlatformCategories } from '@/lib/platform/services/data.service';
import { getEnabledLocales } from '@/lib/i18n/config';
import CategoriesPageClient from './page.client';
import type { Locale } from '@/lib/i18n/config';

// Next.js 15 perfect cache pattern
// revalidate combination
// Each locale has independent cache, no cross contamination
export const revalidate = 600;

// generate static params for all locales
export async function generateStaticParams() {
  return getEnabledLocales().map((locale: Locale) => ({ locale }));
}

// cloudflare cache headers
export async function generateHeaders() {
  return {
    'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=3600',
  };
}

export default async function CategoriesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: routeLocale } = await params;
  const locale = routeLocale;

  const t = await getTranslations({ locale });

  try {
    const categories = await getPlatformCategories(locale);

    return <CategoriesPageClient initialData={categories} locale={locale} />;
  } catch (error) {
    console.error('Categories page server error:', error);

    return <CategoriesPageClient initialData={[]} locale={locale} />;
  }
}
