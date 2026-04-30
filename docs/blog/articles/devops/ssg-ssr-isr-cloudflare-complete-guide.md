---
tags:
  - Cloudflare
  - Next.js
  - SSG
  - SSR
  - ISR
  - OpenNext
  - Architecture
  - Reference
---

# SSG / SSR / ISR 与 Cloudflare Worker 配置完全指南

> 基于 JoyMini Blog 项目的实战经验，深入分析 Next.js 三种渲染模式在 Cloudflare Workers 上的配置、关联与注意事项。

---

## 目录

1. [架构总览](#1-架构总览)
2. [SSG（静态生成）](#2-ssg静态生成)
3. [SSR（服务端渲染）](#3-ssr服务端渲染)
4. [ISR（增量静态再生）](#4-isr增量静态再生)
5. [Cloudflare Worker 配置详解](#5-cloudflare-worker-配置详解)
6. [三层缓存架构](#6-三层缓存架构)
7. [CI/CD 集成](#7-cicd-集成)
8. [故障排查指南](#8-故障排查指南)
9. [部署检查清单](#9-部署检查清单)
10. [完整文件引用](#10-完整文件引用)

---

## 1. 架构总览

### 1.1 核心架构

```
┌──────────────────────────────────────────────────────────────────┐
│                        用户浏览器                                  │
│  ① Browser Cache (静态资源: 1年, HTML: 不缓存)                     │
└─────────────────────────┬────────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────────────┐
│                   Cloudflare 全球边缘网络 (300+ 节点)               │
│  ② CDN Edge Cache (Edge TTL: 5min, stale-while-revalidate: 24h)  │
└─────────────────────────┬────────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────────────┐
│              Cloudflare Worker (OpenNext 运行时)                   │
│  ┌──────────┐  ┌───────────┐  ┌──────────────────┐               │
│  │ KV Cache │  │ DO Queue  │  │ Cloudflare Queue  │               │
│  │ (ISR)    │  │ (Handler) │  │ (producer/consumer)│               │
│  └──────────┘  └───────────┘  └──────────────────┘               │
└─────────────────────────┬────────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────────────┐
│                    NestJS API (VPS 数据层)                         │
│  Prisma → PostgreSQL (文章/分类/标签/评论 数据)                    │
└──────────────────────────────────────────────────────────────────┘
```

### 1.2 渲染模式决策流程

```
用户请求进入
    │
    ▼
┌─ 页面是否被 generateStaticParams() 预生成？ ─┐
│ 是                  │ 否                      │
▼                     ▼                         │
SSG HTML              ┌── Worker 运行时渲染 ──┐│
直接返回               │ SSR: 实时获取数据渲染  ││
(最快)                │ ISR: 从 KV 获取缓存    ││
                      │ 过期则后台重新生成      ││
                      └────────────────────────┘│
                      ▼                          ▼
              响应返回用户              KV 缓存更新 (ISR)
```

### 1.3 关键组件关系表

| 组件 | 技术 | 位置 | 职责 |
|------|------|------|------|
| SSG | Next.js `generateStaticParams()` | 构建时 | 预生成静态 HTML |
| SSR | Next.js Server Component + `serverGet()` | Worker 运行时 | 实时渲染页面 |
| ISR | OpenNext `DOQueueHandler` + Cloudflare Queues | Worker 后台 | 缓存过期后异步更新 |
| KV ISR 缓存 | Cloudflare KV (`NEXT_INC_CACHE_KV`) | Worker 内部 | 持久化缓存渲染结果 |
| CDN 边缘缓存 | Cloudflare Edge Cache | 网络层 | 缓存 HTTP 响应 |
| Durable Object | `DOQueueHandler` (OpenNext) | Worker 内部 | 管理 ISR 队列消息 |
| Service Binding | `WORKER_SELF_REFERENCE` | Worker → Worker | ISR 重新验证自调用 |
| API 数据层 | NestJS + Prisma | VPS | 数据持久化 |
| CI/CD | GitHub Actions | 构建环境 | 构建 + 部署 |

---

## 2. SSG（静态生成）

### 2.1 工作原理

SSG 在 **构建时**（`opennextjs-cloudflare build`）执行，生成 `.html`、`.rsc`、`.meta` 文件，存放在 `.open-next/assets/` 目录中。

```
opennextjs-cloudflare build
    │
    ▼
generateStaticParams() → 为每个 locale 生成路径
    │
    ▼
Server Component 执行 → serverGet('/api/...') 获取数据
    │
    ▼
渲染 HTML → 写入 .open-next/assets/
    │
    ▼
wrangler deploy → 上传到 Cloudflare 作为静态资源
```

### 2.2 标准 SSG 模式

项目的标准 SSG 模式定义在 [`apps/frontend-blog/src/app/[locale]/categories/page.tsx`](../../../apps/frontend-blog/src/app/[locale]/categories/page.tsx)：

```typescript
// 1. ISR 重新验证间隔（秒）
export const revalidate = 600;

// 2. 为所有 locale 生成静态路径
export async function generateStaticParams() {
  return getEnabledLocales().map((locale: Locale) => ({ locale }));
}

// 3. CDN 缓存头
export async function generateHeaders() {
  return {
    'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=3600',
  };
}

// 4. Server Component 构建时取数 + try/catch 回退
export default async function CategoriesPage({ params }) {
  const { locale } = await params;
  try {
    const initialData = await serverGet<FrontendCategory[]>(
      '/v1/frontend/blog/categories',
      { lang: locale },
    );
    return <CategoriesPageClient initialData={initialData} />;
  } catch (error) {
    console.error('[CategoriesPage] SSG fetch failed, falling back:', error);
    return <CategoriesPageClient initialData={[]} />;
  }
}
```

### 2.3 四个关键要素

| 要素 | 代码 | 作用 |
|------|------|------|
| `revalidate` | `export const revalidate = 600` | ISR 缓存过期时间（秒） |
| `generateStaticParams()` | 返回 locale 数组 | 为哪些路径生成静态文件 |
| `generateHeaders()` | 返回 Cache-Control | CDN 边缘缓存策略 |
| `serverGet()` + try/catch | 构建时取数 + 回退 | SSG 数据来源 |

### 2.4 try/catch 回退模式的重要性

```typescript
try {
  const initialData = await serverGet(...);
  return <ClientComponent initialData={initialData} />;
} catch (error) {
  // ★ 关键：如果构建时 API 不可达，不会导致构建失败
  // 传空数组让客户端 hooks 在运行时重新获取
  return <ClientComponent initialData={[]} />;
}
```

**为什么这是必要的？**

- 构建时（CI/CD）可能无法访问 API（环境变量缺失、网络问题）
- 构建失败不应该阻塞部署
- 用户首次访问时，React Query 会从 `initialData: []` 发起新的请求
- `staleTime` 过期后自动重新获取

### 2.5 Client Component 接收 initialData

定义在 [`apps/frontend-blog/src/app/[locale]/categories/page.client.tsx`](../../../apps/frontend-blog/src/app/[locale]/categories/page.client.tsx:11-23)：

```typescript
'use client';

interface CategoriesPageClientProps {
  initialData?: FrontendCategory[];
}

export default function CategoriesPageClient({
  initialData = [],
}: CategoriesPageClientProps) {
  const { data: categories, isLoading, error } = useFrontendCategories(initialData);

  // 仅当无任何数据时显示骨架屏
  if (isLoading && !categories) {
    return <CategoriesPageSkeleton />;
  }

  // 错误状态
  if (error) {
    return <ErrorState />;
  }

  const categoryList = categories || [];
  return <CategoryGrid categories={categoryList} />;
}
```

### 2.6 React Query Hook 接收 initialData

定义在 [`apps/frontend-blog/src/lib/hooks/useFrontendArticles.ts`](../../../apps/frontend-blog/src/lib/hooks/useFrontendArticles.ts:127-136)：

```typescript
export function useFrontendCategories(initialData?: FrontendCategory[]) {
  const locale = useCurrentLocale();

  return useQuery({
    queryKey: ['frontendCategories', locale],
    queryFn: () => frontendBlogApi.getCategories(locale),
    staleTime: 60 * 60 * 1000, // 1小时缓存
    initialData,
  });
}
```

**⚠️ 关键注意事项：**

- `staleTime: 3600000`（1小时）意味着 React Query 认为 `initialData` 在 1 小时内是 "fresh" 的，不会发起后台重新请求
- 如果 `initialData` 是空数组 `[]`，**页面会显示 1 小时的空数据**，直到 `staleTime` 过期
- 这就是为什么 `try/catch` 回退必须传 `[]` — 它至少保证 ISR 更新后页面能刷新

### 2.7 页面 revalidate 配置对照表

| 页面 | `revalidate` | `s-maxage` | 用途 |
|------|-------------|-----------|------|
| 首页 | 60s | 60s | 内容更新频繁 |
| [首页](apps/frontend-blog/src/app/[locale]/page.tsx:10) | | |
| 文章详情 | 3600s | 3600s | 发布后很少改动 |
| 分类页 | 600s | 600s | 新文章发布需要更新 |
| 标签页 | 3600s | 3600s | 同上 |
| 登录页 | 86400s | 86400s | 几乎不变 |

### 2.8 SSG 构建验证

```bash
# 构建后检查 SSG 输出
ls -la apps/frontend-blog/.next/server/app/

# 期望看到每个 locale 的 .html 文件
# /zh/categories.html  /en/categories.html  /ja/categories.html  etc.

# 检查 HTML 文件内容是否包含真实数据
grep -c "系统架构\|categories\|分类" .next/server/app/zh/categories.html
# 输出 > 0 说明 SSG 成功渲染了真实数据
```

---

## 3. SSR（服务端渲染）

### 3.1 工作原理

当页面**没有**被 `generateStaticParams()` 覆盖，或者 ISR 缓存过期且后台重新验证尚未完成时，Worker 会实时渲染页面：

```
用户请求
    │
    ▼
Worker 接收请求
    │
    ▼
执行 Server Component
    │
    ▼
serverGet() 调用 NestJS API
    │
    ▼
渲染 HTML + RSC Payload
    │
    ▼
返回给客户端
    │
    ▼
（可选）KV.put() 缓存渲染结果供 ISR 使用
```

### 3.2 serverFetch.ts URL 优先级

定义在 [`apps/frontend-blog/src/lib/serverFetch.ts`](../../../apps/frontend-blog/src/lib/serverFetch.ts:19-66)：

```typescript
const base =
  process.env.INTERNAL_API_URL ||          // 1. 首选：内部 API 地址
  process.env.NEXT_PUBLIC_API_BASE_URL ||   // 2. 回退：公开 API 地址
  'http://localhost:3000/api';              // 3. 最终回退：本地开发
```

**URL 优先级规则：**

| 优先级 | 变量 | 设置位置 | 典型值 |
|--------|------|---------|--------|
| 1 | `INTERNAL_API_URL` | CI/CD env / wrangler.jsonc | `https://api.joyminis.com/api` |
| 2 | `NEXT_PUBLIC_API_BASE_URL` | CI/CD env / wrangler.jsonc | `https://api.joyminis.com/api` |
| 3 | 硬编码默认值 | 源码 | `http://localhost:3000/api` |

**⚠️ 为什么 `INTERNAL_API_URL` 很重要？**

在 SSG 构建过程中，`serverGet()` 在 Node.js 环境中运行。如果 `INTERNAL_API_URL` 没有设置：

- 构建时无法访问外部 API → `serverGet()` 抛出错误 → try/catch 捕获 → `initialData: []`
- 部署后所有 SSG 页面都是空数据
- React Query `staleTime: 1h` 锁死空缓存 → 用户看到空页面 1 小时

### 3.3 各环境下的 URL 配置

| 环境 | 文件 | `INTERNAL_API_URL` 值 |
|------|------|----------------------|
| 本地开发 | [`.env.development`](../../../apps/frontend-blog/.env.development) | `http://localhost:3000/api` |
| 本地构建 | 命令行 env | `http://localhost:3000/api` |
| CI/CD 构建 | [deploy-blog-cloudflare.yml](../../../.github/workflows/deploy-blog-cloudflare.yml:189) | `${{ secrets.NEXT_PUBLIC_API_BASE_URL }}` |
| Cloudflare 生产 | [wrangler.jsonc](../../../apps/frontend-blog/wrangler.jsonc:26) | `https://api.joyminis.com/api` |
| Cloudflare 预览 | [wrangler.jsonc](../../../apps/frontend-blog/wrangler.jsonc:129) | `https://staging-api.joyminis.com/api` |

---

## 4. ISR（增量静态再生）

### 4.1 什么是 ISR

ISR 允许页面在部署后**异步重新生成**。当 SSG 页面缓存过期后，Worker 不会直接返回 404 或阻塞渲染，而是：

```
1. 用户请求过期页面
2. Worker 返回缓存的旧版本（stale）
3. Worker 后台触发重新验证
4. 新版本渲染完成后更新 KV 缓存
5. 下一个用户获取最新版本
```

### 4.2 ISR 完整数据流

```
页面缓存过期（超过 revalidate 时间）
    │
    ▼
下一个用户请求进入
    │
    ├── Worker 从 KV 返回 stale 缓存（不阻塞用户）
    │
    ▼
Worker 发送 Queue 消息（ISR 重新验证请求）
    │
    ▼
Cloudflare Queue 投递消息
    │
    ▼
DOQueueHandler 接收消息
    │
    ▼
DOQueueHandler 通过 WORKER_SELF_REFERENCE 调用 Worker 自身
    │
    ▼
Worker 重新渲染页面（SSR 模式）
    │
    ▼
渲染结果存入 KV 缓存
    │
    ▼
CDN Edge Cache 更新
    │
    ▼
下一个用户获取最新页面
```

### 4.3 OpenNext 的 ISR 实现

#### 4.3.1 配置入口

定义在 [`apps/frontend-blog/open-next.config.ts`](../../../apps/frontend-blog/open-next.config.ts:1-23)：

```typescript
import { defineCloudflareConfig } from '@opennextjs/cloudflare';
import kvIncrementalCache from '@opennextjs/cloudflare/overrides/incremental-cache/kv-incremental-cache';
import kvTagCache from '@opennextjs/cloudflare/overrides/tag-cache/kv-next-tag-cache';

export default defineCloudflareConfig({
  incrementalCache: kvIncrementalCache,   // KV 增量缓存
  tagCache: kvTagCache,                    // KV 标签缓存
  queue: () => import('@opennextjs/cloudflare/overrides/queue/do-queue')
    .then((m) => m.default),              // Durable Object 队列处理器
});
```

三个覆写（overrides）各自的功能：

| Override | 用途 | 绑定 |
|----------|------|------|
| `kvIncrementalCache` | KV 存储页面渲染结果 | `NEXT_INC_CACHE_KV` |
| `kvTagCache` | KV 存储 revalidate tag | `NEXT_TAG_CACHE_KV` |
| `do-queue` | Durable Object 管理队列消息 | `NEXT_CACHE_DO_QUEUE` |

#### 4.3.2 DOQueueHandler

OpenNext 的 [`DOQueueHandler`](../../../apps/frontend-blog/.open-next/.build/durable-objects/queue.js:95-280) 是一个 Durable Object，负责：

1. **接收** Cloudflare Queue 投递的 ISR 重新验证消息
2. **执行** 通过 `WORKER_SELF_REFERENCE` 调用 Worker 自身重新渲染页面
3. **管理** 失败队列（失败消息暂存，后续重试）
4. **告警** 通过 `alarm()` 定时重试失败的重新验证

```javascript
// DOQueueHandler 简化逻辑
class DOQueueHandler extends DurableObject {
  async revalidate(msg) {
    // 通过 service binding 调用 Worker 自身
    const response = await this.service.fetch(
      `${protocol}://${host}${url}`,
      { method: 'HEAD', headers: { 'x-vercel-id': '...' } }
    );
    // Worker 重新渲染页面，更新 KV 缓存
  }
}
```

### 4.4 WORKER_SELF_REFERENCE 服务绑定

**这是 ISR 正常工作的最关键配置。**

定义在 [`apps/frontend-blog/wrangler.jsonc`](../../../apps/frontend-blog/wrangler.jsonc:37-42)：

```jsonc
"services": [
  {
    "binding": "WORKER_SELF_REFERENCE",
    "service": "lucky-blog-prod"       // ★ 必须与 worker 名称一致！
  }
]
```

**工作原理：**

- `DOQueueHandler` 需要向 Worker 发送 HTTP 请求来触发重新渲染
- Cloudflare Durable Object 不能直接调用同 Worker 的 `fetch()` 处理器
- 需要通过 **Service Binding**（服务绑定）创建一个引用
- 绑定名称固定为 `WORKER_SELF_REFERENCE`（OpenNext 内部约定）
- 绑定的 `service` 值必须等于 Worker 名称（`wrangler.jsonc` 中的 `name` 字段）

**如果缺少这个绑定：**

```
Failed to revalidate stale page /zh/categories/
Error: IgnorableError: No service binding for cache revalidation worker
```

### 4.5 Cloudflare Queues 配置

#### 4.5.1 producers + consumers

配置在 [`apps/frontend-blog/wrangler.jsonc`](../../../apps/frontend-blog/wrangler.jsonc:94-107)：

```jsonc
"queues": {
  "producers": [
    {
      "binding": "NEXT_QUEUE",        // OpenNext 固定绑定名
      "queue": "next-revalidation-queue"  // 队列名称
    }
  ],
  "consumers": [
    {
      "queue": "next-revalidation-queue",
      "max_batch_size": 1,            // 每次只处理 1 条消息
      "max_batch_timeout": 5          // 批次等待超时（秒）
    }
  ]
}
```

**⚠️ producers 和 consumers 必须同时配置。** 缺少 consumers 会导致：

- 队列状态为 **Inactive**
- Worker 可以发送消息→但消息无法投递
- 报错 `Dummy queue is not implemented`（来自 OpenNext 内部）
- ISR 重新验证完全失效

#### 4.5.2 创建队列

队列需要通过 wrangler CLI 手动创建：

```bash
npx wrangler queues create next-revalidation-queue
```

之后才能在 `wrangler.jsonc` 中引用。如果队列不存在而 `wrangler.jsonc` 中配置了引用，部署会失败。

#### 4.5.3 Worker 入口的 queue 处理器

OpenNext 生成的 Worker 入口文件 [`worker.js`](../../../apps/frontend-blog/.open-next/worker.js:18-28) 中注册了 queue 处理器：

```javascript
export default {
  async queue(batch, env, ctx) {
    // 从 env 获取 DO 绑定
    const doId = env.NEXT_CACHE_DO_QUEUE.idFromName('do-queue');
    const stub = env.NEXT_CACHE_DO_QUEUE.get(doId);
    
    // 逐条处理队列消息
    for (const msg of batch.messages) {
      await stub.revalidate(msg.body);
      msg.ack();
    }
  },
  async fetch(request, env, ctx) {
    // ... 正常请求处理 ...
  }
};
```

### 4.6 KV 命名空间

ISR 需要多个 KV 命名空间协同工作，配置在 [`wrangler.jsonc`](../../../apps/frontend-blog/wrangler.jsonc:43-63)：

```jsonc
"kv_namespaces": [
  {
    "binding": "CACHE",               // 通用缓存
    "id": "e984df0553f24241850af22d7621faa4"
  },
  {
    "binding": "ISR_CACHE",           // ISR 专用缓存
    "id": "1fc88f516bcf4efa9a50bef6e2912405"
  },
  {
    "binding": "NEXT_INC_CACHE_KV",   // OpenNext 增量缓存
    "id": "1fc88f516bcf4efa9a50bef6e2912405"
  },
  {
    "binding": "NEXT_TAG_CACHE_KV",   // OpenNext 标签缓存
    "id": "1fc88f516bcf4efa9a50bef6e2912405"
  }
]
```

**注意：** `NEXT_INC_CACHE_KV` 和 `NEXT_TAG_CACHE_KV` 可以指向同一个 KV 命名空间（OpenNext 内部使用不同的键前缀 `incremental-cache:` 和 `tag-cache:` 来隔离数据）。

### 4.7 Durable Object 迁移

定义在 [`wrangler.jsonc`](../../../apps/frontend-blog/wrangler.jsonc:65-79)：

```jsonc
"durable_objects": {
  "bindings": [
    {
      "name": "NEXT_CACHE_DO_QUEUE",          // DO 绑定名
      "class_name": "DOQueueHandler"           // DO 类名
    }
  ]
},
"migrations": [
  {
    "tag": "v1",
    "new_sqlite_classes": ["DOQueueHandler"]   // 首次部署创建 DO 类
  }
]
```

- `NEXT_CACHE_DO_QUEUE`：OpenNext 固定绑定名
- `DOQueueHandler`：OpenNext 内部实现的 Durable Object 类
- `migrations` 中的 `new_sqlite_classes`：首次部署时告诉 Cloudflare 创建这个 DO 类

---

## 5. Cloudflare Worker 配置详解

### 5.1 wrangler.jsonc 完整结构

[`apps/frontend-blog/wrangler.jsonc`](../../../apps/frontend-blog/wrangler.jsonc) 的完整配置分段：

#### 5.1.1 基本信息

```jsonc
{
  "name": "lucky-blog-prod",           // Worker 名称（★ 与 WORKER_SELF_REFERENCE 关联）
  "main": ".open-next/worker.js",       // OpenNext 构建的 Worker 入口
  "compatibility_date": "2026-03-20",   // Cloudflare Workers 兼容日期
  "compatibility_flags": ["nodejs_compat"],  // Node.js 兼容模式
  "minify": true                        // 压缩 Worker 代码
}
```

#### 5.1.2 路由

```jsonc
"routes": [
  { "pattern": "blog.joyminis.com/*", "zone_name": "joyminis.com" },
  { "pattern": "blog-dev.joyminis.com/*", "zone_name": "joyminis.com" }
]
```

两个路由分别绑定生产域名和预览域名。

#### 5.1.3 变量

```jsonc
"vars": {
  "NODE_ENV": "production",
  "NEXT_PUBLIC_ENVIRONMENT": "cloudflare",
  "NEXT_PUBLIC_API_BASE_URL": "https://api.joyminis.com/api",
  "INTERNAL_API_URL": "https://api.joyminis.com/api",    // ★ SSG/SSR 关键
  "ENABLE_ISR": "true",
  "ENABLE_STREAMING": "true",
  "ENABLE_EDGE_MIDDLEWARE": "true",
  "AUTH_COOKIE_DOMAIN": ".joyminis.com",
  "ISR_REVALIDATE_SECONDS": "60",
  "BROWSER_CACHE_TTL": "300",
  "STALE_WHILE_REVALIDATE": "86400"
}
```

#### 5.1.4 多环境配置

`wrangler.jsonc` 支持三个环境级别的配置继承：

```
Root (默认) ──────────────────────────────────────
  ├── env.production ─── 生产环境 (lucky-blog-production)
  └── env.staging ────── 预览环境 (lucky-blog-staging)
```

子环境**继承** Root 的所有配置，可以覆盖特定字段。关键覆盖规则：

| 配置项 | Root | Production | Staging |
|--------|------|-----------|---------|
| Worker 名称 `name` | `lucky-blog-prod` | `lucky-blog-production` | `lucky-blog-staging` |
| `WORKER_SELF_REFERENCE` service | `lucky-blog-prod` | `lucky-blog-production` | `lucky-blog-staging` |
| `INTERNAL_API_URL` | `https://api.joyminis.com/api` | 同上 | `https://staging-api.joyminis.com/api` |
| `NEXT_PUBLIC_API_BASE_URL` | `https://api.joyminis.com/api` | 同上 | `https://staging-api.joyminis.com/api` |

### 5.2 所有绑定的对照表

| 绑定 | 类型 | 用途 |
|------|------|------|
| `WORKER_SELF_REFERENCE` | Services | ISR 重新验证自调用 |
| `CACHE` | KV Namespace | 通用缓存 |
| `ISR_CACHE` | KV Namespace | ISR 缓存 |
| `NEXT_INC_CACHE_KV` | KV Namespace | OpenNext 增量缓存 |
| `NEXT_TAG_CACHE_KV` | KV Namespace | OpenNext 标签缓存 |
| `NEXT_CACHE_DO_QUEUE` | Durable Object | ISR 队列消息处理 |
| `NEXT_QUEUE` | Queue (producer) | ISR 重新验证消息发送 |
| (consumers) | Queue (consumer) | ISR 重新验证消息接收 |
| `ASSETS` | Assets | 静态资源目录 |
| `R2_STORAGE` | R2 Bucket | 媒体文件存储 |

### 5.3 部署方式

部署命令定义在 [`deploy-blog-cloudflare.yml`](../../../.github/workflows/deploy-blog-cloudflare.yml:244)：

```bash
# 使用 opennextjs-cloudflare 部署
# -c: 指定 wrangler.jsonc 配置文件
# --env="": 使用 root 环境（不传入 --env 变量）
yarn exec opennextjs-cloudflare deploy -c wrangler.jsonc --env=""
```

---

## 6. 三层缓存架构

### 6.1 缓存层次

```
用户请求
    │
    ▼
┌──────────────────────────────────┐
│ ① Browser Cache                  │
│ 静态资源 (JS/CSS/字体): 1 年      │
│ HTML 页面: 不缓存 (max-age=0)     │
│ 指令: immutable                   │
└──────────────┬───────────────────┘
               │ miss
               ▼
┌──────────────────────────────────┐
│ ② CDN Edge Cache                 │
│ 由 generateHeaders() 控制         │
│ s-maxage=600 (10分钟)             │
│ stale-while-revalidate=3600 (1h) │
│ 延迟: ~5ms                        │
└──────────────┬───────────────────┘
               │ miss 或过期
               ▼
┌──────────────────────────────────┐
│ ③ KV ISR Cache                   │
│ 由 OpenNext kvIncrementalCache   │
│ 持久化存储页面 HTML               │
│ 延迟: ~80ms                       │
│ 键前缀: incremental-cache:       │
└──────────────┬───────────────────┘
               │ miss
               ▼
        Worker 渲染页面
        (SSR, 延迟: ~800ms)
```

### 6.2 各层缓存对比

| 特性 | KV ISR 缓存 | CDN 边缘缓存 | 浏览器缓存 |
|------|------------|-------------|-----------|
| **位置** | Worker 代码内部 | Cloudflare 网络节点 | 用户浏览器 |
| **缓存内容** | 页面 HTML 字符串 | 完整 HTTP 响应 | 静态资源文件 |
| **命中延迟** | ~50-200ms | ~1-10ms | 0ms（无网络请求） |
| **未命中代价** | 渲染页面 500ms-2s | 转发到 Worker ~50ms | 发 HTTP 请求 |
| **持久化** | KV 持久存储 | 节点级别，可能被逐出 | 用户浏览器 |
| **控制方式** | OpenNext 自动 | `generateHeaders()` + CDN 规则 | `Cache-Control` 头 |
| **成本** | 按 KV 操作计费 | Cloudflare 套餐内免费 | 免费 |

### 6.3 CDN 缓存配置

通过 Server Component 的 `generateHeaders()` 函数控制，定义在 [`page.tsx`](../../../apps/frontend-blog/src/app/[locale]/categories/page.tsx:18-22)：

```typescript
export async function generateHeaders() {
  return {
    'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=3600',
  };
}
```

参数说明：

| 指令 | 值 | 含义 |
|------|-----|------|
| `public` | — | 允许 CDN 和代理缓存 |
| `s-maxage` | 600 (10分钟) | CDN 边缘节点的最大缓存时间 |
| `stale-while-revalidate` | 3600 (1小时) | CDN 返回过期缓存的同时后台重新验证 |

### 6.4 缓存失效时的行为对比

| 场景 | 用户感知 | 后台行为 |
|------|---------|---------|
| CDN HIT | 立即返回 (~5ms) | 无 |
| CDN MISS → KV HIT | 稍慢 (~80ms) | Worker 读取 KV |
| CDN MISS → KV MISS → SSR | 较慢 (~800ms) | Worker 渲染 + 更新 KV + 更新 CDN |
| ISR 重新验证（stale 返回） | 立即返回旧版本 (~5ms) | Worker 后台重新渲染 → 更新 KV |
| SSG 构建 | 不涉及 | 构建时执行 serverGet() → 生成静态文件 |

---

## 7. CI/CD 集成

### 7.1 构建环境变量

[`.github/workflows/deploy-blog-cloudflare.yml`](../../../.github/workflows/deploy-blog-cloudflare.yml:184-198) 中的构建步骤：

```yaml
- name: 6. Build Blog for Cloudflare Pages
  working-directory: apps/frontend-blog
  env:
    # ★ 最关键：INTERNAL_API_URL 覆盖 serverFetch.ts 中的 base URL
    # SSG 构建时 serverGet() 通过它访问 API
    INTERNAL_API_URL: ${{ secrets.NEXT_PUBLIC_API_BASE_URL }}
    
    NEXT_PUBLIC_API_BASE_URL: ${{ secrets.NEXT_PUBLIC_API_BASE_URL }}
    NEXT_PUBLIC_IMG_BASE_URL: ${{ secrets.NEXT_PUBLIC_IMG_BASE_URL }}
    NEXT_PUBLIC_APP_ENV: ${{ github.ref_name == 'main' && 'production' || 'preview' }}
    # ... 其他变量
  run: |
    yarn exec opennextjs-cloudflare build
```

### 7.2 环境变量优先级总结

```
构建时 (CI/CD):
  process.env.INTERNAL_API_URL ← 来自 CI/CD env（最高优先级）
  
运行时 (Cloudflare Worker):
  process.env.INTERNAL_API_URL ← 来自 wrangler.jsonc vars
  
本地开发:
  process.env.INTERNAL_API_URL ← 来自 .env.development
```

### 7.3 部署后检查清单

部署流水线中包含 smoke check（[`deploy-blog-cloudflare.yml:313-343`](../../../.github/workflows/deploy-blog-cloudflare.yml:313-343)）：

```bash
# 1. 检查自定义域名
curl --max-time 10 -o /dev/null -w "%{http_code}" https://blog.joyminis.com
# 期望: 200

# 2. 如果自定义域名不可用，回退到 workers.dev
curl --max-time 10 -o /dev/null -w "%{http_code}" https://lucky-blog-prod.${ACCOUNT_ID}.workers.dev
# 期望: 200
```

---

## 8. 故障排查指南

### 8.1 分类/标签页为空

**现象：** 页面正常渲染但无数据（空状态），首页等其他页面正常。

**可能原因 1：SSG 构建时 API 不可达**

```
Root Cause Flow:

CI/CD 中构建
    ↓
INTERNAL_API_URL 未设置 → serverGet() 抛出错误
    ↓
try/catch 捕获 → initialData = []
    ↓
SSG 生成空页面 → 部署到 Cloudflare
    ↓
用户访问 → useFrontendCategories([]) 
    ↓
staleTime: 1h → React Query 认为空数据是 "fresh" 的
    ↓
用户看到空页面 1 小时
```

**解决方案：**

1. 确保 `INTERNAL_API_URL` 在 CI/CD 构建环境中设置
2. 确保 `INTERNAL_API_URL` 在 `wrangler.jsonc` vars 中设置

**验证：**

```bash
# 本地模拟 CI/CD 构建
INTERNAL_API_URL=https://api.joyminis.com/api yarn build

# 检查 SSG 输出包含真实数据
grep -c "category\|分类\|系统架构" .next/server/app/zh/categories.html
```

---

**可能原因 2：ISR 重新验证失败**

**现象：** 日志中出现 `Failed to revalidate stale page` 错误。

```
Root Cause Flow:

页面缓存过期
    ↓
Worker 通过 Cloudflare Queue 发送 ISR 消息
    ↓
Queue 没有 consumer → 消息无法投递
    ↓
DOQueueHandler 没有 WORKER_SELF_REFERENCE → 无法自调用
    ↓
旧缓存永远无法刷新
```

**解决方案：**

1. 配置 Queue `consumers`（[wrangler.jsonc:101-107](../../../apps/frontend-blog/wrangler.jsonc:101-107)）
2. 配置 `WORKER_SELF_REFERENCE` 服务绑定（[wrangler.jsonc:37-42](../../../apps/frontend-blog/wrangler.jsonc:37-42)）
3. 清除 KV ISR 缓存和 CDN 缓存

### 8.2 错误信息速查表

| 错误信息 | 原因 | 解决方案 |
|---------|------|---------|
| `FatalError: Dummy queue is not implemented` | Queue 缺少 consumers 配置 | 添加 consumers（见 [wrangler.jsonc:101-107](../../../apps/frontend-blog/wrangler.jsonc:101-107)） |
| `IgnorableError: No service binding for cache revalidation worker` | 缺少 `WORKER_SELF_REFERENCE` | 添加 services 绑定（见 [wrangler.jsonc:37-42](../../../apps/frontend-blog/wrangler.jsonc:37-42)） |
| `[serverFetch] ... → HTTP 403/500` | API 不可达或返回错误 | 检查 API 健康状态 + 检查 `INTERNAL_API_URL` |
| `[CategoriesPage] SSG fetch failed` | 构建时 `serverGet()` 失败 | 检查 CI/CD 中 `INTERNAL_API_URL` 是否设置 |
| `code: 11001` | API 业务错误码 | 检查 API 返回值，通常是参数错误 |

### 8.3 清除缓存

```bash
# 1. 清除 KV ISR 缓存（所有键）
npx wrangler kv key delete --binding NEXT_INC_CACHE_KV --all

# 2. 清除 CDN 边缘缓存
curl -X POST "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/purge_cache" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"purge_everything": true}'

# 3. 验证页面
curl -I https://blog.joyminis.com/zh/categories/
# 期望: CF-Cache-Status: MISS → 然后 HIT 在第二次请求时
```

### 8.4 调试流程

```bash
# 1. 验证 API 是否正常
curl -s "https://api.joyminis.com/api/v1/frontend/blog/categories?lang=zh" | jq .

# 2. 验证 Queue 状态
npx wrangler queues list
# 期望: next-revalidation-queue 状态为 Active

# 3. 检查 Worker 日志
# Cloudflare Dashboard → Workers & Pages → lucky-blog-prod → Logs

# 4. 本地构建测试 SSG
cd apps/frontend-blog
INTERNAL_API_URL=http://localhost:3000/api yarn build

# 5. 检查 SSG 输出
grep -c "category" .next/server/app/zh/categories.html

# 6. 验证 CDN 缓存头
curl -I https://blog.joyminis.com/zh/categories/
# 检查: cf-cache-status, cache-control 头
```

---

## 9. 部署检查清单

### 9.1 前置检查

- [ ] `wrangler.jsonc` 中 Worker `name` 与 `WORKER_SELF_REFERENCE` 的 `service` 一致
- [ ] Queue `next-revalidation-queue` 已创建，状态为 Active
- [ ] Queue 同时配置了 `producers` 和 `consumers`
- [ ] 所有 KV 命名空间已创建且 ID 正确
- [ ] Durable Object `DOQueueHandler` 已通过 migration 注册
- [ ] `INTERNAL_API_URL` 在 wrangler.jsonc vars 中设置

### 9.2 CI/CD 检查

- [ ] GitHub Secrets 中设置了 `NEXT_PUBLIC_API_BASE_URL`
- [ ] Build step env 中设置了 `INTERNAL_API_URL`
- [ ] `CLOUDFLARE_API_TOKEN` 有效且有权访问 Queue/KV/DO

### 9.3 部署后验证

- [ ] 页面返回 HTTP 200
- [ ] SSG 页面包含真实数据（不是空数组）
- [ ] `CF-Cache-Status: HIT` （第二次请求时）
- [ ] `Cache-Control` 头正确
- [ ] Worker 日志无 `Dummy queue` 或 `IgnorableError`
- [ ] Queue 状态为 Active

### 9.4 常见问题快速修复

| 问题 | 快速修复 |
|------|---------|
| 分类页为空 | 清除 KV + CDN 缓存，重新部署 |
| Worker 启动失败 | 检查 `main` 指向 `.open-next/worker.js` 是否存在 |
| Queue 错误 | `npx wrangler queues create next-revalidation-queue` |
| DO 错误 | 检查 migration 配置是否正确 |
| API 403 | 检查 `INTERNAL_API_URL` 和 `NEXT_PUBLIC_API_BASE_URL` |

---

## 10. 完整文件引用

### 10.1 核心源码

| 文件 | 作用 | 关键行 |
|------|------|--------|
| [`apps/frontend-blog/src/app/[locale]/categories/page.tsx`](../../../apps/frontend-blog/src/app/[locale]/categories/page.tsx) | 分类页 SSG Server Component | [L10: revalidate](../../../apps/frontend-blog/src/app/[locale]/categories/page.tsx:10), [L13: generateStaticParams](../../../apps/frontend-blog/src/app/[locale]/categories/page.tsx:13), [L31-45: try/catch SSG](../../../apps/frontend-blog/src/app/[locale]/categories/page.tsx:31-45) |
| [`apps/frontend-blog/src/app/[locale]/categories/page.client.tsx`](../../../apps/frontend-blog/src/app/[locale]/categories/page.client.tsx) | 分类页 Client Component | [L11-23: Props + initialData](../../../apps/frontend-blog/src/app/[locale]/categories/page.client.tsx:11-23) |
| [`apps/frontend-blog/src/app/[locale]/page.tsx`](../../../apps/frontend-blog/src/app/[locale]/page.tsx) | 首页 SSG（参考模式） | [L10: revalidate](../../../apps/frontend-blog/src/app/[locale]/page.tsx:10), [L25-70: SSG pattern](../../../apps/frontend-blog/src/app/[locale]/page.tsx:25-70) |
| [`apps/frontend-blog/src/lib/serverFetch.ts`](../../../apps/frontend-blog/src/lib/serverFetch.ts) | 服务端 fetch 工具 | [L19-66: URL priority + error handling](../../../apps/frontend-blog/src/lib/serverFetch.ts:19-66) |
| [`apps/frontend-blog/src/lib/hooks/useFrontendArticles.ts`](../../../apps/frontend-blog/src/lib/hooks/useFrontendArticles.ts) | React Query hooks | [L127-136: useFrontendCategories + staleTime](../../../apps/frontend-blog/src/lib/hooks/useFrontendArticles.ts:127-136) |
| [`apps/frontend-blog/open-next.config.ts`](../../../apps/frontend-blog/open-next.config.ts) | OpenNext 配置 | [L18-22: ISR overrides](../../../apps/frontend-blog/open-next.config.ts:18-22) |

### 10.2 配置和部署

| 文件 | 作用 | 关键行 |
|------|------|--------|
| [`apps/frontend-blog/wrangler.jsonc`](../../../apps/frontend-blog/wrangler.jsonc) | Cloudflare Worker 配置 | [L26: INTERNAL_API_URL](../../../apps/frontend-blog/wrangler.jsonc:26), [L37-42: WORKER_SELF_REFERENCE](../../../apps/frontend-blog/wrangler.jsonc:37-42), [L94-107: Queues](../../../apps/frontend-blog/wrangler.jsonc:94-107) |
| [`.github/workflows/deploy-blog-cloudflare.yml`](../../../.github/workflows/deploy-blog-cloudflare.yml) | CI/CD 部署流水线 | [L184-198: Build env with INTERNAL_API_URL](../../../.github/workflows/deploy-blog-cloudflare.yml:184-198) |
| [`apps/frontend-blog/.env.development`](../../../apps/frontend-blog/.env.development) | 本地开发环境变量 | `INTERNAL_API_URL=http://localhost:3000/api` |

### 10.3 OpenNext 内部实现

| 文件 | 作用 | 关键行 |
|------|------|--------|
| [`apps/frontend-blog/.open-next/.build/durable-objects/queue.js`](../../../apps/frontend-blog/.open-next/.build/durable-objects/queue.js) | DOQueueHandler 实现 | [L95-280: 完整实现](../../../apps/frontend-blog/.open-next/.build/durable-objects/queue.js:95-280) |
| [`apps/frontend-blog/.open-next/worker.js`](../../../apps/frontend-blog/.open-next/worker.js) | Worker 入口 | [L18-28: queue 处理器](../../../apps/frontend-blog/.open-next/worker.js:18-28) |
| [`node_modules/@opennextjs/cloudflare/dist/api/overrides/queue/do-queue.js`](../../../node_modules/@opennextjs/cloudflare/dist/api/overrides/queue/do-queue.js) | DO queue override | 完整实现 |

---

## 附录：关键知识点总结

### A. 三个"锁死"场景

| 场景 | 原因 | 表现 | 解锁方式 |
|------|------|------|---------|
| React Query staleTime 锁死 | `staleTime: 1h` + `initialData: []` | 空数据持续 1 小时 | 清除 KV + CDN 缓存，或等待 staleTime 过期 |
| Queue 无 consumer 锁死 | 缺少 consumers 配置 | ISR 无法刷新，缓存永远 stale | 添加 consumers + 重新部署 |
| WORKER_SELF_REFERENCE 缺失锁死 | 服务绑定缺失 | DOQueueHandler 无法自调用 | 添加 services 绑定 + 重新部署 |

### B. 环境变量传播路径

```
INTERNAL_API_URL

构建时 (CI/CD)             运行时 (Cloudflare)         本地开发
GitHub Secrets env ──────→ wrangler.jsonc vars ──────→ .env.development
    │                           │                           │
    ▼                           ▼                           ▼
process.env.INTERNAL_API_URL (构建) → .next 中硬编码    process.env.INTERNAL_API_URL
    │                                                         │
    ▼                                                         ▼
serverGet() 使用它访问 API                              serverGet() 使用 localhost
```

### C. 部署后缓存时效性

```
部署新版本
    │
    ▼
KV ISR 缓存: 旧版本数据仍然存在（需手动清除）
CDN 缓存: 旧版本数据仍然存在（需手动清除）
Cloudflare 自动分配新 Worker
    │
    ▼
新请求 → 新 Worker + 旧 KV 数据 → 页面可能显示旧内容
    │
    ▼
ISR 重新验证后 → 更新 KV + CDN → 用户看到新内容
```

因此，重大更新后建议手动清除 KV + CDN 缓存以确保即时生效。

---

> **相关文章：**
> - [Cloudflare Workers ISR 踩坑实录](./cloudflare-queue-isr-troubleshooting.md) — 本文对应的故障排查博客
> - [JoyMini AI 协作规范与项目约定](../../../.ai/project-guide.md) — 项目级开发规范
