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

const nextConfig: NextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  trailingSlash: true,

  // 平台感知的输出配置
  // App构建使用静态导出，自动忽略ISR配置
  // Web构建使用独立部署，支持ISR/SSG
  output: process.env.BUILD_TARGET === 'app' ? 'export' : 'standalone',

  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'img.joyminis.com' },
      { protocol: 'https', hostname: '*.googleusercontent.com' },
      { protocol: 'https', hostname: '*.facebook.com' },
      { protocol: 'https', hostname: 'picsum.photos' },
      { protocol: 'https', hostname: '*.picsum.photos' },
    ],
  },

  transpilePackages: ['@lucky/shared'],

  // 注意：allowedDevOrigins 在 Next.js 15 中已不再支持
  // 如果需要开发源控制，请使用其他方式
  // 注意：turbopack 配置在 Next.js 15 中已不再支持
  // 如果需要自定义别名，请使用 webpack 配置

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

  webpack: (config, { isServer, webpack }) => {
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

    return config;
  },
};

export default withSentryConfig(withBundleAnalyzer(withNextIntl(nextConfig)), {
  org: process.env.SENTRY_ORG,
  project: 'frontend-blog',
  silent: !process.env.CI,
  sourcemaps: {
    disable: !process.env.SENTRY_AUTH_TOKEN,
  },
  tunnelRoute: undefined,
});
