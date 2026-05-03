---
title: 'Sentry 可观测性 — Span 常量与工具函数'
slug: sentry-observability-span-utils
tags: Next.js, Admin, Sentry, Observability, TypeScript, Monitoring, Performance
description: 管理后台的 Sentry 可观测性体系通过自定义 Span 常量和工具函数，实现了全链路追踪的统一命名规范、操作类型分类和属性标签标准化。
---

# Sentry 可观测性 — Span 常量与工具函数

> **难度**: ⭐⭐⭐⭐  
> **适用场景**: 任何需要监控请求性能、追踪分布式调用的 Next.js 应用  
> **源码位置**: 
> - [`sentry-span-constants.ts`](../../../../apps/admin-next/src/lib/sentry-span-constants.ts)
> - [`sentry-span.ts`](../../../../apps/admin-next/src/lib/sentry-span.ts)

## 一、为什么需要自定义 Span 工具？

Sentry 的默认 instrumentation 可以捕获 HTTP 请求和页面导航，但对于**业务级别的可观测性**——"用户点击客服按钮到数据返回花了多久？"——需要手动创建 Span。

### 1.1 问题

```ts
// ❌ 混用的 magic string
Sentry.startSpan({ name: 'fetch_data', op: 'http.client' }, async () => {
  const data = await fetchSomeData();
  return data;
});

// 另一个文件
Sentry.startSpan({ name: 'server.fetch_request', op: 'http' }, async () => {
  // ...
});
```

- Span name 不统一：`fetch_data` vs `server.fetch_request`
- Op 不统一：`http.client` vs `http`
- 属性键名不统一：`method` vs `http_method`
- 修改一个 name 要 grep 整个项目

### 1.2 解决方案

使用**集中式常量 + 工具函数**强制统一：

```
constants:  SENTRY_SPAN_NAME, SENTRY_SPAN_OP, SENTRY_SPAN_ATTR_KEY
              │
              ▼
utilities:   withAppSpan, withSsrSpan, withUiActionSpan, withHttpClientSpan
              │
              ▼
usage:       serverGet(), HttpClient.interceptors, UI components
```

## 二、常量定义

[`sentry-span-constants.ts`](../../../../apps/admin-next/src/lib/sentry-span-constants.ts) 定义了 3 组常量：

### 2.1 Span 名称

```ts
export const SENTRY_SPAN_NAME = {
  DASHBOARD_STATS_FETCH: 'admin.ssr.fetch.dashboard_stats',
  SERVER_FETCH_REQUEST: 'admin.ssr.fetch.server_request',
  HTTP_CLIENT_REQUEST: 'admin.http.client.request',
  SUPPORT_CHANNEL_CREATE: 'admin.ui.action.support_channel_create',
} as const;
```

**命名规范**：`{app}.{layer}.{action}.{entity}`

| 示例 | 含义 |
|------|------|
| `admin.ssr.fetch.dashboard_stats` | Admin 后台，SSR 层，fetch 操作，dashboard 统计 |
| `admin.http.client.request` | Admin 后台，HTTP 客户端层，通用请求 |
| `admin.ui.action.support_channel_create` | Admin 后台，UI 动作，创建客服渠道 |

### 2.2 Span 操作类型

```ts
export const SENTRY_SPAN_OP = {
  HTTP_SERVER: 'http.server',
  HTTP_CLIENT: 'http.client',
  UI_ACTION: 'ui.action',
} as const;
```

三个 op 覆盖了管理后台的所有主要性能关注点：
- `http.server` — SSR 请求（服务端渲染阶段的数据获取）
- `http.client` — 客户端 API 请求（浏览器发起的 XHR）
- `ui.action` — 用户操作（点击、提交等）

### 2.3 Span 属性键

```ts
export const SENTRY_SPAN_ATTR_KEY = {
  APP_SECTION: 'app.section',
  HTTP_METHOD: 'http.method',
  HTTP_ROUTE: 'http.route',
  FETCH_REVALIDATE: 'fetch.revalidate',
  SUPPORT_BUSINESS_ID_MODE: 'support.business_id_mode',
  SUPPORT_BUSINESS_ID: 'support.business_id',
} as const;
```

这些属性是 Sentry 性能面板的**维度**，用于过滤和分组：

| 属性 | 值示例 | 用途 |
|------|--------|------|
| `app.section` | `dashboard`, `products` | 按页面模块过滤 |
| `http.method` | `GET`, `POST` | 按请求方法过滤 |
| `http.route` | `/v1/admin/finance/statistics` | 按 API 路由过滤 |
| `fetch.revalidate` | `30`, `0` | 按 ISR 策略过滤 |
| `support.business_id_mode` | `admin`, `user` | 按业务模式过滤 |

## 三、工具函数

[`sentry-span.ts`](../../../../apps/admin-next/src/lib/sentry-span.ts) 提供了 3 个专用包装 + 1 个通用包装：

### 3.1 `withAppSpan` — 通用包装

```ts
export async function withAppSpan<T>(
  options: AppSpanOptions,
  fn: () => Promise<T>,
): Promise<T> {
  return Sentry.startSpan(
    {
      name: options.name,
      op: options.op,
      attributes: cleanAttributes(options.attributes),
    },
    fn,
  );
}
```

`cleanAttributes` 函数自动过滤 `null` 和 `undefined` 的属性值：

```ts
function cleanAttributes(attributes) {
  if (!attributes) return undefined;
  const cleaned = Object.fromEntries(
    Object.entries(attributes).filter(
      ([, value]) => value !== undefined && value !== null,
    ),
  );
  return Object.keys(cleaned).length > 0 ? cleaned : undefined;
}
```

**为什么需要过滤？** Sentry 的 `attributes` 不接受 `null`/`undefined` 值。如果不过滤，Sentry SDK 会抛出类型警告或静默丢弃整个 attributes 对象。

### 3.2 专用包装

```ts
// SSR 数据获取
export async function withSsrSpan<T>(name, attributes, fn) {
  return withAppSpan({ name, op: SENTRY_SPAN_OP.HTTP_SERVER, attributes }, fn);
}

// UI 用户操作
export async function withUiActionSpan<T>(name, attributes, fn) {
  return withAppSpan({ name, op: SENTRY_SPAN_OP.UI_ACTION, attributes }, fn);
}

// 客户端 HTTP 请求
export async function withHttpClientSpan<T>(name, attributes, fn) {
  return withAppSpan({ name, op: SENTRY_SPAN_OP.HTTP_CLIENT, attributes }, fn);
}
```

每个函数都固定了 `op` 参数，调用方只需传入 `name` + `attributes` + 业务逻辑，减少重复代码。

## 四、使用场景

### 4.1 Server Component 数据获取

在 [`serverFetch.ts`](../../../../apps/admin-next/src/lib/serverFetch.ts) 中：

```ts
export async function serverGet<T>(path, params?, options?): Promise<T> {
  return withAppSpan({
    name: SENTRY_SPAN_NAME.SERVER_FETCH_REQUEST,
    op: SENTRY_SPAN_OP.HTTP_CLIENT,
    attributes: {
      [SENTRY_SPAN_ATTR_KEY.HTTP_METHOD]: 'GET',
      [SENTRY_SPAN_ATTR_KEY.HTTP_ROUTE]: path,
      [SENTRY_SPAN_ATTR_KEY.FETCH_REVALIDATE]: revalidate,
    },
  }, async () => {
    // ... 实际的 fetch 逻辑
  });
}
```

**效果**：Sentry Performance 面板中可以看到：
- `admin.ssr.fetch.server_request` Span
- 标记了 `http.method=GET`, `http.route=/v1/admin/finance/statistics`
- 可以按 `fetch.revalidate` 值区分 ISR 策略

### 4.2 HttpClient 请求

在 [`http.ts`](../../../../apps/admin-next/src/api/http.ts) 的拦截器中：

```ts
import { withHttpClientSpan } from '@/lib/sentry-span';
import { SENTRY_SPAN_ATTR_KEY, SENTRY_SPAN_NAME } from '@/lib/sentry-span-constants';

// 在请求拦截器中
config.headers[SENTRY_SPAN_ATTR_KEY] = JSON.stringify({
  method: config.method,
  url: config.url,
});
```

### 4.3 UI 操作追踪

```ts
import { withUiActionSpan } from '@/lib/sentry-span';

const handleCreateChannel = async () => {
  await withUiActionSpan(
    SENTRY_SPAN_NAME.SUPPORT_CHANNEL_CREATE,
    { [SENTRY_SPAN_ATTR_KEY.APP_SECTION]: 'customer-service' },
    async () => {
      await chatApi.createChannel(data);
    },
  );
};
```

## 五、与 HttpClient 的集成

HttpClient 的 `withRetry` 函数中，同时也引入了 Sentry span 支持——因为 HTTP 请求的每次尝试（包括重试）都值得追踪：

```
HttpClient request
  ↓
withHttpClientSpan (name + method + url)
  ↓
for attempt 1..3:
  withRetry → Sentry 记录每次尝试的耗时
  ↓
error → Sentry 捕获异常
```

## 六、最佳实践

| 实践 | 说明 |
|------|------|
| **名称统一** | 所有 span name 以 `admin.` 开头，按 `app.layer.action.entity` 命名 |
| **Op 分类** | 三层 op 覆盖 SSR、HTTP、UI，不混用 |
| **属性过滤** | `cleanAttributes` 自动处理 null/undefined |
| **轻量包装** | 工具函数零运行时开销（只在调用时创建对象） |
| **常量优先** | 新增 span 先检查常量文件，不引入 magic string |

## 七、总结

[`sentry-span-constants.ts`](../../../../apps/admin-next/src/lib/sentry-span-constants.ts) + [`sentry-span.ts`](../../../../apps/admin-next/src/lib/sentry-span.ts) 总共只有 **86 行代码**，但提供了：

- **类型安全** — `as const` 确保 name/op/attr 不会拼错
- **统一命名** — 避免项目中 10 种不同的 `fetch_data` 写法
- **开箱即用** — `withSsrSpan` / `withHttpClientSpan` / `withUiActionSpan` 覆盖所有场景
- **Sentry 兼容** — `cleanAttributes` 自动处理 SDK 限制

---

**相关阅读**：

- [A9: 安全工具链 — Zod 验证 + PII 脱敏 + XSS 防护](./security-toolchain-zod-pii-xss.md)
- [A4: HttpClient 请求层 — 双环境配置 + 单飞 Token 刷新](./http-client-auth-refresh-retry.md) — Sentry span 在拦截器中的应用
- [A3: Server Prefetch + ISR Revalidation](./server-prefetch-isr-revalidation.md)
