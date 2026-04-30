# JoyMini Blog — Cloudflare 运维配置指南

> **本文档**：详细说明 frontend-blog 在 Cloudflare Workers 上的完整配置、ISR 机制、缓存策略、常见故障排查和日常运维操作。
> **适用对象**：需要部署、配置或排障 blog.joyminis.com 的开发者。
> **关键词**：Cloudflare Workers, OpenNext, ISR, Queue, KV, wrangler.jsonc

---

## 目录

1. [架构概览](#1-架构概览)
2. [wrangler.jsonc 完整配置参考](#2-wranglerjsonc-完整配置参考)
3. [Cloudflare Queues（ISR 队列）](#3-cloudflare-queuesisr-队列)
4. [KV Namespaces 说明](#4-kv-namespaces-说明)
5. [ISR 机制与缓存链](#5-isr-机制与缓存链)
6. [缓存清除操作](#6-缓存清除操作)
7. [日志查看与监控](#7-日志查看与监控)
8. [常见故障排查](#8-常见故障排查)
9. [日常运维清单](#9-日常运维清单)
10. [CI/CD 部署流程](#10-cicd-部署流程)

---

## 1. 架构概览

```
用户请求
   │
   ▼
┌──────────────────────────────────────────┐
│  Cloudflare Global Network (300+ 节点)    │
│                                          │
│  ┌────────────────────────────────────┐   │
│  │  ① CDN Edge Cache                 │   │
│  │  Edge TTL: 5min                    │   │
│  │  stale-while-revalidate: 24h       │   │
│  └────────────┬───────────────────────┘   │
│               │ miss                      │
│               ▼                           │
│  ┌────────────────────────────────────┐   │
│  │  ② OpenNext Worker                │   │
│  │  (lucky-blog-prod)                 │   │
│  │                                    │   │
│  │  ├─ KV ISR Cache (NEXT_INC_CACHE) │   │
│  │  ├─ KV Tag Cache (NEXT_TAG_CACHE) │   │
│  │  └─ ISR Queue (NEXT_QUEUE)        │   │
│  └────────────┬───────────────────────┘   │
└───────────────┼───────────────────────────┘
                │
                ▼
┌──────────────────────────────────────────┐
│  VPS — NestJS API                        │
│  api.joyminis.com                        │
│  ├─ BlogService.getCategories()          │
│  ├─ BlogService.getTags()                │
│  └─ Prisma → PostgreSQL                  │
└──────────────────────────────────────────┘
```

### 关键组件

| 组件 | 位置 | 职责 |
|------|------|------|
| **OpenNext Worker** | Cloudflare Workers | 运行 Next.js 应用，处理 SSR/ISR/SSG |
| **CDN Edge Cache** | Cloudflare Edge | 缓存 HTML 页面，减少 Worker 调用 |
| **KV ISR Cache** | Cloudflare KV | 持久化缓存渲染结果，避免重复渲染 |
| **ISR Queue** | Cloudflare Queues | 异步 ISR 重新验证的消息队列 |
| **NestJS API** | VPS | 数据持久化，提供 REST API |

### 数据流详情

```
用户访问 /zh/categories/
  1. CDN Edge Cache 检查是否有缓存 → HIT: 直接返回
  2. MISS → Worker 接收到请求
  3. Worker 检查 KV ISR Cache → HIT: 返回缓存 HTML
  4. MISS → Worker 执行 SSR 渲染
     ├─ serverGet('/v1/frontend/blog/categories', { lang: 'zh' })
     │   → fetch('https://api.joyminis.com/api/v1/frontend/blog/categories?lang=zh')
     │   → NestJS → Prisma → PostgreSQL
     └─ 渲染 HTML → 存入 KV Cache → 返回给 CDN → 返回给用户
  5. 页面过期后 → Worker 发送 ISR 重新验证消息到 Queue
  6. Queue 触发 Worker 后台重新生成页面 → 更新 KV Cache
```

---

## 2. wrangler.jsonc 完整配置参考

> **注意**：项目使用 `wrangler.jsonc`（JSONC 格式），而不是传统的 `wrangler.toml`（TOML 格式）。
> 配置文件路径：[`apps/frontend-blog/wrangler.jsonc`](../../apps/frontend-blog/wrangler.jsonc)

### 2.1 完整配置结构

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "lucky-blog-prod",
  "main": ".open-next/worker.js",
  "compatibility_date": "2026-03-20",
  "compatibility_flags": ["nodejs_compat"],
  "minify": true,
  "routes": [
    {
      "pattern": "blog.joyminis.com/*",
      "zone_name": "joyminis.com"
    },
    {
      "pattern": "blog-dev.joyminis.com/*",
      "zone_name": "joyminis.com"
    }
  ],
  "assets": {
    "binding": "ASSETS",
    "directory": ".open-next/assets"
  },
  "vars": {
    "NODE_ENV": "production",
    "NEXT_PUBLIC_API_BASE_URL": "https://api.joyminis.com/api",
    "ENABLE_ISR": "true",
    "ISR_REVALIDATE_SECONDS": "60",
    "BROWSER_CACHE_TTL": "300",
    "STALE_WHILE_REVALIDATE": "86400"
  },
  "kv_namespaces": [...],
  "r2_buckets": [...],
  "queues": {...},
  "analytics_engine_datasets": [...],
  "observability": {...},
  "env": {...}
}
```

### 2.2 各字段说明

| 字段 | 值 | 说明 |
|------|-----|------|
| `name` | `lucky-blog-prod` | Worker 名称，在 Cloudflare Dashboard 中显示 |
| `main` | `.open-next/worker.js` | OpenNext 构建输出的 Worker 入口文件 |
| `compatibility_date` | `2026-03-20` | 指定 Cloudflare Runtime API 版本 |
| `compatibility_flags` | `["nodejs_compat"]` | 启用 Node.js 兼容 API（crypto, path, process 等） |
| `minify` | `true` | 部署时自动压缩 Worker 代码 |
| `routes` | 见配置 | 绑定到哪些域名路由 |
| `assets` | 静态资源 | OpenNext 构建的纯静态文件目录 |

### 2.3 vars 环境变量

| 变量名 | 示例值 | 说明 |
|--------|--------|------|
| `NODE_ENV` | `production` | 运行环境 |
| `NEXT_PUBLIC_API_BASE_URL` | `https://api.joyminis.com/api` | 后端 API 地址 |
| `NEXT_PUBLIC_ENVIRONMENT` | `cloudflare` | 标识当前运行平台 |
| `ENABLE_ISR` | `true` | 启用 ISR 增量静态再生 |
| `ISR_REVALIDATE_SECONDS` | `60` | ISR 重新验证间隔（秒） |
| `BROWSER_CACHE_TTL` | `300` | 浏览器缓存 TTL（秒） |
| `STALE_WHILE_REVALIDATE` | `86400` | 缓存过期后允许使用陈旧内容的时长（秒） |
| `AUTH_COOKIE_DOMAIN` | `.joyminis.com` | 认证 Cookie 的域名 |

### 2.4 env 环境配置

```jsonc
"env": {
  "production": {
    "name": "lucky-blog-production",
    "vars": {
      "NEXT_PUBLIC_API_URL": "https://api.joyminis.com",
      "NEXT_PUBLIC_CDN_URL": "https://img.joyminis.com"
    }
  },
  "staging": {
    "name": "lucky-blog-staging",
    "vars": {
      "NEXT_PUBLIC_API_URL": "https://staging-api.joyminis.com",
      "NEXT_PUBLIC_CDN_URL": "https://staging-img.joyminis.com"
    }
  }
}
```

通过 `--env production` 或 `--env staging` 参数选择环境。

---

## 3. Cloudflare Queues（ISR 队列）

### 3.1 队列是什么

Cloudflare Queues 是 Cloudflare 提供的消息队列服务。在 OpenNext 中，它用于 **ISR 页面重新验证的异步消息传递**：

```
页面缓存过期 → Worker 发送消息到 Queue → Queue 触发 Worker 后台重新渲染 → 更新 KV Cache
```

### 3.2 生产者（Producer）

[`wrangler.jsonc:71-78`](../../apps/frontend-blog/wrangler.jsonc:71-78) 配置生产者：

```jsonc
"queues": {
  "producers": [
    {
      "binding": "NEXT_QUEUE",    // Worker 中通过 env.NEXT_QUEUE 访问
      "queue": "next-revalidation-queue"  // Cloudflare 中的队列名称
    }
  ]
}
```

生产者允许 Worker **发送消息**到队列。

### 3.3 消费者（Consumer）

消费者允许队列 **投递消息给 Worker** 处理：

```jsonc
"queues": {
  "producers": [
    {
      "binding": "NEXT_QUEUE",
      "queue": "next-revalidation-queue"
    }
  ],
  "consumers": [
    {
      "queue": "next-revalidation-queue",
      "max_batch_size": 1,       // 每次处理 1 条消息
      "max_batch_timeout": 5     // 最多等待 5 秒凑批
    }
  ]
}
```

> ⚠️ **如果没有配置 consumers，队列会显示 inactive，ISR 会失效。**

### 3.4 创建队列

```bash
# 通过 wrangler CLI 创建
cd apps/frontend-blog
npx wrangler queues create next-revalidation-queue

# 或通过 Cloudflare Dashboard：
# Workers & Pages → Queues → Create Queue
```

### 3.5 队列状态说明

| 状态 | 含义 | 原因 |
|------|------|------|
| **Active** | 正常运行 | 已配置 producers + consumers 且 Worker 已部署 |
| **Inactive** | 无消费者 | 只有 producers，没有 consumers，或消费者尚未部署 |
| **Paused** | 暂停 | 在 Dashboard 中手动暂停 |

### 3.6 ISR 队列的工作流程

```
1. 用户请求 /zh/categories/
2. Worker 检查 KV Cache → 已过期
3. Worker 返回陈旧缓存 + 触发重新验证
4. Worker 发送消息到 next-revalidation-queue
   {
     "url": "/zh/categories/",
     "method": "GET",
     "headers": {...}
   }
5. Queue 将消息投递给 Worker（作为消费者）
6. Worker 的 queue() 处理器接收到消息
7. Worker 重新渲染 /zh/categories/
8. Worker 将新 HTML 存入 KV Cache
9. 下次请求 → 用户获取最新页面
```

---

## 4. KV Namespaces 说明

[`wrangler.jsonc:36-56`](../../apps/frontend-blog/wrangler.jsonc:36-56) 配置了 4 个 KV Namespace：

```jsonc
"kv_namespaces": [
  {
    "binding": "CACHE",            // 通用缓存
    "id": "e984df0553f24241850af22d7621faa4"
  },
  {
    "binding": "ISR_CACHE",        // ISR 缓存
    "id": "1fc88f516bcf4efa9a50bef6e2912405"
  },
  {
    "binding": "NEXT_INC_CACHE_KV", // OpenNext 增量缓存
    "id": "1fc88f516bcf4efa9a50bef6e2912405"
  },
  {
    "binding": "NEXT_TAG_CACHE_KV", // 标签缓存（按标签批量失效）
    "id": "1fc88f516bcf4efa9a50bef6e2912405"
  }
]
```

> **注意**：`ISR_CACHE`、`NEXT_INC_CACHE_KV`、`NEXT_TAG_CACHE_KV` 三个绑定指向 **同一个 KV 命名空间**（ID 相同）。这是 OpenNext 的设计，不需要创建多个。

### KV 缓存键格式

| KV 绑定 | 缓存键格式 | 说明 |
|---------|-----------|------|
| `NEXT_INC_CACHE_KV` | `html:{url}` | 缓存整个页面的 HTML |
| `NEXT_TAG_CACHE_KV` | `tag:{tagName}:{url}` | 按标签追踪页面，用于批量失效 |
| `CACHE` | 自定义 | API 响应等自定义缓存数据 |

### 手动查看/操作 KV

```bash
# 列出所有 KV 命名空间
npx wrangler kv namespace list

# 列出某个 KV 的键
npx wrangler kv key list --binding NEXT_INC_CACHE_KV

# 获取特定键的值
npx wrangler kv key get --binding NEXT_INC_CACHE_KV "html:/zh/categories/"

# 删除特定键
npx wrangler kv key delete --binding NEXT_INC_CACHE_KV "html:/zh/categories/"
```

---

## 5. ISR 机制与缓存链

### 5.1 页面级 ISR 配置

在页面文件中通过 `revalidate` 导出控制 ISR 行为：

| 页面 | 文件 | revalidate | 说明 |
|------|------|-----------|------|
| 分类列表 | [`categories/page.tsx:10`](../../apps/frontend-blog/src/app/%5Blocale%5D/categories/page.tsx:10) | `600` | 10 分钟 |
| 标签列表 | [`tags/page.tsx:10`](../../apps/frontend-blog/src/app/%5Blocale%5D/tags/page.tsx:10) | `3600` | 1 小时 |
| 文章详情 | 各 slug 页面 | `60` | 1 分钟 |
| 首页 | 首页 | `300` | 5 分钟 |

### 5.2 完整缓存链

```
┌─────────────────────────────────────────────────┐
│ ① Browser Cache                                 │
│   Cache-Control: public, max-age=0, s-maxage=300 │
│   浏览器不缓存 HTML，但缓存静态资源 1 年          │
└─────────────────────┬───────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────┐
│ ② CDN Edge Cache (Cloudflare)                   │
│   Edge TTL: 300s (5 分钟)                        │
│   stale-while-revalidate: 86400s (24 小时)       │
│   边缘节点缓存返回的 HTML 页面                    │
└─────────────────────┬───────────────────────────┘
                      │ CDN Cache MISS
                      ▼
┌─────────────────────────────────────────────────┐
│ ③ KV ISR Cache (Cloudflare KV)                  │
│   持久化存储渲染好的 HTML                        │
│   即使 CDN 缓存过期，KV 中仍有数据               │
│   避免每次都要重新 SSR 渲染                      │
└─────────────────────┬───────────────────────────┘
                      │ KV Cache MISS
                      ▼
┌─────────────────────────────────────────────────┐
│ ④ SSR Rendering (Worker)                        │
│   执行 serverGet() 调用后端 API                  │
│   渲染完整 HTML → 存入 KV Cache                  │
│   → 返回给 CDN Cache → 返回给用户               │
└─────────────────────────────────────────────────┘
```

### 5.3 ISR 重新验证流程

```
时间轴：

T+0    用户请求页面 → KV 有缓存 → 返回缓存 HTML
       同时检查 revalidate 时间是否过期

T+10m  用户请求页面 → KV 缓存过期
       → 立即返回陈旧缓存（避免用户等待）
       → 发送重新验证消息到 Queue
       → Queue 触发 Worker 后台重新渲染
       → 新 HTML 存入 KV Cache

T+10m+1 下一个用户 → KV 有新缓存 → 立即返回
```

### 5.4 手动触发 ISR 重新验证

```bash
# 方式 1：清除 KV 中特定页面的缓存
npx wrangler kv key delete --binding NEXT_INC_CACHE_KV "html:/zh/categories/"

# 方式 2：全量清除 KV ISR 缓存
npx wrangler kv key delete --binding NEXT_INC_CACHE_KV --all

# 方式 3：清除 CDN 缓存
curl -X POST "https://api.cloudflare.com/client/v4/zones/{zone_id}/purge_cache" \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json" \
  -d '{"purge_everything":true}'
```

---

## 6. 缓存清除操作

### 6.1 清除 CDN Edge Cache

使用 Cloudflare API 清除所有边缘节点缓存：

```bash
#!/bin/bash
# 设置环境变量
CF_ZONE_ID="your-zone-id"
CF_API_TOKEN="your-api-token"

# 全量清除
curl -X POST "https://api.cloudflare.com/client/v4/zones/$CF_ZONE_ID/purge_cache" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"purge_everything": true}'
```

按 URL 清除（仅清除特定页面）：

```bash
curl -X POST "https://api.cloudflare.com/client/v4/zones/$CF_ZONE_ID/purge_cache" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"files": ["https://blog.joyminis.com/zh/categories/"]}'
```

### 6.2 清除 KV ISR Cache

```bash
# 清除特定页面
npx wrangler kv key delete --binding NEXT_INC_CACHE_KV "html:/zh/categories/"

# 批量清除（使用前缀）
npx wrangler kv key list --binding NEXT_INC_CACHE_KV --prefix "html:/zh/" | \
  jq -r '.[].name' | \
  xargs -I {} npx wrangler kv key delete --binding NEXT_INC_CACHE_KV "{}"
```

### 6.3 完整清除流程（部署后）

```bash
#!/bin/bash
set -e

echo "Step 1: Deploy Worker"
cd apps/frontend-blog
npx wrangler deploy

echo "Step 2: Purge CDN cache"
curl -X POST "https://api.cloudflare.com/client/v4/zones/$CF_ZONE_ID/purge_cache" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"purge_everything": true}'

echo "Step 3: Verify"
curl -s -o /dev/null -w "HTTP %{http_code}, CF-Cache: %{header{cf-cache-status}}" \
  https://blog.joyminis.com/zh/categories/
```

### 6.4 清除后验证

```bash
# 验证 CDN 缓存状态
curl -I https://blog.joyminis.com/zh/categories/
# 期望响应头：
# CF-Cache-Status: MISS  (第一次请求，未缓存)
# CF-Cache-Status: HIT   (第二次请求，已缓存)

# 验证页面内容包含数据
curl -s https://blog.joyminis.com/zh/categories/ | grep -o 'category' | head -5
```

---

## 7. 日志查看与监控

### 7.1 Worker 日志

```bash
# 实时 tail Worker 日志
npx wrangler tail

# 按环境
npx wrangler tail --env production

# 过滤特定 URL
npx wrangler tail --search "/zh/categories/"
```

### 7.2 Cloudflare Dashboard 日志

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. 进入 **Workers & Pages** → **lucky-blog-prod**
3. 点击 **Logs** 标签页
4. 可以按时间、状态码、路径等条件过滤

### 7.3 常见的日志模式

```
# 正常请求
GET /zh/categories/ 200 OK (SSR: 450ms, CF-Cache: MISS)

# CDN 缓存命中
GET /zh/categories/ 200 OK (CF-Cache: HIT, Age: 123)

# ISR 重新验证
[ISR] Revalidating /zh/categories/ (queue message received)

# ISR 队列错误
Failed to revalidate stale page /zh/tags/
FatalError: Dummy queue is not implemented  ← Queue 未配置消费者
```

### 7.4 Queue 监控

```bash
# 查看队列状态
npx wrangler queues list

# 查看特定队列详情
npx wrangler queues list --json | jq '.[] | select(.queue_name == "next-revalidation-queue")'
```

---

## 8. 常见故障排查

### 8.1 FatalError: Dummy queue is not implemented

**症状**：Cloudflare 日志中出现此错误，页面数据不更新。

**原因**：`next-revalidation-queue` 不存在或没有消费者绑定。

**解决方案**：

```bash
# Step 1: 确认队列是否存在
npx wrangler queues list

# Step 2: 如果不存在，创建它
npx wrangler queues create next-revalidation-queue

# Step 3: 在 wrangler.jsonc 中添加 consumers 配置
# 参见本文档 3.3 节

# Step 4: 重新部署
npx wrangler deploy

# Step 5: 清除 KV 缓存和 CDN 缓存
npx wrangler kv key delete --binding NEXT_INC_CACHE_KV --all
# + 清除 CDN edge cache（见 6.1 节）

# Step 6: 验证
curl -I https://blog.joyminis.com/zh/categories/
```

### 8.2 页面显示空白/无数据

**症状**：页面渲染成功但内容为空，如分类/标签列表无数据。

**原因**：
- API 返回空数据（后端问题）
- ISR 缓存了空数据且无法重新验证（队列问题）
- CDN 缓存了空页面

**排查步骤**：

```bash
# Step 1: 直接测试 API，确认后端数据正常
curl -s "https://api.joyminis.com/api/v1/frontend/blog/categories?lang=zh" | jq .

# Step 2: 绕过 CDN 直接访问 Worker
curl -H "CF-Worker: direct" -s https://blog.joyminis.com/zh/categories/

# Step 3: 清除 KV ISR 缓存
npx wrangler kv key delete --binding NEXT_INC_CACHE_KV "html:/zh/categories/"

# Step 4: 清除 CDN 缓存
curl -X POST "..."（见 6.1 节）

# Step 5: 重新访问验证
```

### 8.3 KV 缓存未更新

**症状**：修改了分类名称，但页面上仍然是旧的。

**原因**：KV Cache 的 TTL 还没过期，或者 ISR 队列不工作。

**解决方案**：

```bash
# 立即清除该页面的 KV 缓存
npx wrangler kv key delete --binding NEXT_INC_CACHE_KV "html:/zh/categories/"

# 如果需要全局清除所有 ISR 缓存
npx wrangler kv key delete --binding NEXT_INC_CACHE_KV --all

# 重新请求页面（会触发 SSR）
curl -s https://blog.joyminis.com/zh/categories/ | jq .
```

### 8.4 Queue 显示 Inactive

**症状**：队列已创建，但状态为 inactive。

**原因**：wrangler.jsonc 中缺少 `consumers` 配置。

**解决方案**：在 [`wrangler.jsonc:71`](../../apps/frontend-blog/wrangler.jsonc:71) 添加 consumers 部分：

```jsonc
"queues": {
  "producers": [
    {
      "binding": "NEXT_QUEUE",
      "queue": "next-revalidation-queue"
    }
  ],
  "consumers": [
    {
      "queue": "next-revalidation-queue",
      "max_batch_size": 1,
      "max_batch_timeout": 5
    }
  ]
}
```

重新部署后，队列会变成 **Active** 状态。

### 8.5 部署后页面未更新

**症状**：重新部署了 Worker，但访问页面还是旧版本。

**原因**：CDN Edge Cache 或 KV ISR Cache 有旧缓存。

**解决方案**：

```bash
# 部署后执行缓存清除三部曲
# 1. 清除 KV ISR 缓存
npx wrangler kv key delete --binding NEXT_INC_CACHE_KV --all

# 2. 清除 KV Tag 缓存
npx wrangler kv key delete --binding NEXT_TAG_CACHE_KV --all

# 3. 清除 CDN Edge Cache
curl -X POST "https://api.cloudflare.com/client/v4/zones/$CF_ZONE_ID/purge_cache" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"purge_everything": true}'
```

### 8.6 API 返回空数据

**症状**：直接调用 API 也返回空。

**排查步骤**：

```bash
# 1. 确认 API 健康
curl -s "https://api.joyminis.com/api/v1/health"

# 2. 检查前端分类 API（带 lang 参数）
curl -s "https://api.joyminis.com/api/v1/frontend/blog/categories?lang=zh"

# 3. 检查 admin 分类 API（确认数据库是否有数据）
# 需要管理员 token
curl -H "Authorization: Bearer {token}" \
  -s "https://api.joyminis.com/api/v1/blog/categories"

# 4. 如果 admin API 有数据但 frontend API 为空
# 检查 FrontendBlogService.getFrontendCategories() 的映射逻辑
# 可能在 mapCategoryForFrontend() 中过滤掉了所有数据
```

---

## 9. 日常运维清单

### 每日检查

- [ ] Cloudflare Dashboard 查看 Worker 错误率
- [ ] 检查 CDN 缓存命中率（目标 > 80%）
- [ ] 确认 Queue 状态为 Active

### 每周任务

- [ ] 审核 Worker 日志，排查异常
- [ ] 检查 KV 存储使用量
- [ ] 查看 API 响应时间是否有变化

### 每次部署前

- [ ] 确认 Queue 已创建且为 Active
- [ ] 检查 wrangler.jsonc 配置是否有语法错误
- [ ] 清除旧构建缓存（`.open-next/`, `.next/`）
- [ ] 准备缓存清除命令

### 每次部署后

- [ ] 清除 KV ISR Cache
- [ ] 清除 CDN Edge Cache
- [ ] 验证首页加载正常
- [ ] 验证分类/标签页面有数据
- [ ] 验证文章详情页可访问
- [ ] 查看 Worker 日志确认无错误

---

## 10. CI/CD 部署流程

### 10.1 部署命令

```bash
# 构建
cd apps/frontend-blog
yarn build

# 部署（使用 wrangler.jsonc）
npx wrangler deploy

# 指定环境
npx wrangler deploy --env production
npx wrangler deploy --env staging

# 部署到预览（快速验证）
npx wrangler deploy --env staging --dry-run
```

### 10.2 构建输出

```
apps/frontend-blog/
├── .open-next/
│   ├── worker.js        ← Worker 入口（主部署文件）
│   ├── assets/          ← 静态资源（图片、字体等）
│   └── ...
├── .next/               ← Next.js 构建缓存
└── wrangler.jsonc       ← Cloudflare 配置
```

### 10.3 完整部署脚本

参考 [`deploy/blog-cloudflare.sh`](../../deploy/blog-cloudflare.sh)：

```bash
# 一键部署
./deploy/blog-cloudflare.sh --env production --domain blog.joyminis.com

# 或分步执行
cd apps/frontend-blog
yarn build && npx wrangler deploy
```

---

## 附录

### A. 相关文档

| 文档 | 说明 |
|------|------|
| [`CLOUDFLARE_RESOURCE_CONFIG_EXPLAINER.md`](../architecture/CLOUDFLARE_RESOURCE_CONFIG_EXPLAINER.md) | R2/D1/Analytics 资源配置通俗解释 |
| [`cloudflare-edge-cache-config.md`](../cloudflare-edge-cache-config.md) | CDN 边缘缓存规则配置 |
| [`BLOG_CLOUDFLARE_DEPLOYMENT_ARCHITECTURE.md`](../architecture/BLOG_CLOUDFLARE_DEPLOYMENT_ARCHITECTURE.md) | 部署架构设计 |
| [`BLOG_CACHING_ARCHITECTURE.md`](../caching/BLOG_CACHING_ARCHITECTURE.md) | 缓存架构与验证指南 |
| [`ONLINE_OPERATIONS.md`](./ONLINE_OPERATIONS.md) | 全局运维手册 |

### B. 常用命令速查

```bash
# Worker 相关
npx wrangler deploy                    # 部署
npx wrangler tail                      # 查看日志
npx wrangler versions list             # 查看版本历史
npx wrangler rollback                  # 回滚到上一版本

# Queue 相关
npx wrangler queues list               # 列出队列
npx wrangler queues create <name>      # 创建队列
npx wrangler queues delete <name>      # 删除队列

# KV 相关
npx wrangler kv namespace list         # 列出 KV 命名空间
npx wrangler kv key list --binding     # 列出键
npx wrangler kv key get --binding      # 获取值
npx wrangler kv key delete --binding   # 删除键

# 缓存清除
curl -X POST .../purge_cache           # 清除 CDN 缓存
```

### C. 术语表

| 术语 | 说明 |
|------|------|
| **ISR** | Incremental Static Regeneration，增量静态再生 |
| **SSR** | Server-Side Rendering，服务端渲染 |
| **KV** | Cloudflare Key-Value 存储 |
| **Queue** | Cloudflare 消息队列服务 |
| **OpenNext** | 让 Next.js 运行在 Cloudflare Workers 上的适配层 |
| **wrangler** | Cloudflare 官方 CLI 工具 |

---

> **文档版本**：v1.0
> **最后更新**：2026-04-30
> **维护者**：JoyMini Blog Team
