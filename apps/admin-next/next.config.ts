import type { NextConfig } from 'next';
import path from 'path';
import BundleAnalyzer from '@next/bundle-analyzer';
import { withSentryConfig } from '@sentry/nextjs';

const withBundleAnalyzer = BundleAnalyzer({
  enabled: process.env.ANALYZE === 'true',
  openAnalyzer: false,
});

// admin-next is deployed exclusively to Cloudflare Workers via @opennextjs/cloudflare.
// No standalone/Docker output needed.
const nextConfig: NextConfig = {
  // Skip type errors caused by @types/react version mismatch across monorepo packages
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  trailingSlash: true,
  // 启用 Next.js 图片优化：remotePatterns 白名单 + 允许任意 https 域（admin 内部工具，信任场景）
  // img.joyminis.com: 主 CDN；https://** 覆盖 OAuth 头像（Google/Facebook）等未知来源
  // 注意：SmartImage 用 @unpic/react 自行处理 CDN，不受此配置影响；
  //       此配置仅作用于代码中直接使用 next/image 的少数场景（如 GroupManagementClient 用户头像）
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'img.joyminis.com' },
      { protocol: 'https', hostname: '**' }, // admin panel — 信任所有 https 图片来源
    ],
  },
  // @lucky/shared: lightweight utils (dayjs/decimal/numbro), no heavy deps.
  // Keep in transpilePackages so Turbopack handles it natively (avoids CJS interop).
  // dist/ is pre-built before dev server starts (compose.yml + CI) for reliability.
  // @repo/ui: pre-built to dist/ — removed from transpilePackages (had framer-motion,
  //   react-quill-new pulling 1186s cold compile; now 10s with optimizePackageImports).
  transpilePackages: ['@lucky/shared'],

  // 允许通过 nginx 反向代理的开发域名访问 /_next/* 资源
  allowedDevOrigins: ['admin-dev.joyminis.com'],

  // ── Turbopack 开发模式：仅处理 node:crypto shim ──
  turbopack: {
    resolveAlias: {
      'node:crypto': './src/lib/crypto-shim.ts',
    },
  },

  // Exclude build tools that bleed in via monorepo hoisting (e.g. @nestjs/cli → webpack).
  // These packages are only needed in apps/api — never at admin-next runtime.
  // Without this, Next.js file tracing picks up webpack + full toolchain (~4 MiB).
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
    // Tree-shake heavy barrel-export packages so Turbopack only compiles used exports
    // @repo/ui is pre-built ESM with individual files — optimizePackageImports
    // ensures only the imported components (e.g. `cn`) are compiled, not the full barrel
    optimizePackageImports: [
      '@repo/ui',
      'lucide-react',
      'recharts',
      'lodash',
      '@radix-ui/react-select',
      '@radix-ui/react-dropdown-menu',
      '@radix-ui/react-dialog',
      '@radix-ui/react-tabs',
      '@radix-ui/react-popover',
      '@radix-ui/react-tooltip',
      '@tanstack/react-table',
      'date-fns',
      'framer-motion',
    ],
  },

  async redirects() {
    return [
      {
        source: '/login-log/:path*',
        destination: '/login-logs/:path*',
        permanent: true,
      },
    ];
  },

  webpack: (config, { isServer, webpack }) => {
    // Polyfill Node.js built-ins for browser bundles
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        crypto: false,
        stream: false,
        buffer: false,
      };
      // Replace node:crypto with empty module on client
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

    // Remove Sentry debug logging from production bundle
    // Replaces deprecated disableLogger option
    if (!isServer) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

export default withSentryConfig(withBundleAnalyzer(nextConfig), {
  /**
   * Sentry 构建时插件配置。
   * Sentry build-time plugin options.
   *
   * org / project: 填入你的 Sentry 组织和项目 slug（Source Map 上传时需要）。
   * 当 SENTRY_AUTH_TOKEN 未设置时，source map 上传会被自动跳过，不影响构建。
   *
   * org / project: fill in your Sentry org and project slugs (needed for source map upload).
   * When SENTRY_AUTH_TOKEN is absent, source map upload is silently skipped — build still succeeds.
   */
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,

  // 静默构建日志，避免 CI 日志污染
  // Suppress verbose build output to keep CI logs clean
  silent: !process.env.CI,

  // 仅在提供 auth token 时上传 source map（避免无 token 时构建报错）
  // Only upload source maps when auth token is available (no-op otherwise)
  sourcemaps: {
    disable: !process.env.SENTRY_AUTH_TOKEN,
  },

  // 关闭 Sentry 隧道路由（减少 Cloudflare Worker bundle + 路由复杂度）
  // Disable Sentry tunnel route (reduces Cloudflare Worker bundle size + routing complexity)
  tunnelRoute: undefined,

  // 关闭自动 tree-shaking 日志（已在 Sentry.init 的 enabled 字段控制）
  // disableLogger: true, // Deprecated, use webpack.treeshake.removeDebugLogging instead
});
