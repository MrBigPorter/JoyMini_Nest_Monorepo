import type { NextConfig } from 'next';
import path from 'path';
import BundleAnalyzer from '@next/bundle-analyzer';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const withBundleAnalyzer = BundleAnalyzer({
  enabled: process.env.ANALYZE === 'true',
  openAnalyzer: false,
});

// When DOCKER_BUILD=true (set in Dockerfile), output standalone for ECS deployment.
// Cloudflare Workers build (default) remains unaffected.
const nextConfig: NextConfig = {
  output: process.env.DOCKER_BUILD === 'true' ? 'standalone' : undefined,

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
    // 允许 SVG 图片（dicebear.com 头像等）
    dangerouslyAllowSVG: true,
    remotePatterns: [
      { protocol: 'https', hostname: 'img.joyminis.com' },
      { protocol: 'https', hostname: '**' }, // admin panel — 信任所有 https 图片来源
    ],
  },
  // @lucky/shared: pre-built to dist/ (CJS). Next.js 15 + Turbopack resolves
  //   via package.json exports natively — no need for transpilePackages.
  //   If you need live TS editing during dev, run `yarn workspace @lucky/shared dev`
  //   (tsc watch) in a separate terminal.
  // @repo/ui: pre-built to dist/ — removed from transpilePackages (had framer-motion,
  //   react-quill-new pulling 1186s cold compile; now 10s with optimizePackageImports).

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

    // Remove debug logging from production bundle
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
                  'console.warn',
                  'console.error',
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

const config = withBundleAnalyzer(withNextIntl(nextConfig));

export default config;
