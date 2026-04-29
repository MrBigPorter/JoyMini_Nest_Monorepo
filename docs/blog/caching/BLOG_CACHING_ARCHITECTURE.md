# JoyMini Blog — 缓存架构与验证指南

> 本文档详细说明 frontend-blog 的多层缓存架构，以及部署后如何验证各层缓存是否生效。
> 相关脚本：[`deploy/verify-blog-cache.sh`](deploy/verify-blog-cache.sh)

---

## 1. 架构总览

```mermaid
graph TB
    USER["用户浏览器"]
    subgraph BROWSER["浏览器层"]
        BROWSER_CACHE["Browser Cache<br/>静态资源: 1年 immutable<br/>HTML: 不缓存"]
    end

    subgraph CLOUDFLARE["Cloudflare Edge"]
        CDN["CDN Edge Cache<br/>Edge TTL: 5min<br/>stale-while-revalidate: 24h"]
    end

    subgraph WORKER["Cloudflare Worker (lucky-blog-prod)"]
        OPENNEXT["OpenNext Runtime<br/>@opennextjs/cloudflare"]
        KV_CACHE["KV Incremental Cache<br/>NEXT_INC_CACHE_KV"]
        TAG_CACHE["KV Tag Cache<br/>按标签批量失效"]
        NEXT_APP["Next.js App<br/>SSR / ISR"]
    end

    subgraph API["后端服务"]
        API_SERVER["NestJS API<br/>api.joyminis.com"]
    end

    USER -->|HTML: max-age=0| BROWSER_CACHE
    BROWSER_CACHE -->|miss| CDN
    CDN -->|edge TTL 内 HIT| USER
    CDN -->|miss 或过期| OPENNEXT
    OPENNEXT -->|getCacheKey| KV_CACHE
    KV_CACHE -->|HIT: 返回 HTML| OPENNEXT
    KV_CACHE -->|MISS: 触发渲染| NEXT_APP
    NEXT_APP -->|setCacheKey| KV_CACHE
    NEXT_APP -->|数据请求| API_SERVER
    TAG_CACHE -.->|revalidateTag()| KV_CACHE
```

### 三层缓存

| 层 | 存储位置 | 作用 | 状态 |
|---|----------|------|------|
| **① KV ISR Cache** | Cloudflare KV (`NEXT_INC_CACHE_KV`) | 缓存渲染后的页面 HTML，避免重复渲染 | ✅ **刚启用** |
| **② CDN Edge Cache** | Cloudflare 边缘节点 | 缓存 HTTP 响应，减少 Worker 调用 | ✅ 已有 |
| **③ Browser Cache** | 用户浏览器 | 缓存静态资源，减少重复下载 | ✅ 已有 |

---

## 2. 各层详解

### 2.1 KV ISR Cache（🆕 本次新增）

**配置位置**：[`open-next.config.ts`](apps/frontend-blog/open-next.config.ts)
**KV 绑定**：[`wrangler.jsonc`](apps/frontend-blog/wrangler.jsonc:47) → `NEXT_INC_CACHE_KV`
**KV 命名空间**：`ISR_CACHE` (ID: `1fc88f516bcf4efa9a50bef6e2912405`)

使用 OpenNext 官方内置的 [`kvIncrementalCache`](node_modules/@opennextjs/cloudflare/dist/api/overrides/incremental-cache/kv-incremental-cache.d.ts) 模块。

#### 工作流程

```
请求 /zh/articles/hello-world
        │
        ▼
  KV.get('incremental-cache:/zh/articles/hello-world')
        │
    ┌───┴───┐
    │       │
   HIT     MISS
    │       │
    │       ▼
    │   渲染页面 (SSR)
    │       │
    │       ▼
    │   KV.put() → 存入 KV
    │       │
    └───┬───┘
        │
        ▼
    返回 HTML
```

#### 缓存键命名

OpenNext 的 `kvIncrementalCache` 自动在键前添加 `incremental-cache:` 前缀，与旧的 `ISR_CACHE` 数据隔离。

#### 页面级 revalidate

| 页面 | revalidate | 文件 |
|------|-----------|------|
| 首页 `/[locale]` | 60s | [`page.tsx`](apps/frontend-blog/src/app/%5Blocale%5D/page.tsx) |
| 布局 `/[locale]/layout` | 60s | [`layout.tsx`](apps/frontend-blog/src/app/%5Blocale%5D/layout.tsx) |
| 文章 `/[locale]/articles/[slug]` | 3600s | [`articles/[slug]/page.tsx`](apps/frontend-blog/src/app/%5Blocale%5D/articles/%5Bslug%5D/page.tsx) |
| 分类 `/[locale]/categories` | 600s | [`categories/page.tsx`](apps/frontend-blog/src/app/%5Blocale%5D/categories/page.tsx) |
| 标签 `/[locale]/tags` | 3600s | [`tags/page.tsx`](apps/frontend-blog/src/app/%5Blocale%5D/tags/page.tsx) |
| 关于 `/[locale]/about` | 3600s | [`about/page.tsx`](apps/frontend-blog/src/app/%5Blocale%5D/about/page.tsx) |
| 登录 `/[locale]/login` | 86400s | [`login/page.tsx`](apps/frontend-blog/src/app/%5Blocale%5D/login/page.tsx) |
| Sitemap | 3600s | [`sitemap.ts`](apps/frontend-blog/src/app/%5Blocale%5D/sitemap.ts) |

### 2.2 CDN Edge Cache

**配置位置**：[`next.config.ts`](apps/frontend-blog/next.config.ts:156) headers 函数
**Cloudflare 规则**：Cloudflare Dashboard → Caching → Page Rules

#### 缓存头

```http
# HTML 页面 (所有 /:path*)
Cache-Control: public, max-age=3600, stale-while-revalidate=86400

# 静态资源 (/_next/static/*)
Cache-Control: public, max-age=31536000, immutable

# 字体 (/fonts/*)
Cache-Control: public, max-age=31536000, immutable
```

#### Edge TTL（Cloudflare 规则已配置）

| 匹配规则 | Edge TTL | Browser TTL |
|---------|----------|-------------|
| `blog.joyminis.com/*.(css|js|woff|...)` | 1 年 | 1 年 |
| `blog.joyminis.com/*` | 5 分钟 | 0 |

### 2.3 Browser Cache

由 `Cache-Control` 响应头控制。静态资源缓存 1 年（带 `immutable` 标记），HTML 页面由 CDN 和 KV 缓存处理。

---

## 3. KV 缓存 vs CDN 缓存的区别

| 特性 | KV ISR Cache | CDN Edge Cache |
|------|-------------|----------------|
| 位置 | Worker 内部 | Cloudflare 边缘节点 |
| 缓存对象 | 页面渲染结果 (React 组件树 → HTML) | HTTP 响应 (完整 headers + body) |
| 命中方式 | OpenNext 代码层面 `KV.get()` | Cloudflare 网络层面 |
| 命中所耗 | ~50-200ms (KV 读取) | ~1-10ms (边缘节点内存) |
| Miss 代价 | 需要重新渲染页面 (500ms-2s) | 请求转发到 Worker (~50ms) |
| 持久化 | 是（KV 持久存储） | 否（节点缓存，可能被逐出） |
| 适用场景 | 减少渲染次数 | 减少 Worker 调用次数 |

**两者配合**：用户请求 → Edge Cache (HIT: 直接返回) → Edge Cache (MISS) → Worker → KV Cache (HIT: 返回 HTML) → KV Cache (MISS) → 渲染页面 → 存 KV → 返回

---

## 4. 部署后验证

使用验证脚本一键验证：

```bash
chmod +x deploy/verify-blog-cache.sh

# 验证生产环境
bash deploy/verify-blog-cache.sh

# 验证预发布环境
bash deploy/verify-blog-cache.sh blog-dev.joyminis.com
```

### 手动验证命令

#### 4.1 Edge Cache 状态

```bash
# 查看 cf-cache-status
curl -sI https://blog.joyminis.com/en | grep -i "cf-cache-status"
# 预期: HIT / MISS / DYNAMIC
```

#### 4.2 Cache-Control 头

```bash
# HTML 页面
curl -sI https://blog.joyminis.com/en | grep -i "cache-control"
# 预期: public, max-age=3600, stale-while-revalidate=86400

# 静态资源（从 HTML 中提取一个 JS URL）
JS_URL=$(curl -s https://blog.joyminis.com/en | grep -oP '/_next/static/chunks/[^"]+\.js' | head -1)
curl -sI "https://blog.joyminis.com$JS_URL" | grep -i "cache-control"
# 预期: public, max-age=31536000, immutable
```

#### 4.3 KV ISR 响应时间

```bash
# 首次请求（渲染 + 存 KV，可能 500ms-2s）
time curl -so /dev/null https://blog.joyminis.com/en

# 等待 1 秒

# 二次请求（KV 读取，应 <200ms）
time curl -so /dev/null https://blog.joyminis.com/en
```

#### 4.4 压缩验证

```bash
curl -sI https://blog.joyminis.com/en | grep -i "content-encoding"
# 预期: zstd / br / gzip（Cloudflare 自动选择最优算法）
```

---

## 5. Cloudflare Dashboard 监控

### Worker Logs

1. 进入 [Cloudflare Dashboard](https://dash.cloudflare.com)
2. **Workers & Pages** → `lucky-blog-prod` → **Logs**
3. 查看请求日志，观察缓存读取记录

### KV 存储

1. **Workers & Pages** → **KV**
2. 选择 `ISR_CACHE` 命名空间
3. 查看缓存条目，键名以 `incremental-cache:` 开头

### 缓存统计

1. **Caching** → **Cache Analytics**
2. 查看带宽节省率、缓存命中率

---

## 6. 常见问题

### Q: 如何强制清除 KV 缓存？

重新部署会自动触发新缓存。如需要手动清理：

```bash
npx wrangler kv key delete --binding=NEXT_INC_CACHE_KV --preview "incremental-cache:/en"
# 或清空整个命名空间（谨慎操作）
# npx wrangler kv namespace delete --id=1fc88f516bcf4efa9a50bef6e2912405
```

### Q: 如何强制清除 CDN Edge 缓存？

```bash
# 通过 Cloudflare API 清除
curl -X POST "https://api.cloudflare.com/client/v4/zones/<ZONE_ID>/purge_cache" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"purge_everything":true}'
```

或在 Dashboard → **Caching** → **Purge Cache** → **Purge Everything**

### Q: 如何确认 KV 缓存确实在工作？

1. 首次访问一个页面，记录响应耗时（如 `/zh/articles/some-article`）
2. 等待 10 秒
3. 再次访问同一页面，如果时间明显缩短（如从 800ms 降至 80ms），说明 KV 缓存命中
4. 也可以在 Worker Logs 中查看是否有 `getCacheKey` 相关日志

### Q: 为什么 Edge Cache 显示 `DYNAMIC`？

Cloudflare 对 Workers 的响应默认标记为 `DYNAMIC`，表示需要回源验证。这不会影响实际缓存效果。`DYNAMIC` 的页面仍然会被 CDN 缓存，遵循 `Cache-Control` 头的 `max-age` 指令。

---

## 7. 变更历史

| 日期 | 变更 | 文件 |
|------|------|------|
| 2026-04-29 | 启用 OpenNext KV 增量缓存 | [`open-next.config.ts`](apps/frontend-blog/open-next.config.ts), [`wrangler.jsonc`](apps/frontend-blog/wrangler.jsonc) |
| 2026-04-28 | 配置 CDN Cache-Control 头 | [`next.config.ts`](apps/frontend-blog/next.config.ts) |
| 2026-04-20 | 初始部署，使用 dummy 缓存 | — |
