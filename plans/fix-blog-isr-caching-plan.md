# blog.joyminis.com ISR 缓存修复计划

## 现状

当前 [`open-next.config.ts`](apps/frontend-blog/open-next.config.ts) 使用 `incrementalCache: 'dummy'`，导致 ISR（增量静态再生）没有持久化存储，每次请求都经过完整 SSR 渲染。

| 组件 | 当前状态 | 问题 |
|---|---|---|
| [`open-next.config.ts`](apps/frontend-blog/open-next.config.ts:8) | `incrementalCache: 'dummy'` | 缓存不持久化到 KV |
| [`wrangler.jsonc`](apps/frontend-blog/wrangler.jsonc:36) KV 绑定 | `CACHE` / `ISR_CACHE` | 存在但未被 OpenNext 使用 |
| [`wrangler.jsonc`](apps/frontend-blog/wrangler.jsonc:4) worker 入口 | `.open-next/worker.js` | ✅ 正确，不需要改 |
| [`src/worker.ts`](apps/frontend-blog/src/worker.ts) 自定义 worker | 750 行但未激活 | 不需要了，用官方模块 |
| 页面 `revalidate` 导出 | 首页 60s / 文章 3600s | 已设置，但 dummy 缓存不生效 |

---

## 解决方案

利用 OpenNext Cloudflare **自带的 KV 增量缓存模块**，不需要写任何自定义代码。

OpenNext 已提供：
- [`@opennextjs/cloudflare/overrides/incremental-cache/kv-incremental-cache`](node_modules/@opennextjs/cloudflare/dist/api/overrides/incremental-cache/kv-incremental-cache.d.ts) — KV 增量缓存
- [`@opennextjs/cloudflare/overrides/tag-cache/kv-next-tag-cache`](node_modules/@opennextjs/cloudflare/dist/api/overrides/tag-cache/kv-next-tag-cache.d.ts) — KV 标签缓存

只需要：
1. 在 `wrangler.jsonc` 中添加 OpenNext 所需的 KV binding（名为 `NEXT_INC_CACHE_KV`）
2. 改 `open-next.config.ts`，引入官方模块替代 `'dummy'`

---

## 执行步骤

### Step 1：更新 [`open-next.config.ts`](apps/frontend-blog/open-next.config.ts)

```diff
- import { defineCloudflareConfig } from '@opennextjs/cloudflare';
+ import { defineCloudflareConfig } from "@opennextjs/cloudflare";
+ import kvIncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/kv-incremental-cache";
+ import kvTagCache from "@opennextjs/cloudflare/overrides/tag-cache/kv-next-tag-cache";

 export default defineCloudflareConfig({
-   incrementalCache: 'dummy',
-   tagCache: 'dummy',
-   queue: 'dummy',
+   incrementalCache: kvIncrementalCache,
+   tagCache: kvTagCache,
+   queue: 'dummy',  // queue 保持 dummy，暂时不需要
 });
```

### Step 2：更新 [`wrangler.jsonc`](apps/frontend-blog/wrangler.jsonc)

OpenNext KV 缓存模块需要一个名为 `NEXT_INC_CACHE_KV` 的 KV binding。在现有 KV 列表中添加：

```diff
  "kv_namespaces": [
    {
      "binding": "CACHE",
      "id": "e984df0553f24241850af22d7621faa4",
      "preview_id": "e984df0553f24241850af22d7621faa4"
    },
    {
      "binding": "ISR_CACHE",
      "id": "1fc88f516bcf4efa9a50bef6e2912405",
      "preview_id": "1fc88f516bcf4efa9a50bef6e2912405"
-   }
+   },
+   {
+     "binding": "NEXT_INC_CACHE_KV",
+     "id": "1fc88f516bcf4efa9a50bef6e2912405",
+     "preview_id": "1fc88f516bcf4efa9a50bef6e2912405"
+   }
  ],
```

> `NEXT_INC_CACHE_KV` 复用现有的 `ISR_CACHE` KV namespace（id: `1fc88f516bcf4efa9a50bef6e2912405`），只是绑定名不同。OpenNext 模块会自动加上 `incremental-cache:` 前缀，和现有数据不会冲突。

### Step 3：构建并部署

```bash
cd apps/frontend-blog
yarn exec opennextjs-cloudflare build
yarn exec opennextjs-cloudflare deploy
```

### Step 4：验证

```bash
# 首次访问 - 应该 miss，然后写入 KV
curl -I https://blog.joyminis.com/en

# 再次访问 - 应该从 KV 缓存提供
curl -I https://blog.joyminis.com/en

# 检查响应头
# 应该有 CF-Cache-Status: HIT（CDN 缓存）
# OpenNext ISR 在后台工作，KV 命中不直接反映在响应头中
```

---

## 预期效果

| 指标 | 优化前 | 优化后 |
|---|---|---|
| 首次访问（同 URL） | 完整 SSR ~200-500ms | 完整 SSR ~200-500ms（仍然需要渲染一次写入 KV） |
| 重复访问（60s 内） | 完整 SSR ~200-500ms | KV 读取 ~10-20ms |
| 跨 Worker 实例 | 每次都 SSR | KV 持久化，任何实例都能读取 |
| Cold Start | 完整 SSR | KV 缓存命中，几乎无冷启动成本 |

---

## 原理说明

```
用户请求 → Cloudflare 边缘
     ↓
OpenNext Worker
     ↓
KVIncrementalCache.get(key)
     ↓
  ┌── KV 有缓存且未过期？──→ 直接返回缓存的 HTML ←── 最快路径
  │
  └── KV 无缓存或已过期？
           ↓
        Next.js SSR 渲染
           ↓
        KVIncrementalCache.set(key, html, ttl)
           ↓
        返回 HTML → Cloudflare CDN 缓存 1h
```

**两层缓存协同工作：**
1. **KV 缓存**（ISR 层）：OpenNext 内部，按 `revalidate` 时间控制，跨 Worker 实例持久化
2. **CDN 缓存**（边缘层）：Cloudflare 边缘节点，按 `Cache-Control: max-age=3600` 控制，就近提供

---

## 回滚方案

如果出现问题，恢复原状只需两步：

1. 改回 [`open-next.config.ts`](apps/frontend-blog/open-next.config.ts)：
   ```ts
   incrementalCache: 'dummy',
   tagCache: 'dummy',
   ```

2. 从 [`wrangler.jsonc`](apps/frontend-blog/wrangler.jsonc) 移除 `NEXT_INC_CACHE_KV` binding

3. 重新部署
