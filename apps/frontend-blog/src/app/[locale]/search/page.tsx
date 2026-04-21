import SearchClientView from './SearchClientView';

// 静态导出支持：返回空数组，不预生成任何页面
import { getEnabledLocales } from '@/lib/i18n/config';
import type { Locale } from '@/lib/i18n/config';

export async function generateStaticParams() {
  return getEnabledLocales().map((locale: Locale) => ({ locale }));
}

export const dynamic = 'force-static';

export default function SearchPage() {
  return <SearchClientView />;
}
