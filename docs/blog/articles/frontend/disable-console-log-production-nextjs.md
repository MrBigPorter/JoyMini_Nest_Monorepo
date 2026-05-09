---
title: 前端生产环境日志治理：Next.js 中禁用 console.log 的最佳实践
slug: disable-console-log-production-nextjs
tags: Next.js, Production, Logging, TerserPlugin, Webpack, Performance
description: 本文系统梳理了 Next.js 项目在生产环境中禁用 console.* 日志的三种方案——compiler.removeConsole、TerserPlugin pure_funcs 和 Worker 手动处理，以及三端（frontend-blog / admin-blog / admin-next）的落地实践。
---

# 前端生产环境日志治理：Next.js 中禁用 console.log 的最佳实践

## 一、背景：为什么要在生产禁用日志？

你可能觉得"console.log 不就是打个日志吗，能有多大影响？"但在生产环境中，每一行 `console.log` 都有实实在在的成本：

| 影响 | 说明 |
|------|------|
| **性能开销** | `console.*` 在 V8 中是同步 I/O 操作，即使输出到 `/dev/null` 也有开销 |
| **日志爆炸** | Service Worker 的 `console.log` 会输出到 Cloudflare Workers 的日志系统，按量计费 |
| **信息泄露** | 开发日志可能包含 API URL 结构、内部字段名等敏感信息 |
| **用户终端** | 浏览器 `console.log` 会在用户 F12 时暴露内部信息 |

我们的 monorepo 包含三个前端项目：`frontend-blog`（读者端）、`admin-blog`（管理后台）和 `admin-next`（新版管理后台）。三者的日志治理状态各不相同。

## 二、三种禁用方案对比

在开始之前，先了解 Next.js 生态中最常用的三种方案。

### 2.1 compiler.removeConsole（推荐）

Next.js 内置的编译选项，在 webpack 编译阶段剥离所有 `console.*` 调用：

```typescript
// next.config.ts
const nextConfig = {
  compiler: {
    removeConsole: process.env.NODE_ENV === 'production',
  },
};
```

**优点**：
- 同时覆盖客户端和服务端代码
- 零配置，一行搞定
- 由 Next.js 官方维护

**缺点**：
- 全有或全无——无法选择性保留 `console.warn` / `console.error`
- 仅适用于 Next.js 编译的代码

### 2.2 TerserPlugin pure_funcs（选择性剥离）

使用 webpack 的 TerserPlugin，声明哪些函数调用是"纯函数"（无副作用），生产构建时会自动删除：

```typescript
// next.config.ts
const nextConfig = {
  webpack: (config) => {
    config.optimization.minimizer.push(
      new TerserPlugin({
        terserOptions: {
          compress: {
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
      }),
    );
    return config;
  },
};
```

**优点**：可以精确控制保留哪些 `console.*` 方法
**缺点**：仅覆盖客户端 bundle，不影响服务端代码

### 2.3 运行时覆盖（Worker 专用）

对于独立于 Next.js 构建链的文件（如 Cloudflare Workers），需要在运行时手动覆盖：

```typescript
// worker.ts
if (process.env.NODE_ENV === 'production') {
  console.log = () => {};
  console.warn = () => {};
  console.error = () => {};
  console.debug = () => {};
}
```

**优点**：适用于任何独立脚本
**缺点**：不优雅，覆盖原生方法

## 三、现状分析：三端的问题

### 3.1 frontend-blog

| 执行环境 | 当前状态 | 问题 |
|---------|---------|------|
| 客户端 bundle | ✅ 已通过 TerserPlugin `drop_console: true` 禁用 | 但有更简洁的方案 |
| 服务端 SSR | ⚠️ 不受 TerserPlugin 影响 | 仍有日志在生产输出 |
| Service Worker | ❌ 独立构建，完全不受控制 | `worker.ts` 中的日志照常输出 |

需要处理的文件：
- [`worker.ts`](/apps/frontend-blog/src/worker.ts) — Service Worker 独立于 Next.js 构建
- `lib/serverFetch.ts` — SSR fetch 错误日志
- `lib/cached/article.ts` — SSR 缓存错误日志
- `lib/utils/platform.ts` — 平台检测 `console.log`
- `lib/pwa/manifest-loader.ts` — `console.log`

### 3.2 admin-blog

| 执行环境 | 当前状态 | 问题 |
|---------|---------|------|
| 客户端 bundle | ⚠️ 部分覆盖 | `pure_funcs` 仅剥离了 `console.log/info/debug/trace`，但 `console.warn` 和 `console.error` 仍在执行 |
| 服务端 SSR | ❌ 不受影响 | `api/http.ts` 的错误日志、`instrumentation.ts` 的 Sentry 初始化日志 |

### 3.3 admin-next

情况与 admin-blog 完全相同：客户端部分覆盖，服务端完全不受控制。

## 四、统一修复方案

为三个项目分别采用最合适的方案：

### 4.1 frontend-blog：改用 compiler.removeConsole

修改 [`apps/frontend-blog/next.config.ts`](/apps/frontend-blog/next.config.ts)：

```typescript
const baseConfig: NextConfig = {
  // ... existing config
  compiler: {
    removeConsole: process.env.NODE_ENV === 'production',
  },
};
```

同时移除旧的 TerserPlugin `drop_console: true` 配置（保留 TerserPlugin 的其他优化如 `passes: 2` 和 `hoist_funs`）。

### 4.2 admin-blog：扩展 pure_funcs 或改用 compiler.removeConsole

修改 [`apps/admin-blog/next.config.ts`](/apps/admin-blog/next.config.ts)：

方案 A：扩展 pure_funcs（推荐，保留服务端日志）

```typescript
pure_funcs: [
  'console.log',
  'console.info',
  'console.debug',
  'console.trace',
  'console.warn',    // 新增
  'console.error',   // 新增
],
```

方案 B：改用 compiler.removeConsole（更彻底，但会删掉 Sentry 的错误日志）

```typescript
compiler: {
  removeConsole: process.env.NODE_ENV === 'production',
},
```

**建议用方案 A**：admin-blog 是管理后台，`console.warn` 和 `console.error` 可能用于调试生产问题。如果直接全部禁用，遇到线上问题时可能失去关键的诊断信息。（当然，如果用户明确要求完全禁用，就用方案 B。）

### 4.3 admin-next：同 admin-blog

修改 [`apps/admin-next/next.config.ts`](/apps/admin-next/next.config.ts)，方案与 admin-blog 保持一致。

### 4.4 frontend-blog worker.ts：手动处理

由于 [`worker.ts`](/apps/frontend-blog/src/worker.ts) 是 Cloudflare Workers 入口文件，独立于 Next.js 构建链，需要在文件顶部添加运行时禁用：

```typescript
// 生产环境禁用日志
if (process.env.NODE_ENV === 'production' && typeof console !== 'undefined') {
  console.log = () => {};
  console.warn = () => {};
  console.error = () => {};
  console.debug = () => {};
}
```

或者更彻底地，直接删除所有 `console.*` 调用行。

## 五、实施优先级

| 优先级 | 项目 | 修改文件 | 改动量 | 影响范围 |
|--------|------|---------|--------|---------|
| P0 | frontend-blog | `next.config.ts` | 1-2 行 | 覆盖客户端 + 服务端所有 `console.*` |
| P1 | admin-blog | `next.config.ts` | 3-5 行 | 覆盖客户端所有 `console.*`（服务端保留） |
| P2 | admin-next | `next.config.ts` | 3-5 行 | 覆盖客户端所有 `console.*`（服务端保留） |
| P3 | frontend-blog | `worker.ts` | 8 行 | 覆盖 Service Worker 日志 |

## 六、注意事项

### 6.1 compiler.removeConsole 的副作用

`compiler.removeConsole` 会无差别地移除所有 `console.*` 调用。这意味着如果 Sentry 或其他监控工具在服务端使用了 `console.error` 来记录错误，这些日志也会被删除。

解决方法：如果需要在生产保留错误日志，使用 `pure_funcs` 方式选择性剥离，或者用 `compiler.removeConsole` 的 exclude 配置：

```typescript
compiler: {
  removeConsole: {
    exclude: ['error', 'warn'],  // 保留 console.error 和 console.warn
  },
},
```

### 6.2 保留 dev 环境的日志

一定要用 `process.env.NODE_ENV === 'production'` 条件包裹，确保开发时日志正常工作。调试时日志是必不可少的工具。

### 6.3 监控替代方案

禁用 `console.*` 不代表不记录错误。应该使用专门的监控工具替代：

- **Sentry**：捕获未处理异常和手动上报的错误
- **自定义 Logger**：输出到 stdout/stderr，由 Docker/Cloudflare 收集
- **Web Vitals**：通过 `navigator.sendBeacon()` 上报性能数据

## 七、总结

前端生产环境日志治理是一个"小改动大收益"的优化。通过正确配置 Next.js 的 `compiler.removeConsole` 或 TerserPlugin 的 `pure_funcs`，可以在不影响开发体验的前提下，消除生产环境的日志性能开销和信息泄露风险。

关键要点：

1. **统一治理**：三端项目各有不同的初始状态，需要分别处理
2. **选择性剥离**：`console.error` 和 `console.warn` 是否保留取决于业务需求
3. **Worker 特殊处理**：独立于 Next.js 构建链的文件需要手动覆盖
4. **监控替代**：禁用日志后，确保有 Sentry 等替代方案捕获错误
