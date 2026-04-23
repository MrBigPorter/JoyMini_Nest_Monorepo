import type { Metadata, Viewport } from 'next';
import './globals.css';
// Quill rich-text editor styles (used in product create/edit forms)
import 'react-quill-new/dist/quill.snow.css';

export const metadata: Metadata = {
  metadataBase: new URL('https://admin.joyminis.com'),
  title: {
    template: '%s | JoyMini Admin',
    default: 'JoyMini Admin',
  },
  description:
    'JoyMini internal admin dashboard — manage products, orders, users and more.',
  keywords: ['JoyMini', 'admin', 'dashboard', 'e-commerce', 'management'],
  authors: [{ name: 'JoyMini', url: 'https://admin.joyminis.com' }],
  creator: 'JoyMini',
  robots: { index: true, follow: true },
  openGraph: {
    title: 'JoyMini Admin',
    description:
      'JoyMini Admin Dashboard — manage products, orders, users and more.',
    url: 'https://admin.joyminis.com',
    siteName: 'JoyMini Admin',
    locale: 'en_US',
    type: 'website',
    images: [
      {
        url: '/og-image.png',
        width: 1200,
        height: 630,
        alt: 'JoyMini Admin Dashboard',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'JoyMini Admin',
    description:
      'JoyMini Admin Dashboard — manage products, orders, users and more.',
    images: ['/og-image.png'],
  },
  icons: {
    icon: '/icon.svg',
    apple: '/apple-icon.png',
    shortcut: '/icon.svg',
  },
};

// Next.js 15: viewport 必须单独导出，不能放在 metadata 里
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // 移动端浏览器顶栏颜色：亮色用白，暗色用 dark-900
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#11111b' },
  ],
};

import { Providers } from '@/components/Providers';
import { cookies } from 'next/headers';
import { DEFAULT_LOCALE, AVAILABLE_LOCALES, type Locale } from '@lucky/shared';
import { getTranslations } from '@/i18n';

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Determine server-side locale: prefer cookie 'app_locale', fall back to DEFAULT_LOCALE
  let lang: Locale = DEFAULT_LOCALE;
  try {
    const cookieStore = await cookies();
    const c = cookieStore.get('app_locale')?.value;
    if (c && AVAILABLE_LOCALES.includes(c as Locale)) {
      lang = c as Locale;
    }
  } catch {
    // ignore and use default
  }

  // load translations for this request on the server and inject to client
  let initialTranslations;
  try {
    initialTranslations = getTranslations(lang);
  } catch {
    initialTranslations = undefined;
  }

  return (
    <html lang={lang} suppressHydrationWarning>
      <head>
        <meta
          name="build-time"
          content={process.env.NEXT_PUBLIC_DEPLOYED_AT ?? ''}
        />
        <meta name="git-sha" content={process.env.NEXT_PUBLIC_GIT_SHA ?? ''} />
        {/*
          内联脚本：在 React hydrate 之前同步读 localStorage 中的 theme，
          立即设置 <html> class，避免白色闪屏（FOUC）。
          key: 与 useAppStore persist 的 name='app-store' 保持一致。
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var s=JSON.parse(localStorage.getItem('app-store')||'{}');var t=(s.state&&s.state.theme)||'dark';document.documentElement.classList.add(t);}catch(e){document.documentElement.classList.add('dark');}})();`,
          }}
        />
      </head>
      <body>
        {/* pass initialLocale and initialTranslations so client provider initializes to the same locale/translations as server */}
        <Providers
          initialLocale={lang}
          initialTranslations={initialTranslations}
        >
          {children}
        </Providers>
      </body>
    </html>
  );
}
