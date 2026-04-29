# Next.js 博客三层缓存架构实战：从 2s 到 80ms 的加速之路

> 本文分享对一个部署在 Cloudflare Workers 上的 Next.js 博客进行缓存优化的实战经验。通过配置 KV 增量缓存、CDN 边缘缓存和浏览器缓存三层架构，将页面响应时间从首次渲染的 2 秒降低到缓存命中时的 80 毫秒。

---

Tags: Next.js, Cloudflare, Caching, ISR, Performance

## 1. 背景：为什么一个博客需要三层缓存？

传统的博客系统通常依赖后端应用缓存（如 Redis）或者 CDN 缓存。但对于部署在 Cloudflare Workers 上的 Next.js 应用来说，情况有些特殊：

- **Worker 冷启动**：每次请求如果没有缓存，Worker 需要从零启动并渲染页面，耗时 500ms-2s
- **边缘节点分布**：用户在全球各地访问，需要尽可能在离用户最近的节点返回数据
- **静态与动态并存**：博客内容基本静态，但国际化、用户登录等又需要动态能力

我们的目标很简单：**让用户尽可能快地看到页面，同时减少 Worker 的渲染次数**。

最终的架构是这样的三层模型：

```
用户请求
   │
   ▼
┌──────────────────────┐
│  ① Browser Cache     │  静态资源缓存 1 年
│  (用户浏览器)         │  HTML 不缓存
└──────────┬───────────┘
           │ miss
           ▼
┌──────────────────────┐
│  ② CDN Edge Cache    │  Edge TTL: 5 分钟
│  (Cloudflare 边缘节点) │  stale-while-revalidate: 24h
└──────────┬───────────┘
           │ miss 或过期
           ▼
┌──────────────────────┐
│  ③ KV ISR Cache      │  KV 持久化存储
│  (Cloudflare KV)      │  避免重复渲染
└──────────┬───────────┘
           │ miss
           ▼
      Worker 渲染页面
```

## 2. 第一层：KV ISR 缓存（避免重复渲染）

### 问题

Next.js 的 ISR（Incremental Static Regeneration）在传统部署中依赖文件系统来缓存渲染后的页面。但在 Cloudflare Workers 无服务器环境中，没有持久化文件系统。每次 Worker 重启或冷启动，所有缓存消失，页面需要重新渲染。

### 解决方案：OpenNext KV 增量缓存

我们使用 `@opennextjs/cloudflare` 官方提供的 KV 缓存模块。配置非常简单：

```typescript
// open-next.config.ts
import { defineCloudflareConfig } from "@opennextjs/cloudflare";
import kvIncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/kv-incremental-cache";
import kvTagCache from "@opennextjs/cloudflare/overrides/tag-cache/kv-next-tag-cache";

export default defineCloudflareConfig({
  incrementalCache: kvIncrementalCache,
  tagCache: kvTagCache,
});
```

然后在 `wrangler.jsonc` 中绑定 KV 命名空间：

```json
{
  "kv_namespaces": [
    {
      "binding": "NEXT_INC_CACHE_KV",
      "id": "your-kv-namespace-id"
    }
  ]
}
```

### 工作原理

当用户请求一个页面时：

1. Worker 检查 KV 中是否有该页面的缓存
2. **命中**：直接返回缓存的 HTML（~80ms）
3. **未命中**：渲染页面，将结果存入 KV，返回 HTML（~500ms-2s）

KV 中的缓存键自动添加 `incremental-cache:` 前缀，与系统其他 KV 数据隔离。

### 页面级 revalidate 配置

不同页面设置了不同的缓存时间：

| 页面 | 重新验证间隔 | 说明 |
|------|-------------|------|
| 首页 | 60s | 内容更新频繁 |
| 文章详情 | 3600s | 文章发布后很少改动 |
| 分类页 | 600s | 新文章发布需要更新 |
| 标签页 | 3600s | 同上 |
| 登录页 | 86400s | 几乎不变 |
| Sitemap | 3600s | SEO 需要 |

## 3. 第二层：CDN 边缘缓存（减少 Worker 调用）

KV 缓存虽然快，但每次读取仍然需要 ~50-200ms。CDN 边缘缓存是在 Cloudflare 的边缘节点上缓存 HTTP 响应，命中时仅需 ~1-10ms。

### 配置方式

在 `next.config.ts` 中设置 Cache-Control 头：

```typescript
// next.config.ts headers 配置
const cacheHeaders = [
  {
    source: "/(.*)",
    headers: [
      {
        key: "Cache-Control",
        value: "public, max-age=3600, stale-while-revalidate=86400",
      },
    ],
  },
  {
    source: "/_next/static/(.*)",
    headers: [
      {
        key: "Cache-Control",
        value: "public, max-age=31536000, immutable",
      },
    ],
  },
];
```

### CDN 缓存规则

在 Cloudflare Dashboard 中配置了以下页面规则：

| 匹配规则 | Edge TTL | Browser TTL | 目的 |
|---------|----------|-------------|------|
| `*.css|js|woff|...` | 1 年 | 1 年 | 静态资源永久缓存 |
| `*`（所有页面） | 5 分钟 | 0 | HTML 短时缓存 |

### 关于 DYNAMIC 状态

你可能会在 Cloudflare 的缓存状态中看到 `DYNAMIC`。这是 Cloudflare 对 Workers 响应的默认标记，**不**意味着没有缓存。只要设置了正确的 `Cache-Control` 头，CDN 仍然会缓存这些响应。

## 4. 第三层：浏览器缓存（减少重复下载）

这一层最简单，由 `Cache-Control` 响应头控制：

- **静态资源**（JS、CSS、字体）：`max-age=31536000, immutable` — 缓存 1 年，浏览器不会重新验证
- **HTML 页面**：由 CDN 和 KV 缓存处理，浏览器不缓存 HTML

`immutable` 指令告诉浏览器：这个文件永远不会变，不需要发请求去验证。当文件内容变化时，Next.js 会自动生成新的文件名（基于内容 hash），所以旧缓存自然失效。

## 5. 三层缓存如何协同工作

用一个实际请求来理解三层缓存的协作：

```
请求 /zh/articles/hello-world
         │
    ┌────┴────┐
    │ Browser │  Cache-Control: max-age=0
    │ Cache   │  → 跳过浏览器缓存
    └────┬────┘
         │
    ┌────┴────┐
    │ CDN    │  Edge TTL 内 HIT? → 直接返回 (~5ms) ✅
    │ Edge   │  Edge TTL 过期?
    └────┬────┘
         │
    ┌────┴────┐
    │ Worker │  KV.get() → HIT? → 返回 HTML (~80ms) ✅
    │ + KV  │  KV.get() → MISS → 渲染页面 (~800ms)
    └─────────┘                          │
                                         ▼
                                    KV.put() → 存入 KV
```

**三种场景的延迟对比**：

| 场景 | 延迟 | 频率 |
|------|------|------|
| CDN 命中 | ~5ms | 高频（5 分钟内相同页面） |
| KV 命中 | ~80ms | 中频（不同页面/5 分钟后） |
| 全渲染 | ~800ms | 低频（首次访问/手动刷新） |

## 6. KV 缓存 vs CDN 缓存的区别

很多开发者会混淆这两者。简单来说：

| | KV ISR 缓存 | CDN 边缘缓存 |
|--|-------------|-------------|
| **位置** | Worker 内部代码层面 | Cloudflare 网络层面 |
| **缓存内容** | 页面渲染结果（HTML 字符串） | 完整 HTTP 响应（含 headers） |
| **命中耗时** | ~50-200ms（KV 读取延迟） | ~1-10ms（内存级） |
| **未命中代价** | 需要重新渲染页面（500ms-2s） | 转发到 Worker（~50ms 额外） |
| **持久化** | 是，KV 持久存储 | 否，节点可能被逐出 |
| **价值** | 减少渲染次数 | 减少 Worker 调用次数 |

**两者是互补关系**，而不是替代关系。CDN 处理高频重复请求，KV 处理低频或首次请求，共同减少 Worker 的计算开销。

## 7. 部署后如何验证缓存生效

### 一键验证

我们写了一个验证脚本，可以快速检查所有缓存层是否正常工作：

```bash
bash deploy/verify-blog-cache.sh
```

它会检查 9 项指标，包括：
- 页面可达性（HTTP 200）
- CDN 缓存状态（`cf-cache-status: HIT`）
- Cache-Control 头是否正确
- 静态资源是否缓存 1 年
- 压缩是否启用（zstd/gzip）
- 安全头是否存在

### 手动验证 KV 缓存

```bash
# 首次请求（渲染 + 存 KV，可能 500ms-2s）
time curl -so /dev/null https://blog.joyminis.com/en

# 等待 1 秒

# 二次请求（KV 读取，应 <200ms）
time curl -so /dev/null https://blog.joyminis.com/en
```

如果第二次请求时间明显缩短（如从 800ms 降到 80ms），说明 KV 缓存生效。

## 8. 常见问题

### Q: 如何强制清除 KV 缓存？

重新部署会自动刷新缓存。如需手动清除：

```bash
npx wrangler kv key delete --binding=NEXT_INC_CACHE_KV --preview "incremental-cache:/en"
```

### Q: 如何清除 CDN 缓存？

在 Cloudflare Dashboard → Caching → Purge Cache → Purge Everything，或通过 API 调用清除。

### Q: KV 缓存会不会无限增长？

KV 存储有按读取/写入/存储容量计费。对于博客应用，页面数量有限（几十到几百页），KV 缓存的成本可以忽略不计。如果担心，可以设置 KV 的 TTL 自动过期。

## 9. 总结

三层缓存架构的核心思想是：**让最贵的操作（Worker 渲染）尽可能少执行，让最便宜的操作（CDN 内存读取）尽可能多执行**。

| 层 | 成本 | 速度 | 命中率期望 |
|---|------|------|-----------|
| CDN 边缘缓存 | 免费（Cloudflare 套餐内） | ~5ms | 最高 |
| KV ISR 缓存 | 按量计费（极低） | ~80ms | 中等 |
| Worker 渲染 | 按调用次数计费 | ~800ms | 最低 |

对于访问量不大的技术博客来说，这个架构的最大价值是：**即使没有用户访问，页面也会被缓存；一旦有用户访问，后续请求都能快速响应**。从体验上看，访客几乎每次都能享受到 CDN 命中的快速加载。

---

*本文涉及的代码来自实际项目 JoyMini Nest Monorepo。项目使用 Next.js 15 + Cloudflare Workers + OpenNext，完整实现可在 GitHub 上查看。*
