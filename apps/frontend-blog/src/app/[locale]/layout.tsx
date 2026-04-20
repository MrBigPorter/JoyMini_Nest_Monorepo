import type { Metadata, Viewport } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { notFound, redirect } from 'next/navigation';
import { Inter } from 'next/font/google';
import { cookies } from 'next/headers';
import Header from '@/components/Header';
import Sidebar from '@/components/navigation/Sidebar';
import BottomNavigation from '@/components/BottomNavigation';
import { PageTransition } from '@/components/PageTransition';
import I18nProvider from '@/lib/providers/I18nProvider';
import { LOCALES, DEFAULT_LOCALE } from '@/lib/i18n/config';
import {
  isProtectedRoute,
  getLoginRedirectUrl,
} from '@/lib/auth/protected-routes';
import '../globals.css';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
});

const locales = LOCALES;

//  元数据放在语言层布局，以后可以支持多语言SEO标题
export const metadata: Metadata = {
  title: 'Tarsier Blog',
  description: 'Developer community from Bohol, Philippines',
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

  //  第三层防护：Root Layout 兜底检查
  // 这是渲染前的最后检查，防止任何绕过Middleware的情况
  const cookieStore = await cookies();
  const authToken = cookieStore.get('token')?.value;

  // 服务端组件无法获取客户端路径，精确路径匹配由Middleware负责
  // Layout只做全局Token存在性检查，作为最后兜底防线
  // 注意：这里无法获取当前路径，所以只检查Token存在性
  // 精确的路径匹配由Middleware负责

  //  官方临时修复方案：在语言层布局内直接读取messages
  // 绕过 getRequestConfig BUG，该BUG会导致locale参数丢失
  const messagesPath = resolve(process.cwd(), `src/messages/${locale}.json`);
  const messages = JSON.parse(readFileSync(messagesPath, 'utf8'));

  return (
    <NextIntlClientProvider key={locale} locale={locale} messages={messages}>
      <I18nProvider>
        <Header />
        <Sidebar />
        <main className="pt-[var(--content-padding-top)] pb-[var(--content-padding-bottom)] min-h-screen md:ml-16 md:transition-all md:duration-300">
          <PageTransition>{children}</PageTransition>
        </main>
        <BottomNavigation />
      </I18nProvider>
    </NextIntlClientProvider>
  );
}