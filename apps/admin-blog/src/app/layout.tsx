import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://admin-blog.joyminis.com"),
  title: {
    template: "%s | JoyMini Blog Admin",
    default: "JoyMini Blog Admin",
  },
  description:
    "JoyMini Blog Admin — manage blog articles, categories, tags and comments.",
  keywords: ["JoyMini", "blog", "admin", "dashboard", "management"],
  authors: [{ name: "JoyMini", url: "https://admin-blog.joyminis.com" }],
  creator: "JoyMini",
  robots: { index: true, follow: true },
  openGraph: {
    title: "JoyMini Blog Admin",
    description:
      "JoyMini Blog Admin Dashboard — manage blog articles, categories, tags and comments.",
    url: "https://admin-blog.joyminis.com",
    siteName: "JoyMini Blog Admin",
    locale: "en_US",
    type: "website",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "JoyMini Blog Admin Dashboard",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "JoyMini Blog Admin",
    description:
      "JoyMini Blog Admin Dashboard — manage blog articles, categories, tags and comments.",
    images: ["/og-image.png"],
  },
  icons: {
    icon: "/logo.png",
    apple: "/logo.png",
    shortcut: "/logo.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#11111b" },
  ],
};

import { Providers } from "@/components/Providers";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const locale = await getLocale();
  const messages = await getMessages();

  return (
    <html lang={locale} suppressHydrationWarning>
      <head>
        <meta
          name="build-time"
          content={process.env.NEXT_PUBLIC_DEPLOYED_AT ?? ""}
        />
        <meta name="git-sha" content={process.env.NEXT_PUBLIC_GIT_SHA ?? ""} />
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var s=JSON.parse(localStorage.getItem('app-store')||'{}');var t=(s.state&&s.state.theme)||'dark';document.documentElement.classList.add(t);}catch(e){document.documentElement.classList.add('dark');}})();`,
          }}
        />
      </head>
      <body>
        <NextIntlClientProvider locale={locale} messages={messages}>
          <Providers>{children}</Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
