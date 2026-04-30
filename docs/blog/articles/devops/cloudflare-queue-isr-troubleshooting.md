---
tags:
  - Cloudflare
  - DevOps
  - Next.js
  - ISR
  - OpenNext
  - Troubleshooting
  - Queue
---

# Cloudflare Workers ISR 踩坑实录：Dummy queue 引发的空数据危机

## 1. 事故现场

某个平淡无奇的下午，收到反馈："分类页面没有数据了"。

打开 `blog.joyminis.com/zh/categories/`，确实空空如也。标签页也一样。

去 Cloudflare Dashboard 看 Worker 日志，发现了关键线索：

```
Failed to revalidate stale page /zh/tags/
FatalError: Dummy queue is not implemented
```

**"Dummy queue is not implemented"** — 这个错误信息对 Cloudflare Workers + OpenNext 的用户来说可能会是一头雾水。如果你也在 Cloudflare Workers 上部署 Next.js 并使用 ISR，那这篇文章应该能帮你省下几个小时的排查时间。

## 2. 架构背景

先介绍一下我们的部署架构：

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

## 3. 排查过程

### 3.1 第一步：确认 API 数据是否正常

先排除后端问题，直接测试 API：

```bash
curl -s "https://api.joyminis.com/api/v1/frontend/blog/categories?lang=zh" | jq .
```

API 返回正常，数据完整。说明问题在前端缓存层。

### 3.2 第二步：分析错误日志

错误日志指向了 **ISR 重新验证失败**。页面的 ISR 配置如下：

```typescript
// 分类页面：10 分钟重新验证
export const revalidate = 600;

// 标签页面：1 小时重新验证
export const revalidate = 3600;
```

当页面缓存过期时，OpenNext 会尝试通过 Cloudflare Queue 发送后台重新验证消息。如果队列不存在或不可用，就会抛出 `Dummy queue is not implemented`。

### 3.3 第三步：检查 Cloudflare Queues 配置

查看我们的 [`wrangler.jsonc`](../../apps/frontend-blog/wrangler.jsonc) 配置文件：

```jsonc
"queues": {
  "producers": [
    {
      "binding": "NEXT_QUEUE",
      "queue": "next-revalidation-queue"
    }
  ]
}
```

只有 `producers`（生产者），没有 `consumers`（消费者）。

去到 Cloudflare Dashboard 一看 — 队列确实存在，但状态是 **Inactive（未激活）**。

## 4. 根因分析

### 4.1 OpenNext 是如何使用 Queues 的？

OpenNext 的 ISR 流程是这样的：

```
页面缓存过期
   ↓
Worker 发送消息到 Queue（作为 Producer）
   ↓
Queue 投递消息给 Worker（作为 Consumer）
   ↓
Worker 后台重新渲染页面
   ↓
更新 KV Cache
   ↓
下一个用户获取最新页面
```

**队列必须同时有 producer 和 consumer 才能工作。**

- `producers`：允许 Worker **发送**消息到队列
- `consumers`：允许队列 **投递**消息给 Worker

### 4.2 为什么只配了 producers？

这其实是一个常见的 OpenNext 配置盲区。OpenNext 的文档和模板大多只展示了 producers 的配置，但事实上 **queues 必须同时配置 consumers 才能激活**。

没有 consumers 时：

- 队列状态 = **Inactive**
- Worker 可以发送消息 → 但消息发不出去
- 抛出 `FatalError: Dummy queue is not implemented`
- ISR 重新验证完全失效

### 4.3 连锁反应

```
首次部署 → ISR 缓存了空数据（可能是 API 冷启动）
   ↓
缓存过期 → 尝试重新验证 → Queue 不可用 → 失败
   ↓
旧缓存永远无法刷新 → 页面永远显示空数据
   ↓
CDN Edge Cache 也缓存了空页面
   ↓
"分类还是没有数据啊"
```

## 5. 解决方案

### 5.1 创建队列

```bash
npx wrangler queues create next-revalidation-queue
```

### 5.2 配置 consumers

修改 [`wrangler.jsonc`](../../apps/frontend-blog/wrangler.jsonc) 中的 queues 配置：

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

### 5.3 重新部署并清除缓存

```bash
# 1. 部署 Worker
npx wrangler deploy

# 2. 清除 KV ISR 缓存
npx wrangler kv key delete --binding NEXT_INC_CACHE_KV --all

# 3. 清除 CDN Edge Cache
curl -X POST "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/purge_cache" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"purge_everything": true}'
```

### 5.4 验证

```bash
# 检查队列状态
npx wrangler queues list
# 期望输出：next-revalidation-queue 状态为 Active

# 验证页面
curl -I https://blog.joyminis.com/zh/categories/
# 期望：CF-Cache-Status: MISS → 然后 HIT
```

## 6. 经验教训

### 6.1 配置清单的重要性

如果当时有一份 Cloudflare 配置清单，可能就不会遗漏 consumers 了。以下是现在我们的部署 checklist：

- [ ] Queue 已创建？
- [ ] Queue 状态为 Active？
- [ ] producers 已配置？
- [ ] consumers 已配置？
- [ ] 部署后清除 KV ISR 缓存？
- [ ] 部署后清除 CDN 缓存？
- [ ] 验证页面有数据？

### 6.2 OpenNext 的隐藏依赖

OpenNext 在 Cloudflare Workers 上构建 Next.js 应用时，有多个隐式依赖：

| 依赖 | 用途 | 如果不配置 |
|------|------|-----------|
| **Cloudflare Queues** | ISR 重新验证 | Dummy queue 错误，数据不更新 |
| **KV Namespaces** | ISR 页面缓存 | 页面无法持久化缓存 |
| **R2 Buckets** | 媒体资源存储 | Worker 无法读写文件 |
| **Analytics Engine** | 数据分析 | 分析功能不可用 |

### 6.3 "Dummy queue" 不是 Cloudflare 的原生错误

这个错误信息来自 **OpenNext 内部**，不是 Cloudflare 的原生 API。在 Cloudflare 文档中搜索它不会有结果。了解这一点能节省大量查文档的时间。

## 7. 优化效果对比

### 修复前

| 指标 | 值 |
|------|-----|
| 分类页面 | 空数据 ❌ |
| 标签页面 | 空数据 ❌ |
| Worker 日志 | `Dummy queue is not implemented` |
| Queue 状态 | Inactive |

### 修复后

| 指标 | 值 |
|------|-----|
| 分类页面 | 正常显示 ✅ |
| 标签页面 | 正常显示 ✅ |
| Worker 日志 | 无错误 |
| Queue 状态 | Active |
| ISR 重新验证 | 正常工作 |

## 8. 总结

这次问题本质上是一个**配置缺失问题**，但它的影响被 ISR 的缓存机制放大了：

1. **首次渲染**捕获了错误状态 → 缓存
2. **ISR 试图修复** → 但队列不可用 → 失败
3. **缓存永远不刷新** → 用户永远看到错误

解决方案很简单——添加 consumers 配置，但排查过程暴露了 OpenNext 文档和配置清单的缺口。

我们为此补充了两份文档：

- [Cloudflare 运维配置指南](../../operations/CLOUDFLARE_OPERATIONS_GUIDE.md) — 完整的 wrangler.jsonc 参考、Queues 配置、KV 操作、故障排查手册
- [缓存架构与验证指南](../../caching/BLOG_CACHING_ARCHITECTURE.md) — 三层缓存原理和验证方法

希望这篇文章能帮到同样在 Cloudflare Workers 上跑 Next.js 的朋友们。

---

*相关文章：*
- [Next.js 博客的 Cloudflare 部署实战](./nextjs-cloudflare-deployment-opennext.md)
- [Next.js 博客三层缓存架构实战](../performance/blog-caching-architecture-practice.md)
- [JoyMini Blog 缓存架构与验证指南](../../caching/BLOG_CACHING_ARCHITECTURE.md)
- [Cloudflare 运维配置指南](../../operations/CLOUDFLARE_OPERATIONS_GUIDE.md)
