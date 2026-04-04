import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    environmentOptions: {
      jsdom: {
        // MSW interceptor needs an absolute base to resolve relative XHR paths.
        // Without this, new URL('/api/users', 'about:blank') throws "Invalid URL".
        url: 'http://localhost',
      },
    },
    globals: true,
    setupFiles: ['./src/__tests__/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['src/__e2e__/**', 'node_modules/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      exclude: [
        'node_modules/**',
        'src/__tests__/setup.ts',
        '**/*.d.ts',
        'src/app/**', // Next.js page wrappers — covered by E2E
        'src/routes/**',
        'src/constants.ts',
      ],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // 防止 next/navigation 在测试环境报错
      'next/navigation': path.resolve(
        __dirname,
        './src/__tests__/mocks/next-navigation.ts',
      ),
      'next/dynamic': path.resolve(
        __dirname,
        './src/__tests__/mocks/next-dynamic.tsx',
      ),
      // server-only 在测试环境中不做运行时检查（生产环境保护不变）
      'server-only': path.resolve(
        __dirname,
        './src/__tests__/mocks/server-only.ts',
      ),
    },
  },
});
