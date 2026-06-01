import { SITE_URL } from '@/lib/constants/site';
import type { Metadata } from 'next';
import { getEnabledLocales, type Locale } from '@/lib/i18n/config';
import { getPrivacyPolicyContent } from '@/lib/privacy/privacy-content';
import { PrivacyMarkdown } from './PrivacyMarkdown';

export const revalidate = 3600;
export const dynamic = 'force-static';

export async function generateStaticParams() {
  return getEnabledLocales().map((locale: Locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const baseUrl = SITE_URL;

  return {
    title: 'Privacy Policy | Tarsier Labs',
    description: 'Privacy policy for Tarsier Labs applications and services.',
    robots: { index: true, follow: true },
    alternates: {
      canonical: `${baseUrl}/${locale}/privacy`,
      languages: {
        en: `${baseUrl}/en/privacy`,
        zh: `${baseUrl}/zh/privacy`,
        ja: `${baseUrl}/ja/privacy`,
        ko: `${baseUrl}/ko/privacy`,
        fr: `${baseUrl}/fr/privacy`,
        de: `${baseUrl}/de/privacy`,
      },
    },
  };
}

export default async function PrivacyPolicyPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const content = getPrivacyPolicyContent(locale);

  return (
    <div className="min-h-screen py-10 px-4">
      <div className="max-w-3xl mx-auto">
        <PrivacyMarkdown content={content} />
      </div>
    </div>
  );
}
