# Next.js 零骨架屏优化实战：ISR + 四层架构 + 平台感知缓存

> **架构关键词**：零骨架屏、四层架构、平台感知、ISR 按需缓存  
> **适用场景**：需要极致首屏加载体验的 Next.js 项目，跨平台统一架构

---

## 1. 引言：骨架屏本身就是一种"加载"

骨架屏（Skeleton Screen）被广泛认为是比 spinner 更好的加载体验。但仔细想想：

> **骨架屏仍然是"加载中"的另一种形式。** 用户看到骨架屏，说明内容还没准备好。

零骨架屏不是要消除"加载"这个过程，而是要通过 ISR + 缓存 + 服务端渲染的组合，让用户在绝大多数情况下根本**看不到加载状态**。

### 1.1 核心目标

| 目标 | 指标 |
|------|------|
| 骨架屏可见时间 | **0ms**（用户永远看不到骨架屏） |
| ISR 缓存命中率 | > 90% |
| FCP | < 800ms |
| LCP | < 1.0s |
| Lighthouse 评分 | > 90 |

---

## 2. 四层架构设计

零骨架屏架构分为四个层次，每一层解决一个特定的问题：

```
┌─────────────────────────────────────────────────────────┐
│ 第零层：平台感知层 (Platform Detector)                    │
│  运行时环境检测，动态选择最佳渲染策略                    │
├─────────────────────────────────────────────────────────┤
│ 第一层：服务端渲染层 (Server-Side Rendering)              │
│  ISR 60s + Edge Cache，99% 请求从边缘返回               │
├─────────────────────────────────────────────────────────┤
│ 第二层：混合渲染层 (Hybrid Rendering)                     │
│  服务端组件预取数据 + 客户端组件交互                     │
├─────────────────────────────────────────────────────────┤
│ 第三层：客户端体验层 (Client-Side Optimization)            │
│  智能预取 + 导航进度 + 平台差异化缓存                    │
└─────────────────────────────────────────────────────────┘
```

---

## 3. 第零层：平台感知层

不同平台有不同的缓存能力和限制。零骨架屏架构的第一步就是感知当前运行环境。

### 3.1 平台检测

```typescript
// lib/platform/detector.ts
export type Platform = "ssr" | "web" | "capacitor" | "h5";

export function detectPlatform(): Platform {
  if (typeof window === "undefined") return "ssr";
  if ("Capacitor" in window) return "capacitor";
  if (navigator.standalone) return "h5";
  return "web";
}
```

### 3.2 策略矩阵

| 平台 | 数据策略 | 缓存机制 | 更新机制 |
|------|----------|----------|----------|
| **Web (SSR)** | 直接获取 | ISR 60s + Edge Cache | 后台静默重新验证 |
| **Capacitor App** | **缓存优先** | SQLite + Preferences | 静默推送更新 |
| **H5 (移动端)** | 内存缓存 | SessionStorage | 用户触发更新 |

**核心逻辑**：

```
请求数据
    │
    ├── SSR ──→ 直接获取 → ISR 缓存 → 返回内容
    │
    ├── Capacitor ──→ 检查 SQLite 缓存
    │                     ├── 有缓存 → 立即返回 → 后台静默更新
    │                     └── 无缓存 → 获取 → 写入缓存 → 返回
    │
    └── H5 ──→ 检查 SessionStorage
                      ├── 有缓存 → 返回 → 后台更新
                      └── 无缓存 → 获取 → 写入 → 返回
```

---

## 4. 第一层：服务端渲染层

这是零骨架屏最核心的一层。通过 ISR + 边缘缓存的组合，让页面在用户访问前就已经准备好。

### 4.1 ISR 60s 策略

```typescript
// app/[locale]/page.tsx
// 按需 ISR：构建时不生成，首次访问后缓存
export const dynamic = "force-dynamic";
export const revalidate = 60;

export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  // 服务端直接获取数据
  const articles = await getArticles({ lang: locale, page: 1, pageSize: 10 });

  return <HomePageClient initialData={articles} locale={locale} />;
}
```

**为什么 `force-dynamic` + `revalidate` 能实现零骨架屏？**

```
首次部署后，用户 A 访问首页
       │
       ▼
force-dynamic: 跳过构建时生成
       │
       ▼
实时渲染首页（~200ms） → 用户 A 等待（但仅此一次）
       │
       ▼
revalidate=60: 渲染结果被缓存
       │
       ▼
接下来 3599 个用户（在 60 秒内）→ 直接命中缓存 → <10ms 响应
       │
       ▼
60 秒后第一个用户 → 触发后台重新验证
                    → 用户立即拿到旧缓存（stale-while-revalidate）
                    → 后台静默生成新缓存
       │
       ▼
✅ 99% 的用户看不到任何加载状态
```

### 4.2 三重缓存组合

```typescript
// 配置三重缓存
export const dynamic = "force-dynamic";
export const revalidate = 60;

export async function generateHeaders() {
  return {
    "Cache-Control": "public, s-maxage=60, stale-while-revalidate=86400",
  };
}
```

| 配置 | 缓存层级 | 缓存时间 |
|------|----------|----------|
| `revalidate = 60` | Next.js 服务器缓存 | 60 秒 |
| `s-maxage=60` | Cloudflare 全球边缘缓存 | 60 秒 |
| `stale-while-revalidate=86400` | Cloudflare 后台静默更新 | 24 小时 |

**99% 的请求**：Cloudflare 边缘节点直接返回 < 10ms
**0.9% 的请求**：Next.js 缓存返回 < 50ms
**0.1% 的请求**：真正到达源站执行 ~200ms

---

## 5. 第二层：混合渲染层

### 5.1 服务端组件 + 客户端组件分工

```typescript
// 文件结构
app/[locale]/
├── page.tsx               # 服务端组件：数据获取 + ISR 配置
├── page.client.tsx        # 客户端组件：交互 + 动态更新
└── components/
    ├── ArticleList.server.tsx  # 服务端：渲染文章列表 HTML
    └── ArticleList.client.tsx  # 客户端：滚动加载 + 交互
```

### 5.2 初始数据传递

```typescript
// page.tsx (服务端组件)
export default async function HomePage({ params }) {
  const { locale } = await params;

  // 服务端预取数据
  const initialData = await getArticles({
    lang: locale,
    page: 1,
    pageSize: 10,
  });

  // 传递给客户端组件作为初始数据
  return <HomePageClient initialData={initialData} locale={locale} />;
}
```

```typescript
// page.client.tsx (客户端组件)
"use client";

import { useQuery } from "@tanstack/react-query";

export function HomePageClient({
  initialData,
  locale,
}: {
  initialData: ArticleListResponse;
  locale: string;
}) {
  const { data } = useQuery({
    queryKey: ["homeArticles", locale],
    queryFn: () => getArticles({ lang: locale, page: 1, pageSize: 10 }),
    initialData,          // ⭐ 使用服务端预取的数据作为初始值
    staleTime: 60_000,    // 60 秒内不过期（与 ISR 一致）
  });

  return <ArticleList articles={data?.items || []} />;
}
```

**关键**：`initialData` 确保了 React Query 在首次渲染时有数据可显示，不需要显示 loading 状态。`staleTime` 与 ISR 的 `revalidate` 保持一致，避免了 60 秒内的重复请求。

---

## 6. 第三层：客户端体验层

### 6.1 智能预取

```typescript
// 利用 Next.js 的 <Link> prefetch 功能
import Link from "next/link";

// 默认 prefetch 视口内的链接
<Link href="/articles/some-slug" prefetch={true}>
  查看文章
</Link>
```

Next.js 会在链接进入视口时自动预取页面数据，用户点击时页面内容已缓存。

### 6.2 导航进度指示

使用微进度条代替全屏骨架屏，给用户一个极简的视觉反馈：

```typescript
// 使用 NProgress 或自定义进度条
"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import NProgress from "nprogress";

export function NavigationProgress() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    NProgress.start();
    // 页面加载完成后自动完成
    const timeout = setTimeout(() => NProgress.done(), 300);
    return () => clearTimeout(timeout);
  }, [pathname, searchParams]);

  return null;
}
```

### 6.3 显示决策树

```
页面加载
    │
    ├── 已有初始数据（服务端预取）？
    │       ├── 是 → 直接显示内容（后台静默更新）
    │       └── 否 → 继续检查
    │
    ├── 平台缓存中有数据？
    │       ├── 是 → 显示缓存数据（后台静默更新）
    │       └── 否 → 继续检查
    │
    ├── 正在加载？
    │       ├── 是 → 显示骨架屏（尽可能小的区域）
    │       └── 否 → 显示错误/空状态
    │
    └── 始终不显示骨架屏的场景：
            ├── 导航栏、底部导航等布局组件
            ├── 静态内容（标题、描述）
            └── 用户交互组件（搜索框、筛选器）
```

---

## 7. App 端缓存架构

对于 Capacitor App，ISR 不可用，需要使用本地持久化缓存来替代。

### 7.1 分层存储策略

| 数据类型 | 存储方案 | 理由 |
|----------|----------|------|
| 文章列表 | SQLite | 支持分页、搜索、过滤 |
| 文章详情 | SQLite | 结构化数据、支持离线阅读 |
| 用户设置 | Preferences | 简单键值对、频繁读写 |
| 收藏状态 | SQLite | 关系型数据、支持复杂查询 |

### 7.2 App 端数据流程

```
App 启动
    │
    ▼
检查 SQLite 缓存
    │
    ├── 有缓存 → 立即显示（零等待）
    │               │
    │               ▼
    │       后台静默请求最新数据
    │               │
    │               ├── 有更新 → 写入缓存 → 更新 UI
    │               └── 无更新 → 保持现有 UI
    │
    └── 无缓存 → 发起网络请求
                    │
                    ▼
                写入 SQLite 缓存
                    │
                    ▼
                显示内容（仅此一次等待）
```

---

## 8. 简化方案 vs 平台感知架构

在实际实施中，存在两种架构选择。需要根据项目情况决定。

### 8.1 平台感知架构（完整版）

```typescript
// 4 层抽象：适配器 + 服务 + 工厂 + Hook
const initialData = await getPlatformArticles({
  locale,
  page: 1,
  pageSize: 10,
});
const { data } = usePlatformArticlesInfiniteQuerySimple({ initialData });
```

**适用场景**：
- 需要跨平台统一缓存策略（Web SSR + Capacitor App + H5）
- 有复杂的平台特定优化需求
- 团队熟悉并维护该架构

### 8.2 简化方案（推荐）

```typescript
// 1 层：直接 API 调用 + React Query 原生缓存
const initialData = await frontendBlogApi.getArticles({
  lang: locale,
  page: 1,
  pageSize: 10,
});

const { data } = useQuery({
  queryKey: useLocalizedQueryKey("homeArticles", { page: 1 }),
  queryFn: () =>
    frontendBlogApi.getArticles({
      lang: currentLocale,
      page: 1,
      pageSize: 10,
    }),
  initialData, // 服务端预取数据
});
```

**适用场景**：
- 主要运行在 Web 平台
- 需要快速开发和维护
- React Query 原生缓存已足够
- 避免过度抽象破坏缓存机制

### 8.3 架构演进警告

> 过度复杂的平台感知架构可能破坏 React Query 的缓存机制。如果简化方案能满足需求，优先选择简化方案。

---

## 9. 实施路线图

### 第一阶段：核心架构（本周，4 小时）

| 任务 | 时间 | 说明 |
|------|------|------|
| 创建服务端组件架构 | 1h | `page.tsx` 服务端组件 + ISR 配置 |
| 实现平台感知数据服务 | 1h | `data.service.ts` 平台差异化策略 |
| 修改骨架显示逻辑 | 1h | 显示决策树实现 |
| 本地测试验证 | 1h | 验证骨架屏可见时间 = 0ms |

### 第二阶段：扩展优化（下周）

| 任务 | 说明 |
|------|------|
| 文章详情页 | 服务端组件迁移 + ISR 缓存 |
| 分类页面 | ISR 缓存优化 |
| 搜索页面 | 平台感知搜索实现 |

### 第三阶段：监控完善（下月）

| 任务 | 说明 |
|------|------|
| 性能监控 | ISR 命中率、加载时间追踪 |
| 错误处理 | 优雅降级、回滚机制 |
| A/B 测试 | 新旧版本对比验证 |

---

## 10. 成功指标与验收

### 关键指标

| 指标 | 目标值 | 测量方式 |
|------|--------|----------|
| 骨架屏可见时间 | **0ms** | Performance Observer |
| ISR 缓存命中率 | > 90% | Cloudflare Analytics |
| FCP | < 800ms | Lighthouse |
| LCP | < 1.0s | Lighthouse |
| Lighthouse 评分 | > 90 | Lighthouse CI |

### 验收检查清单

- [ ] 页面刷新直接显示内容，无骨架屏闪烁
- [ ] 导航切换无全屏加载状态
- [ ] 导航/布局等静态组件从不显示骨架
- [ ] `force-dynamic` + `revalidate` 正确配置
- [ ] 三重缓存头正确设置
- [ ] 服务端组件正确预取数据传递给客户端
- [ ] App 端 SQLite 缓存正常工作
- [ ] 降级场景（无缓存、网络慢）优雅处理

---

## 11. 关键决策点

### 架构选择
- ✅ **混合渲染**：服务端组件 + 客户端交互
- ❌ **纯服务端**：失去客户端交互能力
- ❌ **纯客户端**：无法利用 ISR 缓存

### 缓存策略
- ✅ **平台差异化**：Web ISR / App 持久化 / H5 内存
- ❌ **统一缓存**：无法发挥各平台优势

### 迁移策略
- ✅ **渐进迁移**：首页先行，逐步扩展
- ❌ **一次性迁移**：风险高，回滚困难

---

## 12. 总结

零骨架屏的核心不是"不用骨架屏"，而是**让骨架屏没有出现的必要**。

```
零骨架屏 = ISR 按需缓存 + 边缘 CDN + 服务端预取 + 平台差异化
```

| 层 | 技术 | 效果 |
|----|------|------|
| 平台感知 | `detectPlatform()` | 差异化策略 |
| SSR 渲染 | `force-dynamic` + `revalidate` + 三重缓存 | 99% 请求 < 10ms |
| 混合渲染 | Server Component + Client Component | 服务端预取数据 |
| 客户端体验 | 智能预取 + 导航进度 | 视觉零等待 |

**什么时候需要这套方案？**

- ✅ 博客、新闻、内容型网站
- ✅ 需要跨平台统一体验（Web + App）
- ✅ LCP 和 FCP 是核心优化指标
- ✅ 用户对首屏速度要求高

**什么时候不需要？**

- ❌ 内部管理系统（用户接受加载等待）
- ❌ 简单落地页（无需缓存策略）
- ❌ 全静态站点（构建时已生成所有页面）

---

*本文基于实践总结，相关源码参考 [`apps/frontend-blog/src/worker.ts`](apps/frontend-blog/src/worker.ts)（边缘缓存实现）和 [`apps/frontend-blog/open-next.config.ts`](apps/frontend-blog/open-next.config.ts)（OpenNext 配置）。*
