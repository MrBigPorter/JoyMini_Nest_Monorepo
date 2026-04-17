import { Inter } from 'next/font/google';
import { ThemeProvider } from 'next-themes';
import './globals.css'; // 确保全局样式在这里加载

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
        {/* 关键：脚本必须在 head 中，且逻辑要极简 */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  var t = localStorage.getItem('theme');
                  var s = window.matchMedia('(prefers-color-scheme: dark)').matches;
                  var dark = t === 'dark' || (t !== 'light' && s);
                  document.documentElement.classList.toggle('dark', dark);
                } catch (e) {}
              })();
            `,
          }}
        />
      </head>
      <body className="antialiased bg-background text-foreground">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
