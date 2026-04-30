---
tags:
  - Cloudflare
  - DevOps
  - Next.js
  - ISR
  - SSG
  - OpenNext
  - Troubleshooting
  - Queue
  - React Query
---

# Cloudflare Workers ISR 踩坑实录：从空数据到完全修复的完整历程

> 一个空的分类页面，牵出了 SSG 构建失败、ISR 队列未配置、Service Binding 缺失三个连环问题。这篇文章记录了整个排查和修复过程。

---

## 1. 事故现场

某个平淡无奇的下午，收到反馈："分类页面没有数据了"。

打开 `blog.joyminis.com/zh/categories/`，确实空空如也。标签页也一样。

但诡异的是——**首页的分类筛选器却显示正常**。同样的 API、同样的数据源，为什么首页有数据，分类页没有？

去 Cloudflare Dashboard 看 Worker 日志，发现了关键线索：

```
Failed to revalidate stale page /zh/tags/
FatalError: Dummy queue is not implemented
```

**"Dummy queue is not implemented"** — 这个错误信息对 Cloudflare Workers + OpenNext 的用户来说可能会是一头雾水。但事情远不止这么简单。

---

## 2. 架构背景

先介绍一下部署架构：

```
Next.js 博客 → OpenNext 构建 → Cloudflare Workers 部署
                                    ↓
                            Cloudflare Queues（ISR 消息队列）
                                    ↓
                      Cloudflare KV（持久化缓存页面 HTML）
                                    ↓
                          NestJS API（VPS 数据层）
```

关键组件：

- **OpenNext**：让 Next.js 的 ISR/SSR/SSG 能在 Cloudflare Workers 上运行
- **Cloudflare Queues**：用于 ISR 的异步重新验证消息传递
- **Cloudflare KV**：持久化缓存渲染好的页面 HTML

以及一个后来才发现的关键角色：

- **WORKER_SELF_REFERENCE**：Service Binding，允许 Worker 调用自身，ISR 重新验证的核心依赖

---

## 3. 排查过程

### 3.1 第一步：确认 API 数据是否正常

先排除后端问题，直接测试 API：

```bash
curl -s "https://api.joyminis.com/api/v1/frontend/blog/categories?lang=zh" | jq .
```

API 返回正常，数据完整。说明问题在前端缓存层。

### 3.2 第二步：分析 Worker 日志

日志错误指向了 **ISR 重新验证失败**。但这里有一个关键观察：为什么首页的分类有数据，而分类页没有？

这让我意识到——问题可能**不止一个**。

### 3.3 第三步：发现第一个隐藏问题

检查 `serverFetch.ts` 的 URL 优先级逻辑（[`apps/frontend-blog/src/lib/serverFetch.ts`](../../../apps/frontend-blog/src/lib/serverFetch.ts:19-26)）：

```typescript
const base =
  process.env.INTERNAL_API_URL ||          // 首选：内部 API 地址
  process.env.NEXT_PUBLIC_API_BASE_URL ||   // 回退：公开 API 地址
  'http://localhost:3000/api';              // 最终回退：本地开发
```

查看 CI/CD 构建配置（[`.github/workflows/deploy-blog-cloudflare.yml`](../../../.github/workflows/deploy-blog-cloudflare.yml:184-198)）：

```yaml
- name: 6. Build Blog for Cloudflare Pages
  working-directory: apps/frontend-blog
  env:
    NEXT_PUBLIC_API_BASE_URL: ${{ secrets.NEXT_PUBLIC_API_BASE_URL }}
    # ... 没有 INTERNAL_API_URL !
```

**构建时 `INTERNAL_API_URL` 未设置！**

在 CI/CD 构建过程中，SSG 的 `generateStaticParams()` → `serverGet()` 会尝试获取 API 数据。因为 `INTERNAL_API_URL` 缺失，`serverGet()` 降级到 `http://localhost:3000/api`（构建环境不可达）→ 抛出错误 → try/catch 捕获 → `initialData: []`。

### 3.4 第四步：发现第二个隐藏问题

检查 Cloudflare Queues 配置（[`apps/frontend-blog/wrangler.jsonc`](../../../apps/frontend-blog/wrangler.jsonc:94-107)）：

```jsonc
"queues": {
  "producers": [
    {
      "binding": "NEXT_QUEUE",
      "queue": "next-revalidation-queue"
    }
  ]
  // ⚠️ 没有 consumers！
}
```

只有 `producers`（生产者），没有 `consumers`（消费者）。队列状态是 **Inactive**。

### 3.5 第五步：发现第三个隐藏问题

检查 Worker 日志，发现另一个错误：

```
Failed to revalidate stale page /zh/categories/
Error: IgnorableError: No service binding for cache revalidation worker
```

查看 [`wrangler.jsonc`](../../../apps/frontend-blog/wrangler.jsonc:37-42) 发现 **缺少 `WORKER_SELF_REFERENCE` 服务绑定**。

OpenNext 的 `DOQueueHandler` Durable Object 需要通过这个绑定来调用 Worker 自身触发重新渲染。没有它，所有 ISR 重新验证都会失败。

---

## 4. 连锁反应：三个问题如何叠加

```
问题 1: SSG 构建失败（INTERNAL_API_URL 缺失）
  │
  ├── serverGet() 无法访问 API → try/catch → initialData: []
  ├── SSG 生成空页面 → 部署到 Cloudflare
  │
  ▼
用户看到空分类页
  │
  ▼
问题 2: Queue 无 consumers（Dummy queue 错误）
        问题 3: 无 WORKER_SELF_REFERENCE（IgnorableError）
  │
  ├── ISR 无法刷新缓存
  ├── 空页面被 CDN 缓存
  ├── React Query staleTime: 1h → 空数据被视为 "fresh"
  │
  ▼
"分类还是没有数据啊"
```

### 4.1 为什么首页有数据而分类页没有？

这就是找到根因的关键线索。**首页**的分类数据是通过客户端 Hook 在**运行时**获取的：

```
首页访问 → 浏览器端 useFrontendCategories() → axios → API → 有数据 ✅
```

而**分类页**的数据是 SSG **构建时**获取的（`serverGet()`），如果构建时 API 不可达：

```
构建时 → serverGet('/v1/frontend/blog/categories') → 失败 → initialData: []
部署后 → React Query 使用 initialData: []
       → staleTime: 1h → 认为空数据是新鲜的
       → 1 小时内不发起任何请求 → 用户看到空页面 ❌
```

### 4.2 React Query staleTime 的陷阱

[`useFrontendCategories`](../../../apps/frontend-blog/src/lib/hooks/useFrontendArticles.ts:127-136) 的配置：

```typescript
export function useFrontendCategories(initialData?: FrontendCategory[]) {
  return useQuery({
    queryKey: ['frontendCategories', locale],
    queryFn: () => frontendBlogApi.getCategories(locale),
    staleTime: 60 * 60 * 1000, // 1小时缓存
    initialData,
  });
}
```

`staleTime: 1h` 的意思：**React Query 认为 initialData 在 1 小时内是"新鲜"的**，不会发起后台重新请求。

如果 `initialData` 是 `[]`（因为 SSG 构建失败），页面就会显示**整整 1 小时的空数据**。

---

## 5. 解决方案

### 5.1 修复 SSG 构建（INTERNAL_API_URL）

在 CI/CD 构建环境中添加 `INTERNAL_API_URL`（[`deploy-blog-cloudflare.yml:189`](../../../.github/workflows/deploy-blog-cloudflare.yml:189)）：

```yaml
- name: 6. Build Blog for Cloudflare Pages
  working-directory: apps/frontend-blog
  env:
    INTERNAL_API_URL: ${{ secrets.NEXT_PUBLIC_API_BASE_URL }}  # ★ 新增
    NEXT_PUBLIC_API_BASE_URL: ${{ secrets.NEXT_PUBLIC_API_BASE_URL }}
```

同时在 [`wrangler.jsonc`](../../../apps/frontend-blog/wrangler.jsonc:26) 中设置运行时变量：

```jsonc
"vars": {
  "INTERNAL_API_URL": "https://api.joyminis.com/api",
  // ...
}
```

### 5.2 修复 Queue 配置（consumers）

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

### 5.3 修复 Service Binding（WORKER_SELF_REFERENCE）

```jsonc
"services": [
  {
    "binding": "WORKER_SELF_REFERENCE",
    "service": "lucky-blog-prod"  // ★ 必须等于 worker name
  }
]
```

**注意：** `service` 的值必须与 `wrangler.jsonc` 中的 `name` 字段完全一致。

### 5.4 清理缓存

```bash
# 1. 清除 KV ISR 缓存
npx wrangler kv key delete --binding NEXT_INC_CACHE_KV --all

# 2. 清除 CDN 边缘缓存
curl -X POST "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/purge_cache" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"purge_everything": true}'
```

### 5.5 验证

```bash
# 验证 SSG 构建输出包含真实数据
grep -c "category" .next/server/app/zh/categories.html
# 期望输出 > 0

# 验证 Queue 状态
npx wrangler queues list
# 期望：next-revalidation-queue 状态为 Active

# 验证页面
curl -I https://blog.joyminis.com/zh/categories/
# 期望：CF-Cache-Status: MISS → 然后 HIT
```

---

## 6. 一个差点犯的错误

在排查过程中，我差点做了一个错误的决策——**移除 SSG 支持**，让分类页完全依赖客户端获取数据。

但这会破坏三项收益：

1. **SEO**：SSG 生成的静态 HTML 对搜索引擎更友好
2. **首次加载速度**：SSG 直接返回 HTML，无需等待客户端 JS 加载完成
3. **用户体验**：SSG + `initialData` 让骨架屏只在无任何数据时显示

正确的做法是保持 SSG 模式，但要确保：

- **构建时**：通过 `try/catch` 回退到空数组，保证构建不失败
- **运行时**：React Query 从 `initialData` 起步，stale 后自动刷新
- **CI/CD**：`INTERNAL_API_URL` 确保构建时 API 可达

```typescript
// 正确的 SSG 模式：try/catch 回退
try {
  const initialData = await serverGet<FrontendCategory[]>(
    '/v1/frontend/blog/categories',
    { lang: locale },
  );
  return <CategoriesPageClient initialData={initialData} />;
} catch (error) {
  // 构建失败不阻塞部署，客户端会在 staleTime 过期后重新获取
  console.error('[CategoriesPage] SSG fetch failed, falling back:', error);
  return <CategoriesPageClient initialData={[]} />;
}
```

---

## 7. 最终修复效果对比

### 修复前

| 指标 | 值 |
|------|-----|
| 分类页面 | 空数据 ❌ |
| 标签页面 | 空数据 ❌ |
| Worker 日志 | `Dummy queue is not implemented` |
| Worker 日志 | `IgnorableError: No service binding` |
| Queue 状态 | Inactive |
| SSG 构建 | API 不可达，initialData: [] |
| React Query | staleTime 1h 锁死空数据 |

### 修复后

| 指标 | 值 |
|------|-----|
| 分类页面 | 正常显示 ✅ |
| 标签页面 | 正常显示 ✅ |
| Worker 日志 | 无错误 |
| Queue 状态 | Active |
| ISR 重新验证 | 正常工作 |
| SSG 构建 | API 可达，生成真实数据 |
| 6 个 locale | 全部正确生成 ✅ |

---

## 8. 经验教训

### 8.1 三个"锁死"场景

| 场景 | 原因 | 表现 | 解锁方式 |
|------|------|------|---------|
| React Query staleTime 锁死 | `staleTime: 1h` + `initialData: []` | 空数据持续 1 小时 | 清除 KV + CDN 缓存 |
| Queue 无 consumer 锁死 | 缺少 consumers 配置 | ISR 永远无法刷新 | 添加 consumers |
| WORKER_SELF_REFERENCE 缺失 | 服务绑定未配置 | DOQueueHandler 无法自调用 | 添加 services 绑定 |

### 8.2 关键配置清单

- [ ] CI/CD 构建环境设置 `INTERNAL_API_URL`
- [ ] `wrangler.jsonc` vars 中设置 `INTERNAL_API_URL`
- [ ] Queue 同时配置 `producers` 和 `consumers`
- [ ] 配置 `WORKER_SELF_REFERENCE` 服务绑定
- [ ] `service` 值等于 Worker `name`
- [ ] Queue 已创建且状态为 Active
- [ ] Durable Object migration 已注册
- [ ] KV 命名空间 ID 正确

### 8.3 排查指南：如果分类页为空

```
分类页为空
    │
    ├── 首页有数据？ → 问题在 SSG 构建，不是 API
    │       │
    │       ├── 检查 CI/CD 构建日志 → INTERNAL_API_URL?
    │       ├── 检查 .next/server/app/zh/categories.html → 有数据？
    │       └── 修复：添加 INTERNAL_API_URL 并重新部署
    │
    ├── 首页也没数据？ → 问题在 API 或缓存
    │       │
    │       ├── 检查 API → curl https://api.joyminis.com/api/...
    │       ├── 检查 Worker 日志 → Dummy queue? IgnorableError?
    │       └── 修复：检查 Queue + WORKER_SELF_REFERENCE
    │
    └── 无论哪种情况 → 清除 KV + CDN 缓存
```

---

## 9. OpenNext 隐藏依赖总结

| 依赖 | 用途 | 错误信息 | 如果不配置 |
|------|------|---------|-----------|
| **Cloudflare Queues** | ISR 消息传递 | `Dummy queue is not implemented` | ISR 失效，数据不更新 |
| **Queue consumers** | 消息投递 | 同上（队列状态 Inactive） | 消息发不出 |
| **WORKER_SELF_REFERENCE** | Worker 自调用 | `No service binding for cache revalidation` | DO 无法触发重新渲染 |
| **Durable Object** | 队列消息管理 | 各类 DO 错误 | 队列消息无人处理 |
| **KV Namespaces** | 页面缓存持久化 | 无明显错误，页面每次冷渲染 | 无缓存，性能下降 |
| **INTERNAL_API_URL** | SSG 构建时取数 | `serverGet fetch failed` | SSG 生成为空页面 |

---

## 10. 总结

这次事故表面上是一个"分类页为空"的问题，实际排查下来暴露了三个独立的问题：

1. **SSG 构建**：`INTERNAL_API_URL` 缺失导致 SSR 构建时取数全部返回空数据
2. **ISR 队列**：缺少 `consumers` 配置，队列处于未激活状态
3. **ISR 自调用**：缺少 `WORKER_SELF_REFERENCE` 服务绑定，Durable Object 无法触发重新渲染

这三个问题叠加，并被 React Query 的 `staleTime: 1h` 放大了影响范围，最终导致用户看到了持续数小时的空页面。

修复方法：
1. CI/CD 构建环境 + `wrangler.jsonc` 中设置 `INTERNAL_API_URL`
2. `wrangler.jsonc` 中配置 Queue `consumers`
3. `wrangler.jsonc` 中配置 `WORKER_SELF_REFERENCE` 服务绑定

最终，6 个 locale 的分类页、标签页全部正常显示，SSG 构建生成了包含真实数据的静态 HTML，ISR 正常工作。

---

*详细参考文档：[SSG/SSR/ISR 与 Cloudflare Worker 配置完全指南](./ssg-ssr-isr-cloudflare-complete-guide.md)*
