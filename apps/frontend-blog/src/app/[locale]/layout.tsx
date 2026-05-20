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
import BottomNavigation from '@/components/BottomNavigationClient';
import { PageTransition } from '@/components/PageTransition';
import I18nProvider from '@/lib/providers/I18nProvider';
import { LOCALES } from '@/lib/i18n/config';
import { HomePageStateProvider } from '@/lib/providers/HomePageStateProvider';
import PwaComponents from '@/components/pwa/PwaComponents';
import { ToastContainer } from '@/lib/components/ToastContainer';
import '../globals.css';

const locales = LOCALES;

// 元数据放在语言层布局，支持多语言SEO标题
// 使用 generateMetadata 函数以获取 locale 参数，生成语言感知的 canonical URL
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const baseUrl =
    process.env.NEXT_PUBLIC_SITE_URL || 'https://blog.joyminis.com';

  return {
    metadataBase: new URL(baseUrl),
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
      url: `${baseUrl}/${locale}`,
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
      canonical: `${baseUrl}/${locale}`,
      languages: {
        en: `${baseUrl}/en`,
        zh: `${baseUrl}/zh`,
        ja: `${baseUrl}/ja`,
        ko: `${baseUrl}/ko`,
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
}

// P2-3 修复：layout revalidate 与 page.tsx 错开，避免同时到期触发 ISR 风暴
// page.tsx=60s, layout=120s, categories=180s, tags=240s, about=600s
export const revalidate = 120;

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
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

  // 静态导入所有语言的消息文件，webpack 会内联为 JS 对象
  // Cloudflare Workers 中动态 import() 会增加异步开销，静态导入更高效
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
          <HomePageStateProvider>
            <PageTransition>{children}</PageTransition>
          </HomePageStateProvider>
        </main>
        <BottomNavigation />

        {/* PWA功能组件 — 仅在客户端加载，SSR 时跳过以减少 CPU 时间 */}
        <PwaComponents
          installPromptDelay={5000}
          installPromptAutoHideDelay={15000}
          offlineIndicatorPosition="top"
          offlineIndicatorShowRetryButton={true}
          offlineIndicatorAutoHideDelay={3000}
          updateAvailableCheckInterval={3600000}
          updateAvailableShowCloseButton={true}
          updateAvailableAutoShowDelay={5000}
        />
        <ToastContainer />
      </I18nProvider>
    </NextIntlClientProvider>
  );
}
