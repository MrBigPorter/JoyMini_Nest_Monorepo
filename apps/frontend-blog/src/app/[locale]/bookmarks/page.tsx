import BookmarksPageClient from './page.client';

// 静态导出支持：返回空数组，不预生成任何页面
import { getEnabledLocales } from '@/lib/i18n/config';
import type { Locale } from '@/lib/i18n/config';

export async function generateStaticParams() {
  return getEnabledLocales().map((locale: Locale) => ({ locale }));
}

export const dynamic = 'force-dynamic';

export default function BookmarksPage() {
  return <BookmarksPageClient />;
}
