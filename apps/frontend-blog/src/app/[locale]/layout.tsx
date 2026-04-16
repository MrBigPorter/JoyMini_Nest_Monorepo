import type { Metadata, Viewport } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { ThemeProvider } from 'next-themes';
import { notFound } from 'next/navigation';
import { Inter } from 'next/font/google';
import Header from '@/components/Header';
import Sidebar from '@/components/navigation/Sidebar';
import BottomNavigation from '@/components/BottomNavigation';
import QueryProvider from '@/lib/providers/QueryProvider';
import I18nProvider from '@/lib/providers/I18nProvider';
import { GoogleOAuthProvider } from '@/lib/components/GoogleOAuthProvider';
import { LOCALES } from '@/lib/i18n/config';
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
  const { locale } = await params;

  if (!locales.includes(locale as (typeof locales)[number])) {
    notFound();
  }

  //  官方临时修复方案：在语言层布局内直接读取messages
  // 绕过 getRequestConfig BUG，该BUG会导致locale参数丢失
  const messagesPath = resolve(process.cwd(), `src/messages/${locale}.json`);
  const messages = JSON.parse(readFileSync(messagesPath, 'utf8'));

  return (
    <html lang={locale} className={inter.variable} suppressHydrationWarning>
      <head>
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta
          name="apple-mobile-web-app-status-bar-style"
          content="black-translucent"
        />
        <meta name="mobile-web-app-capable" content="yes" />
      </head>
      <body className="antialiased">
        <NextIntlClientProvider
          key={locale}
          locale={locale}
          messages={messages}
        >
          <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
            <QueryProvider>
              <I18nProvider>
                <GoogleOAuthProvider>
                  <Header />
                  <Sidebar />
                  <main className="pt-[var(--content-padding-top)] pb-[var(--content-padding-bottom)] min-h-screen md:ml-16 md:transition-all md:duration-300">
                    {children}
                  </main>
                  <BottomNavigation />
                </GoogleOAuthProvider>
              </I18nProvider>
            </QueryProvider>
          </ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
