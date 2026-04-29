import { Inter } from 'next/font/google';
import { Providers } from '@/components/Providers';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
});

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <head>
        {/* PWA manifest - 告诉浏览器这是一个 PWA 应用 */}
        <link rel="manifest" href="/manifest.json" />

        {/* Service Worker 注册 - next-pwa 的 register: true 在 App Router 下不生效，需要手动注册 */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                if ('serviceWorker' in navigator) {
                  window.addEventListener('load', function() {
                    navigator.serviceWorker.register('/sw.js').then(function(reg) {
                      console.log('[PWA] SW registered:', reg.scope);
                    }).catch(function(err) {
                      console.warn('[PWA] SW registration failed:', err);
                    });
                  });
                }
              })();
            `,
          }}
        />

        {/* 简化主题脚本（借鉴 admin-next） */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  var saved = localStorage.getItem('theme');
                  var systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
                  var theme = saved || 'dark';
                  document.documentElement.classList.add(theme);
                } catch(e) {
                  document.documentElement.classList.add('light');
                }
              })();
            `,
          }}
        />
      </head>
      <body className="antialiased bg-background text-foreground">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
