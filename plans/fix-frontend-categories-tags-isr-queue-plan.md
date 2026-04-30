# 修复前端分类/标签页面不更新 + ISR Queue 配置

## 问题 1：分类/标签页面数据不更新

### 现象
- 管理员在后台新增分类/标签后，前端 `https://blog.joyminis.com/zh/tags/` 和 `https://blog.joyminis.com/zh/categories/` 页面上看不到
- 导航跳转进去有数据（SPA 路由），但刷新页面后数据为空
- Network 面板里没有 API 请求，只有 RUM

### 根因分析

**原因一：`force-static` 抑制了 SSR 重新渲染**

两个页面都配置了：
```tsx
export const dynamic = 'force-static';
```

`force-static` 让 Cloudflare Workers（通过 OpenNext）把这个页面当作纯静态 HTML 处理。构建时预渲染的 HTML 被永久缓存，后续任何请求都不触发 SSR 重新渲染。ISR 的 `revalidate` 被静默忽略。

**原因二：Cloudflare Workers 日志中报错**
```
"FatalError: Dummy queue is not implemented"
```

OpenNext 的 ISR 机制依赖 **Cloudflare Queue（消息队列）** 来异步重建过期的缓存页面。没有配置 Queue 时，OpenNext 使用 Dummy Queue（假队列），但 Dummy Queue 直接抛 `FatalError`，导致 ISR 重建永远失败。

### 修复

**修复一：删除 `force-static`（已完成）**

两个文件各删除了 `export const dynamic = 'force-static';`：

- `apps/frontend-blog/src/app/[locale]/categories/page.tsx`
- `apps/frontend-blog/src/app/[locale]/tags/page.tsx`

保留 `revalidate`（ISR）继续生效。

**修复二：配置 Cloudflare Queue（已完成）**

1. 创建 Queue：
   ```
   npx wrangler queues create next-revalidation-queue
   ```

2. 在 `apps/frontend-blog/wrangler.jsonc` 增加 Queue producer binding：
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

3. `npx wrangler deploy --dry-run` 验证 binding 生效：
   ```
   env.NEXT_QUEUE (next-revalidation-queue)    Queue
   ```

### 待完成

- 重新构建并部署：`yarn build && npx wrangler deploy --env production`

---

## 问题 2：Cloudflare error 1102（Worker CPU 超限）

### 现象
- 偶尔点击页面时出现 error 1102
- 日志显示 CPU 时间正常（5ms），但 wallTime 19ms

### 根因分析
- `Dummy queue is not implemented` 异常可能在某些请求下引发重试循环，打穿 Worker 资源
- Worker bundle 大小 6.8MB（gzip 2MB），接近 Cloudflare Workers 限制
- 配置了 `ENABLE_STREAMING: "true"` 和 `ENABLE_EDGE_MIDDLEWARE: "true"`，增加每次渲染的 CPU 消耗

### 待评估方案
- 配置 Queue 后观察 error 1102 是否消失
- 如仍有问题，考虑：
  - 禁用 `ENABLE_STREAMING` / `ENABLE_EDGE_MIDDLEWARE`
  - 升级 Workers Paid 计划（30s CPU 时间）
  - 优化 bundle 大小
