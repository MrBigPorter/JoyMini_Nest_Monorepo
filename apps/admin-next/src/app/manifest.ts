import type { MetadataRoute } from 'next';

/**
 * Web App Manifest — 支持移动端「添加到主屏幕」
 * Next.js 自动在 <head> 注入 <link rel="manifest">
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'JoyMini Admin',
    short_name: 'JoyMini',
    description: 'JoyMini Admin Dashboard',
    start_url: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#11111b',
    theme_color: '#d68a29',
    icons: [
      {
        src: '/icon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
      },
      {
        src: '/apple-icon.png',
        sizes: '180x180',
        type: 'image/png',
      },
    ],
  };
}
