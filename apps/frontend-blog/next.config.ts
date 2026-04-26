import type { NextConfig } from 'next';
import path from 'path';
import BundleAnalyzer from '@next/bundle-analyzer';
import { withSentryConfig } from '@sentry/nextjs';
import createNextIntlPlugin from 'next-intl/plugin';
import CompressionWebpackPlugin from 'compression-webpack-plugin';

const withNextIntl = createNextIntlPlugin('./i18n.config.ts');

const withBundleAnalyzer = BundleAnalyzer({
  enabled: process.env.ANALYZE === 'true',
  openAnalyzer: false,
});

// PWA配置 - 开发环境禁用，避免缓存干扰
// eslint-disable-next-line @typescript-eslint/no-var-requires
const withPWA = require('next-pwa')({
  dest: 'public',
  disable: process.env.NODE_ENV === 'development',
  register: true,
  skipWaiting: true,
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
      urlPattern: /\.(?:jpg|jpeg|gif|png|svg|ico|webp)$/i,
      handler: 'CacheFirst',
      options: {
        cacheName: 'static-image-assets',
        expiration: {
          maxEntries: 64,
          maxAgeSeconds: 30 * 24 * 60 * 60, // 30天
        },
      },
    },
    {
      urlPattern: /\.(?:js|css|mjs)$/i,
      handler: 'StaleWhileRevalidate',
      options: {
        cacheName: 'static-js-css-assets',
        expiration: {
          maxEntries: 32,
          maxAgeSeconds: 24 * 60 * 60, // 24小时
        },
      },
    },
    {
      urlPattern: /^https?:\/\/api\.joyminis\.com\/.*/i,
      handler: 'NetworkFirst',
      options: {
        cacheName: 'api-cache',
        networkTimeoutSeconds: 10,
        expiration: {
          maxEntries: 16,
          maxAgeSeconds: 5 * 60, // 5分钟
        },
        cacheableResponse: {
          statuses: [0, 200],
        },
      },
    },
    {
      urlPattern: /^https?:\/\/.*\.(joyminis\.com|localhost).*$/i,
      handler: 'NetworkFirst',
      options: {
        cacheName: 'pages-cache',
        networkTimeoutSeconds: 10,
        expiration: {
          maxEntries: 32,
          maxAgeSeconds: 24 * 60 * 60, // 24小时
        },
        cacheableResponse: {
          statuses: [0, 200],
        },
      },
    },
  ],
});

const isAppMode = process.env.BUILD_TARGET === 'app';

// 基础通用配置
const baseConfig: NextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  trailingSlash: true,

  // 平台感知的输出配置
  // App构建使用静态导出，支持Capacitor打包
  // Web构建使用独立部署，支持ISR/SSG
  output: isAppMode ? 'export' : 'standalone',

  images: {
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
    // App模式下禁用图片优化
    unoptimized: isAppMode,
    // 现代图片格式自动转换
    formats: ['image/avif', 'image/webp'],
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

  transpilePackages: ['@lucky/shared'],

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
                pure_funcs: [
                  'console.log',
                  'console.info',
                  'console.debug',
                  'console.trace',
                ],
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

    if (!isServer) {
      config.plugins.push(
        new CompressionWebpackPlugin({
          filename: '[path][base].br',
          algorithm: 'brotliCompress',
          test: /\.(js|css|html|svg)$/,
          compressionOptions: {
            level: 11,
          },
          threshold: 10240,
          minRatio: 0.8,
        }),
      );
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

export default withSentryConfig(
  withBundleAnalyzer(withPWA(withNextIntl(dynamicConfig))),
  {
    org: process.env.SENTRY_ORG,
    project: 'tarsier-labs',
    silent: !process.env.CI,
    sourcemaps: {
      disable: !process.env.SENTRY_AUTH_TOKEN,
    },
    tunnelRoute: undefined,
  },
);
