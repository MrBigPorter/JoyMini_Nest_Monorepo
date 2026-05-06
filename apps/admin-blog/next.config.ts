import type { NextConfig } from 'next';
import path from 'path';
import BundleAnalyzer from '@next/bundle-analyzer';
import { withSentryConfig } from '@sentry/nextjs';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

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
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${process.env.INTERNAL_API_URL || process.env.API_BASE_URL || 'https://api.joyminis.com/api'}/:path*`,
      },
    ];
  },
  images: {
    dangerouslyAllowSVG: true,
    remotePatterns: [
      { protocol: 'https', hostname: 'img.joyminis.com' },
      { protocol: 'https', hostname: '**' },
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
      // Replace node:crypto with browser shim (used by @lucky/shared → order-no.helper.ts)
      config.plugins.push(
        new webpack.NormalModuleReplacementPlugin(
          /^node:crypto$/,
          (resource: { request: string }) => {
            resource.request = path.resolve(
              __dirname,
              "./src/lib/crypto-shim.ts",
            );
          },
        ),
      );
    }

    // Remove Sentry debug logging from production bundle
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

const sentryConfig = {
  silent: true,
  hideSourceMaps: true,
  tunnelRoute: '/monitoring',
};

export default withSentryConfig(
  withBundleAnalyzer(withNextIntl(nextConfig)),
  sentryConfig,
);
