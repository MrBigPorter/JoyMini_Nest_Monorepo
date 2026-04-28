'use strict';

const path = require('path');
const nodeExternals = require('webpack-node-externals');
const TerserPlugin = require('terser-webpack-plugin');

// Monorepo: 包都 hoist 到根目录的 node_modules
const MONO_ROOT_NM = path.resolve(__dirname, '../../node_modules');
const LOCAL_NM = path.resolve(__dirname, 'node_modules');

/**
 * NestJS webpack 配置
 *  - 所有 node_modules 保持外部引用 (不打包进 bundle)
 *  - @lucky/* workspace 包从 TypeScript 源码内联（绕开 dist/ 避免 CJS/ESM 格式问题）
 *  - Terser 压缩: 保留类名 / 函数名 (NestJS 装饰器反射必须)
 */
module.exports = (options) => ({
  ...options,

  // 将 @lucky/* 指向 TypeScript 源码，与 admin-next transpilePackages 方式一致
  // 彻底避免 packages/shared/dist/ 的 CJS/ESM 内联问题
  resolve: {
    ...options.resolve,
    alias: {
      ...(options.resolve && options.resolve.alias),
      '@lucky/shared': path.resolve(
        __dirname,
        '../../packages/shared/src/index.ts',
      ),
    },
  },

  externals: [
    nodeExternals({
      modulesDir: MONO_ROOT_NM, // 主要: 根目录 hoisted node_modules
      additionalModuleDirs: [LOCAL_NM], // 补充: api 本地 node_modules
      allowlist: [/^@lucky\//], // @lucky/* 内联进 bundle
    }),
  ],

  optimization: {
    minimize: true,
    minimizer: [
      new TerserPlugin({
        terserOptions: {
          // ⚠️ 必须保留类名 / 函数名 — NestJS DI & reflect-metadata 依赖
          keep_classnames: true,
          keep_fnames: true,
          mangle: {
            keep_classnames: true,
            keep_fnames: true,
          },
          compress: {
            dead_code: true,
            drop_debugger: true,
          },
          format: {
            comments: false,
          },
        },
        extractComments: false,
      }),
    ],
  },
});
