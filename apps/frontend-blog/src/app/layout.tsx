import { Inter } from 'next/font/google';
import { Providers } from '@/components/Providers';
import { CloudflareInsights } from '@/components/CloudflareInsights';
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
        {/* CDN preconnect — 提前建立连接，减少 Cloudflare 冷启动时的 DNS + TLS 延迟 */}
        <link
          rel="preconnect"
          href="https://img.joyminis.com"
          crossOrigin="anonymous"
        />
        <link rel="dns-prefetch" href="https://img.joyminis.com" />

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

        {/* 禁用浏览器原生滚动恢复 — 刷新页面回到顶部 */}
        {/* 我们的自定义后退导航滚动恢复（sessionStorage + window.scrollTo）不受影响 */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  if ('scrollRestoration' in history) {
                    history.scrollRestoration = 'manual';
                  }
                } catch(e) {}
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

        {/* Cloudflare Web Analytics — lazy-loaded after page becomes interactive */}
        <CloudflareInsights />
      </body>
    </html>
  );
}
