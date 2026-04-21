import { getEnabledLocales } from '@/lib/i18n/config';
import type { Locale } from '@/lib/i18n/config';
import LoginPageClient from './page.client';

// Login page is completely static
// Build time prerender for all locales, update once per day
export const revalidate = 86400;

export async function generateStaticParams() {
  return getEnabledLocales().map((locale: Locale) => ({ locale }));
}

export default function LoginPage() {
  return <LoginPageClient />;
}
