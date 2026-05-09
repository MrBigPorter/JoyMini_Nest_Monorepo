# 生产环境禁用日志 — 前端项目

> 范围: 仅前端 Next.js 应用（`apps/frontend-blog`, `apps/admin-blog`, `apps/admin-next`），后端 API 不动。

## 现状分析

### `apps/frontend-blog`

**客户端 (browser)**: ✅ 已通过 TerserPlugin `drop_console: true` 在生产禁用所有 `console.*`

**服务端 / Worker**: ⚠️ 仍有日志在生产输出
- [`worker.ts`](apps/frontend-blog/src/worker.ts) — Service Worker 独立于 Next.js 构建，不受 TerserPlugin 影响
- `lib/serverFetch.ts` — SSR fetch 错误日志
- `lib/cached/article.ts` — SSR 缓存错误日志
- `lib/utils/platform.ts` — 平台检测 `console.log`
- `lib/pwa/manifest-loader.ts` — `console.log`

### `apps/admin-blog`

**客户端 (browser)**: ⚠️ TerserPlugin `pure_funcs` 仅剥离了 `console.log/info/debug/trace`，**`console.warn` 和 `console.error` 在生产仍然执行**

**服务端**: ⚠️ 不受 TerserPlugin 影响
- `api/http.ts` — 请求错误 `console.warn/error`
- `instrumentation.ts` — Sentry 初始化 `console.warn`
- `hooks/useBlogForm.ts` — 客户端已受控 ✅

### `apps/admin-next`

同 admin-blog 的情况。

---

## 修复方案

使用 Next.js 内置的 [`compiler.removeConsole`](https://nextjs.org/docs/app/api-reference/next-config-js/compiler#removeconsole) 配置，它能同时在客户端和服务端构建中剥离 `console.*` 调用。比 TerserPlugin 更简洁、覆盖面更广。

### Step 1: `apps/frontend-blog`

**修改 [`apps/frontend-blog/next.config.ts`](apps/frontend-blog/next.config.ts)**

在 `baseConfig` 中添加：

```typescript
const baseConfig: NextConfig = {
  // ... existing config
  compiler: {
    removeConsole: process.env.NODE_ENV === 'production',
  },
};
```

**注意**: 当前已有 TerserPlugin `drop_console: true`，需确认是否保留 TerserPlugin（它还做了其他优化如 `passes: 2`, `hoist_funs` 等）。建议：
- 保留 TerserPlugin 的其他优化
- 移除 TerserPlugin 中的 `drop_console: true`（由 `compiler.removeConsole` 替代）
- 注意 `compiler.removeConsole` 也会覆盖 `worker.ts`... 不，`worker.ts` 是独立文件，不由 Next.js webpack 编译

### Step 2: `apps/admin-blog`

**修改 [`apps/admin-blog/next.config.ts`](apps/admin-blog/next.config.ts)**

当前 TerserPlugin 配置：

```typescript
pure_funcs: [
  'console.log',
  'console.info',
  'console.debug',
  'console.trace',
],
```

改为包含 `console.warn` 和 `console.error`：

```typescript
pure_funcs: [
  'console.log',
  'console.info',
  'console.debug',
  'console.trace',
  'console.warn',
  'console.error',
],
```

或改用 Next.js 内置 `compiler.removeConsole` 统一配置。

### Step 3: `apps/admin-next`

**修改 [`apps/admin-next/next.config.ts`](apps/admin-next/next.config.ts)**

同 admin-blog，调整 `pure_funcs` 或添加 `compiler.removeConsole`。

### Step 4: `apps/frontend-blog` worker.ts

由于 `worker.ts` 是 Cloudflare Workers 脚本，独立于 Next.js 构建链，需要在文件内手动处理。

在 [`apps/frontend-blog/src/worker.ts`](apps/frontend-blog/src/worker.ts) 顶部添加：

```typescript
// 生产环境禁用日志
const IS_DEV = typeof DEBUG !== 'undefined' && DEBUG;
if (!IS_DEV) {
  console.log = () => {};
  console.warn = () => {};
  console.error = () => {};
  console.debug = () => {};
}
```

或者直接删除 worker.ts 中的 `console.*` 调用（最彻底）。

---

## 实施优先级

| 优先级 | 文件 | 改动量 | 影响 |
|--------|------|--------|------|
| P0 | `apps/frontend-blog/next.config.ts` | 1-2 行 | 覆盖客户端+服务端所有 `console.*` |
| P1 | `apps/admin-blog/next.config.ts` | 添加 `compiler.removeConsole` | 覆盖客户端+服务端 |
| P2 | `apps/admin-next/next.config.ts` | 添加 `compiler.removeConsole` | 覆盖客户端+服务端 |
| P3 | `apps/frontend-blog/src/worker.ts` | 手动处理 | worker 日志 |

---

## 注意事项

1. `compiler.removeConsole` 会剥离所有 `console.*` 调用，包括服务端代码中的错误日志。如果需要在生产保留错误日志，应使用 `pure_funcs` 方式选择性剥离
2. admin-blog 和 admin-next 当前使用 `pure_funcs` 保留了 `console.warn` 和 `console.error`，这可能是故意的——在生产保留错误日志用于调试。但用户要求禁用，所以统一去掉
3. `worker.ts` 的处理方式不太优雅（覆盖原生方法），最干净的方式是直接删除所有 `console.*` 调用或用条件判断包裹
