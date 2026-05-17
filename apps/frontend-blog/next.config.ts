import type { NextConfig } from 'next';
import path from 'path';
import BundleAnalyzer from '@next/bundle-analyzer';
import { withSentryConfig } from '@sentry/nextjs';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./i18n.config.ts');

const withBundleAnalyzer = BundleAnalyzer({
  enabled: process.env.ANALYZE === 'true',
  openAnalyzer: false,
});

// PWA配置 - 仅 production 部署启用，开发环境和 preview 部署禁用
// 开发环境（Docker/本地）：NODE_ENV=development
// preview 部署（test分支→blog-dev.joyminis.com）：NEXT_PUBLIC_APP_ENV=preview
// eslint-disable-next-line @typescript-eslint/no-var-requires
const withPWA = require('next-pwa')({
  dest: 'public',
  disable:
    process.env.NODE_ENV === 'development' ||
    process.env.NEXT_PUBLIC_APP_ENV === 'preview',
  register: true,
  skipWaiting: true,
  // P0-2 修复：SW 更新激活时自动清除旧版本缓存
  // 原因：skipWaiting:true 让新 SW 立即接管，但旧 chunk 仍在缓存中
  // 若不清除，新主 bundle 引用旧 chunk 的 module ID → e[n].call TypeError
  cleanupOutdatedCaches: true,
  // 排除 Source Map、react-loadable-manifest 以及所有 server-only 文件，避免 Workbox 预缓存时 404
  exclude: [/\.map$/, /react-loadable-manifest\.json$/, /\/_next\/server\/.*/],
  // 离线导航回退：当网络不可用且缓存中无页面时，显示自定义离线页面
  fallbacks: {
    document: '/offline.html',
  },
  runtimeCaching: [
    {
      urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/i,
      handler: 'CacheFirst',
      options: {
        cacheName: 'google-fonts',
        expiration: {
          maxEntries: 4,
          maxAgeSeconds: 365 * 24 * 60 * 60, // 1年
        },
      },
    },
    {
      urlPattern: /\.(?:eot|otf|ttc|ttf|woff|woff2|font.css)$/i,
      handler: 'StaleWhileRevalidate',
      options: {
        cacheName: 'static-font-assets',
        expiration: {
          maxEntries: 4,
          maxAgeSeconds: 7 * 24 * 60 * 60, // 7天
        },
      },
    },
    {
      urlPattern: /\.(?:jpg|jpeg|gif|png|svg|ico|webp|avif)$/i,
      handler: 'StaleWhileRevalidate',
      options: {
        cacheName: 'static-image-assets',
        expiration: {
          maxEntries: 200,
          maxAgeSeconds: 30 * 24 * 60 * 60, // 30天
        },
        cacheableResponse: {
          statuses: [0, 200],
        },
      },
    },
    // P0-2 修复：Next.js 静态 chunk 使用 CacheFirst 替代 StaleWhileRevalidate
    // 原因：_next/static/ 文件名含 content hash，天然 immutable
    //   StaleWhileRevalidate 会在 SW 更新后混用新旧 chunk → e[n].call TypeError
    //   CacheFirst 配合 cleanupOutdatedCaches 确保同一版本内命中缓存，
    //   SW 更新时旧缓存被清除，下次请求拿到正确的新版本 chunk
    // maxEntries 从 32 提升到 200：Next.js 单页面可产生 15-30 个 chunk，32 远不够
    {
      urlPattern: ({ url }: { url: URL }) =>
        url.pathname.startsWith('/_next/static/'),
      handler: 'CacheFirst',
      options: {
        cacheName: 'next-static-assets',
        expiration: {
          maxEntries: 200,
          maxAgeSeconds: 365 * 24 * 60 * 60, // 1年（hash 变则文件名变，安全）
        },
      },
    },
    {
      urlPattern: /^https?:\/\/api\.joyminis\.com\/.*/i,
      handler: 'StaleWhileRevalidate',
      options: {
        cacheName: 'api-cache',
        expiration: {
          maxEntries: 50,
          maxAgeSeconds: 7 * 24 * 60 * 60, // 7天（支持离线）
        },
        cacheableResponse: {
          statuses: [0, 200],
        },
      },
    },
    // Navigation pages (locale-prefixed) — NetworkFirst for offline support
    {
      urlPattern: /^\/(zh|en|ko|ja|fr|de)\//,
      handler: 'NetworkFirst',
      options: {
        cacheName: 'navigation-pages',
        expiration: {
          maxEntries: 50,
          maxAgeSeconds: 7 * 24 * 60 * 60, // 7天
        },
        networkTimeoutSeconds: 5,
      },
    },
    // 注意：已删除过宽泛的 pages-cache StaleWhileRevalidate 规则
    // 原因：/^https?:\/\/.*\.(joyminis\.com|localhost).*$/ 会匹配所有域名响应
    //       与 navigation-pages 的 NetworkFirst 冲突，策略优先级不明确
  ],
});

const isAppMode = process.env.BUILD_TARGET === 'app';

// 基础通用配置
const baseConfig: NextConfig = {
  // 生产环境禁用所有 console.* 日志（同时作用于客户端和服务端）
  compiler: {
    removeConsole: process.env.NODE_ENV === 'production',
  },

  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  trailingSlash: true,

  // 生产环境禁用 Source Map，避免源码泄露并减小构建体积
  productionBrowserSourceMaps: false,

  // 平台感知的输出配置
  // App构建使用静态导出，支持Capacitor打包
  // Web构建使用独立部署，支持ISR/SSG
  output: isAppMode ? 'export' : 'standalone',

  images: {
    // 使用自定义 Cloudflare Image Resizing loader
    // Cloudflare Workers 没有 Node.js sharp 原生模块，/_next/image 无法压缩
    // 改为 /cdn-cgi/image/，由 Cloudflare 边缘节点处理图片变换
    // 注意：unoptimized: true 会禁用自定义 loader，所以不能设置
    loader: 'custom',
    loaderFile: './src/lib/utils/cloudflareImageLoader.ts',
    remotePatterns: [
      { protocol: 'https', hostname: 'img.joyminis.com' },
      { protocol: 'https', hostname: '*.googleusercontent.com' },
      { protocol: 'https', hostname: '*.facebook.com' },
      { protocol: 'https', hostname: '*.fbcdn.net' },
      { protocol: 'https', hostname: '*.cloudinary.com' },
      { protocol: 'https', hostname: '*.unsplash.com' },
      { protocol: 'https', hostname: '*.githubusercontent.com' },
      { protocol: 'https', hostname: 'placehold.co' },
    ],
    // Cloudflare /cdn-cgi/image/ 自动处理 AVIF/WebP 格式转换（f=auto）
    // 限制生成的图片尺寸，避免为卡片视图（~600px）生成 3840w 的巨图
    // 默认值 [640, 750, 828, 1080, 1200, 1920, 2048, 3840] 会导致单张图片 1.8-2.2MB
    deviceSizes: [480, 640, 768, 1024, 1280],
    // 明确的小图尺寸，用于 blurhash 等场景
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
    minimumCacheTTL: 86400,
  },

  // 基础重定向配置
  redirects: async () => {
    return [
      {
        source: '/admin',
        destination: '/admin/dashboard',
        permanent: true,
      },
      {
        source: '/login',
        destination: '/auth/login',
        permanent: true,
      },
      {
        source: '/register',
        destination: '/auth/register',
        permanent: true,
      },
    ];
  },

  // 基础重写配置 — 解决 RN 分享 URL (/article/:slug) 与 Next.js 路由 (/:locale/articles/:slug) 不匹配
  rewrites: async () => {
    return [
      {
        source: '/article/:slug',
        destination: '/en/articles/:slug',
      },
    ];
  },

  // 安全头配置
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'X-DNS-Prefetch-Control',
            value: 'on',
          },
          {
            key: 'Link',
            value:
              '<https://img.joyminis.com>; rel=preconnect; crossOrigin=anonymous',
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'X-XSS-Protection',
            value: '1; mode=block',
          },
          {
            key: 'Referrer-Policy',
            value: 'origin-when-cross-origin',
          },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
          },
          {
            key: 'Cache-Control',
            value: 'public, max-age=3600, stale-while-revalidate=86400',
          },
        ],
      },
      {
        source: '/_next/static/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
      {
        source: '/fonts/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
    ];
  },

  transpilePackages: [],

  outputFileTracingExcludes: {
    '*': [
      './node_modules/webpack/**',
      './node_modules/webpack-sources/**',
      './node_modules/terser-webpack-plugin/**',
      './node_modules/uglify-js/**',
      './node_modules/acorn/**',
      './node_modules/acorn-import-phases/**',
      './node_modules/loader-runner/**',
      './node_modules/neo-async/**',
      './node_modules/tapable/**',
      './node_modules/watchpack/**',
      './node_modules/@webassemblyjs/**',
      './node_modules/@xtuc/**',
      './node_modules/@jridgewell/**',
      './node_modules/chrome-trace-event/**',
      './node_modules/esbuild/**',
      './node_modules/@esbuild/**',
      './node_modules/electron-to-chromium/**',
      './node_modules/browserslist/**',
      './node_modules/baseline-browser-mapping/**',
      './node_modules/node-releases/**',
    ],
  },

  experimental: {
    optimizePackageImports: [
      '@repo/ui',
      'lucide-react',
      'lodash',
      'date-fns',
      'framer-motion',
      'react-markdown',
      'react-syntax-highlighter',
      'rehype-raw',
      'remark-gfm',
      'embla-carousel-react',
      'hls.js',
    ],
  },

  // Webpack配置
  webpack: (config, { isServer, webpack }) => {
    // 处理Node.js原生模块
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        crypto: false,
        stream: false,
        buffer: false,
      };

      config.plugins.push(
        new webpack.NormalModuleReplacementPlugin(
          /^node:crypto$/,
          (resource: { request: string }) => {
            resource.request = path.resolve(
              __dirname,
              './src/lib/crypto-shim.ts',
            );
          },
        ),
      );
    }

    if (!isServer) {
      const minimizer = config.optimization?.minimizer?.map((plugin: any) => {
        if (plugin.constructor.name === 'TerserPlugin') {
          return new (plugin.constructor as typeof plugin.constructor)({
            ...plugin.options,
            terserOptions: {
              ...plugin.options?.terserOptions,
              compress: {
                ...plugin.options?.terserOptions?.compress,
                drop_debugger: true,
                drop_console: true,
                passes: 2,
                pure_getters: true,
                // P2-4 修复：移除 unsafe_* 标志
                // 原因：unsafe/unsafe_math/unsafe_methods/booleans_as_integers
                //       在 iOS WKWebView 特定 JS 引擎上可能引发隐性 runtime bug
                //       与 e[n].call 错误存在叠加关系，收益远低于风险
                hoist_funs: true,
                hoist_props: true,
                reduce_vars: true,
                toplevel: true,
              },
            },
          });
        }
        return plugin;
      });
      config.optimization = {
        ...config.optimization,
        minimize: true,
        minimizer,
      };
    }

    return config;
  },
};

// Web模式特有配置
const webConfig: NextConfig = {
  ...baseConfig,
  // Web模式特有重定向
  redirects: async () => {
    const baseRedirects = await baseConfig.redirects?.();
    return [
      ...(baseRedirects || []),
      {
        source: '/app',
        destination: '/',
        permanent: false,
      },
    ];
  },
};

// App模式特有配置
const appConfig: NextConfig = {
  ...baseConfig,
  // App模式需要trailingSlash
  trailingSlash: true,

  // App模式特有重定向
  redirects: async () => {
    const baseRedirects = await baseConfig.redirects?.();
    return [
      ...(baseRedirects || []),
      {
        source: '/api/:path*',
        destination: 'https://api.joyminis.com/:path*',
        permanent: false,
      },
    ];
  },

  // App模式下的headers配置
  headers: async () => {
    const baseHeaders = await baseConfig.headers?.();
    return [
      ...(baseHeaders || []),
      {
        source: '/:path*',
        headers: [
          {
            key: 'X-App-Mode',
            value: 'hybrid',
          },
        ],
      },
    ];
  },

  // App模式下跳过页面验证
  skipTrailingSlashRedirect: true,
  skipMiddlewareUrlNormalize: true,
};

// 根据环境变量动态选择配置
const dynamicConfig = isAppMode ? appConfig : webConfig;

const wrappedConfig = withBundleAnalyzer(withPWA(withNextIntl(dynamicConfig)));

// 只在 production 构建时启用 Sentry 插件，避免开发/CI 时加载 Sentry 依赖
// Sentry 初始化逻辑在 instrumentation.ts 和 instrumentation-client.ts 中处理
// 当 SENTRY_ORG 未设置时跳过插件，避免 build 因缺少配置而失败
export default process.env.NODE_ENV === 'production' && process.env.SENTRY_ORG
  ? withSentryConfig(wrappedConfig, {
      org: process.env.SENTRY_ORG,
      project: 'tarsier-labs',
      silent: !process.env.CI,
      sourcemaps: {
        disable: !process.env.SENTRY_AUTH_TOKEN,
      },
      tunnelRoute: undefined,
    })
  : wrappedConfig;
