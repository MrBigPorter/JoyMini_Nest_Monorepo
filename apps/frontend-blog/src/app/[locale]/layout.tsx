import type { Metadata, Viewport } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';
import zhMessages from '@/messages/zh.json';
import enMessages from '@/messages/en.json';
import jaMessages from '@/messages/ja.json';
import koMessages from '@/messages/ko.json';
import frMessages from '@/messages/fr.json';
import deMessages from '@/messages/de.json';
import { notFound } from 'next/navigation';
import Header from '@/components/Header';
import Sidebar from '@/components/navigation/Sidebar';
import BottomNavigation from '@/components/BottomNavigation';
import { PageTransition } from '@/components/PageTransition';
import I18nProvider from '@/lib/providers/I18nProvider';
import { LOCALES } from '@/lib/i18n/config';
import { InstallPrompt } from '@/components/pwa/InstallPrompt';
import { OfflineIndicator } from '@/components/pwa/OfflineIndicator';
import { UpdateAvailable } from '@/components/pwa/UpdateAvailable';
import '../globals.css';

const locales = LOCALES;

//  元数据放在语言层布局，支持多语言SEO标题
export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL || 'https://blog.joyminis.com',
  ),
  title: {
    template: '%s | Tarsier Labs',
    default: 'Tarsier Labs - Tech innovation lab from Bohol, Philippines',
  },
  description:
    'Tech innovation lab from Bohol, Philippines. Explore articles about software development, AI, and technology.',
  keywords: [
    'technology',
    'software development',
    'AI',
    'Bohol',
    'Philippines',
    'blog',
    'tech innovation',
  ],

  // Open Graph
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: process.env.NEXT_PUBLIC_SITE_URL || 'https://blog.joyminis.com',
    siteName: 'Tarsier Labs',
    title: 'Tarsier Labs - Tech innovation lab',
    description: 'Tech innovation lab from Bohol, Philippines',
    images: [
      {
        url: '/og-image.png',
        width: 1200,
        height: 630,
        alt: 'Tarsier Labs',
      },
    ],
  },

  // Twitter
  twitter: {
    card: 'summary_large_image',
    site: '@tarsierlabs',
    creator: '@tarsierlabs',
    title: 'Tarsier Labs',
    description: 'Tech innovation lab from Bohol, Philippines',
    images: ['/twitter-image.png'],
  },

  // 语言alternate标记
  alternates: {
    canonical: process.env.NEXT_PUBLIC_SITE_URL || 'https://blog.joyminis.com',
    languages: {
      en: `${process.env.NEXT_PUBLIC_SITE_URL || 'https://blog.joyminis.com'}/en`,
      zh: `${process.env.NEXT_PUBLIC_SITE_URL || 'https://blog.joyminis.com'}/zh`,
      ja: `${process.env.NEXT_PUBLIC_SITE_URL || 'https://blog.joyminis.com'}/ja`,
      ko: `${process.env.NEXT_PUBLIC_SITE_URL || 'https://blog.joyminis.com'}/ko`,
    },
  },

  // 其他meta标签
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },

  // 验证标记
  verification: {
    google: process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION,
  },

  // 图标配置
  icons: {
    icon: [
      { url: '/favicon.ico', type: 'image/x-icon' },
      { url: '/icons/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
      { url: '/icons/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
      { url: '/icons/icon-192x192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512x512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [
      {
        url: '/icons/apple-touch-icon.png',
        sizes: '180x180',
        type: 'image/png',
      },
      {
        url: '/icons/apple-touch-icon-152x152.png',
        sizes: '152x152',
        type: 'image/png',
      },
      {
        url: '/icons/apple-touch-icon-167x167.png',
        sizes: '167x167',
        type: 'image/png',
      },
      {
        url: '/icons/apple-touch-icon-120x120.png',
        sizes: '120x120',
        type: 'image/png',
      },
    ],
  },
};

export const revalidate = 60; // ISR 60秒重新验证

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0a0a0a' },
  ],
};

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale: routeLocale } = await params;

  // 关键修复：与page.tsx保持一致，直接使用URL路径中的语言
  // 访问 /en/ 时，routeLocale = 'en'
  // 这确保SSR和CSR使用相同的语言，避免闪烁
  const locale = routeLocale;

  if (!locales.includes(locale as (typeof locales)[number])) {
    notFound();
  }

  // 启用静态渲染
  setRequestLocale(locale);

  //  使用静态 import 替代 readFileSync，确保 JSON 文件被打包进 Cloudflare Worker
  const allMessages: Record<string, any> = {
    zh: zhMessages,
    en: enMessages,
    ja: jaMessages,
    ko: koMessages,
    fr: frMessages,
    de: deMessages,
  };
  const messages = allMessages[locale] || allMessages['zh'];

  return (
    <NextIntlClientProvider key={locale} locale={locale} messages={messages}>
      <I18nProvider>
        <Header />
        <Sidebar />
        <main className="pt-0 lg:pt-[var(--content-padding-top)] pb-[var(--content-padding-bottom)] min-h-[100dvh] md:ml-16 md:transition-all md:duration-300">
          <PageTransition>{children}</PageTransition>
        </main>
        <BottomNavigation />

        {/* PWA功能组件 */}
        <InstallPrompt delay={5000} autoHideDelay={15000} />
        <OfflineIndicator
          position="top"
          showRetryButton={true}
          autoHideDelay={3000}
        />
        <UpdateAvailable
          checkInterval={3600000}
          showCloseButton={true}
          autoShowDelay={5000}
        />
      </I18nProvider>
    </NextIntlClientProvider>
  );
}
