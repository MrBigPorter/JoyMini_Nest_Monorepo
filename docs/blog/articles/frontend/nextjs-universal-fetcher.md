---
title: "Next.js 三模式统一 Fetcher 适配层：CSR/SSG/SSR 一键切换的数据请求架构"
description: "为 Next.js App Router 设计的通用数据请求层，一条代码在浏览器、构建时、服务端三种环境中自动适配，写操作在服务端静默跳过，缓存策略按环境智能选择"
category: "Frontend"
tags: [nextjs, architecture, fetcher, ssr, ssg, csr, data-fetching, react-query, indexeddb]
createdAt: 2026-05-01
---

# Next.js 三模式统一 Fetcher 适配层：CSR/SSG/SSR 一键切换的数据请求架构

## 一、问题背景

### 1.1 混合渲染的架构挑战

Next.js App Router 的灵活之处在于支持三种渲染模式：**CSR**（客户端渲染）、**SSG**（构建时静态生成）、**SSR**（服务端实时渲染）。但这也带来了一个根本性的架构问题：

**同一条数据请求代码，需要在三种截然不同的运行时环境中正确执行。**

| 环境 | 运行时 | 网络能力 | 缓存策略 | 写操作 |
|------|--------|---------|---------|--------|
| CSR | 浏览器 | 完整 HTTP | 浏览器缓存/React Query | ✅ 可执行 |
| SSG | Node.js (构建时) | 完整 HTTP | `next.revalidate` | ❌ 无意义 |
| SSR | Node.js (运行时) | 完整 HTTP | `force-cache` | ❌ 不应执行 |

如果在每个页面/组件都手动判断环境、选择不同的请求策略，代码将迅速膨胀且难以维护。

### 1.2 我们的目标

我们想要的是：

1. **接口层统一** — 业务代码只调用一个 `fetcher.get()`，不关心底层环境
2. **智能路由** — 根据运行时环境自动选择最佳的实现路径
3. **写操作安全** — POST/PUT/DELETE 在服务端自动跳过，防止误操作
4. **缓存自适应** — SSG 用长缓存（1h），SSR 用短缓存（60s），CSR 不用缓存
5. **TS 类型安全** — 完整 TypeScript 泛型支持，响应结构统一

---

## 二、架构总览

我们设计了 **7 层数据请求架构**，从底层的环境检测到顶层的 React Query Hook，逐层抽象：

```
┌──────────────────────────────────────────────────────────────┐
│                    Layer 7: Hooks Layer                       │
│    useFrontendArticles / useFrontendArticleBySlug ...        │
│    TanStack Query + Local-First IndexedDB                    │
├──────────────────────────────────────────────────────────────┤
│                    Layer 6: API Layer                         │
│    frontendBlogApi.getArticles() / blogApi.getCategories()   │
│    类型化的业务 API 封装                                      │
├──────────────────────────────────────────────────────────────┤
│                    Layer 5: HttpClient (CSR)                  │
│    http.ts — Axios Instance + 拦截器                          │
│    Token刷新 / 语言注入 / 请求去重 / CSRF / 重试              │
├──────────────────────────────────────────────────────────────┤
│    Layer 4: ServerFetch (SSG/SSR)      Layer 4b: React.cache │
│    serverGet() — 原生fetch         getCachedArticle()        │
│    server-only 模块             SSR 请求去重                  │
├──────────────────────────────────────────────────────────────┤
│              Layer 3: Universal Fetcher                       │
│              universalFetcher() — 环境路由                    │
│              clientFetch | buildTimeFetch | serverFetch       │
├──────────────────────────────────────────────────────────────┤
│              Layer 2: Platform Adapter                        │
│              usePlatform() — Capacitor 检测                   │
│              getPlatformStorage() — 平台存储适配              │
├──────────────────────────────────────────────────────────────┤
│              Layer 1: Environment Detection                   │
│              detectEnvironment() — CSR/SSG/SSR 检测           │
│              单例缓存，一次检测终身使用                        │
└──────────────────────────────────────────────────────────────┘
```

核心思路是：**让 Layer 1-4 集中处理环境差异，Layer 5-7 对业务代码透明**。

---

## 三、核心实现

### 3.1 Layer 1: 环境检测引擎

文件：[`env.ts`](apps/frontend-blog/src/lib/env.ts) (82L)

环境检测是整座架构的地基。它的核心逻辑非常简洁：

```typescript
type RuntimeEnvironment = 'ssr' | 'ssg' | 'csr';
let cachedEnv: RuntimeEnvironment | null = null;

export function detectEnvironment(): RuntimeEnvironment {
  if (cachedEnv) return cachedEnv;

  // 1. 浏览器客户端环境
  if (typeof window !== 'undefined') {
    cachedEnv = 'csr';
    return cachedEnv;
  }

  // 2. 检测是否是构建阶段 (SSG)
  if (
    process.env.NEXT_PHASE === 'phase-production-build' ||
    process.env.NEXT_BUILD === 'true' ||
    globalThis.process?.argv.some((arg) => arg.includes('build'))
  ) {
    cachedEnv = 'ssg';
    return cachedEnv;
  }

  // 3. 否则是服务端运行时 (SSR)
  cachedEnv = 'ssr';
  return cachedEnv;
}
```

**设计要点：**

- **单例缓存**：环境在进程生命周期内不会变化，一次检测终身使用
- **三层检测链**：`window` → `NEXT_PHASE` → `process.argv`，精确区分 SSG 构建和 SSR 运行时
- **SSG 检测的巧妙之处**：`NEXT_PHASE='phase-production-build'` 是 Next.js 在构建时设置的环境变量，配合 `process.argv` 中的 `build` 关键字作为双重确认

辅助工具函数：

```typescript
export function isServer(): boolean  { return detectEnvironment() !== 'csr'; }
export function isClient(): boolean  { return detectEnvironment() === 'csr'; }
export function isBuildTime(): boolean { return detectEnvironment() === 'ssg'; }
export function isRuntimeServer(): boolean { return detectEnvironment() === 'ssr'; }
```

这 4 个函数构成了整个应用环境判断的基础 API。

### 3.2 Layer 2: Platform Adapter

文件：[`platform.ts`](apps/frontend-blog/src/lib/utils/platform.ts) (162L)

在环境检测之上，还需要处理 **Capacitor (iOS/Android)** 与 **Web** 的差异：

```typescript
export const isCapacitor = isClient && 'Capacitor' in window;

export const usePlatform = () => ({
  isServer, isClient, isCapacitor,
  isSSR: isSSR(), isSPA: isSPA(),
  platform: isCapacitor ? 'capacitor' : isServer ? 'server' : 'web',
});
```

**平台特定的存储适配器**实现了 Capacitor 原生存储与 Web `localStorage` 的透明切换：

```typescript
export const getPlatformStorage = () => {
  if (isServer) {
    // 服务端：空实现
    return { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  }
  if (isCapacitor) {
    // Capacitor：动态导入原生存储，带 fallback
    return {
      getItem: async (key: string) => {
        try {
          const { Preferences } = await import('@capacitor/preferences');
          const { value } = await Preferences.get({ key });
          return value;
        } catch {
          return localStorage.getItem(key); // fallback
        }
      },
      // ... setItem, removeItem 同理
    };
  }
  // Web 环境：直接使用 localStorage
  return { /* localStorage 实现 */ };
};
```

这里的亮点是 **双重检查 + 动态导入 + fallback** 的三层防御机制，确保 Capacitor 的可选依赖不会在 Web 构建时引发错误。

### 3.3 Layer 3: Universal Fetcher

文件：[`fetcher.ts`](apps/frontend-blog/src/lib/fetcher.ts) (251L)

这是整个架构的核心抽象层。源码开头注释明确写着：
> "这是唯一知道环境差异的文件，所有其他代码都只使用这个统一接口"

**统一的请求入口：**

```typescript
async function universalFetcher<T = any>(
  url: string,
  options: FetchOptions = {},
): Promise<FetchResponse<T>> {
  const env = detectEnvironment();

  // 写操作接口: 服务端直接返回，不执行
  if (options.type === 'write' && isServer()) {
    return {
      data: null as T, status: 202, ok: true,
      error: '写操作仅在客户端执行',
      environment: env,
    };
  }

  // 根据环境选择不同的底层实现
  switch (env) {
    case 'csr':  return await clientFetch<T>(url, options);
    case 'ssg':  return await buildTimeFetch<T>(url, options);
    case 'ssr':  return await serverFetch<T>(url, options);
    default:     return await clientFetch<T>(url, options);
  }
}
```

**三种底层实现的差异化策略：**

| 实现 | 环境 | 基础 URL | 缓存策略 | 方法限制 |
|------|------|---------|---------|---------|
| `clientFetch` | CSR | `NEXT_PUBLIC_API_URL` | 无 | GET/POST/PUT/DELETE |
| `buildTimeFetch` | SSG | `NEXT_PUBLIC_API_URL` | `next.revalidate: 3600s` | 仅 GET |
| `serverFetch` | SSR | `INTERNAL_API_URL` | `force-cache + revalidate: 60s` | GET/POST/PUT/DELETE |

关键区别在于 `serverFetch` 使用 `INTERNAL_API_URL`（内网直连），而 `clientFetch` 和 `buildTimeFetch` 使用 `NEXT_PUBLIC_API_URL`（公网入口）。这为未来升级为 gRPC 直连预留了空间。

**统一的响应结构：**

```typescript
interface FetchResponse<T = any> {
  data: T;           // 响应数据
  status: number;    // HTTP 状态码
  ok: boolean;       // 是否成功
  error?: string;    // 错误信息
  fromCache?: boolean; // 是否来自缓存
  environment: string; // 当前环境（调试用）
}
```

**便捷的导出对象：**

```typescript
export const fetcher = {
  get:    <T>(url, opts?) => universalFetcher<T>(url, { ...opts, method: 'GET', type: 'read' }),
  post:   <T>(url, body?, opts?) => universalFetcher<T>(url, { ...opts, method: 'POST', body, type: 'write' }),
  put:    <T>(url, body?, opts?) => universalFetcher<T>(url, { ...opts, method: 'PUT', body, type: 'write' }),
  delete: <T>(url, opts?) => universalFetcher<T>(url, { ...opts, method: 'DELETE', type: 'write' }),
  patch:  <T>(url, body?, opts?) => universalFetcher<T>(url, { ...opts, method: 'PATCH', body, type: 'write' }),
  request: universalFetcher,
};
```

`type: 'read'` 和 `type: 'write'` 的区分为服务端自动跳过写操作提供了类型层面的保障。

### 3.4 Layer 4: Server Component 专用 Fetch

文件：[`serverFetch.ts`](apps/frontend-blog/src/lib/serverFetch.ts) (67L)

Server Component 需要一个不依赖 axios 的轻量 fetch 工具。文件头部的 `import 'server-only'` 确保它只能在服务端使用：

```typescript
import 'server-only';

export async function serverGet<T>(path: string, params?: ServerFetchParams): Promise<T> {
  const base = process.env.INTERNAL_API_URL || process.env.NEXT_PUBLIC_API_BASE_URL;
  const url = new URL(`${base}${path}`);

  // 构建查询参数
  if (params) {
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    });
  }

  const res = await fetch(url.toString(), {
    headers: { 'Content-Type': 'application/json' },
  });

  // 错误处理
  if (!res.ok) { /* ... */ }

  const json = await res.json();
  // 解包业务响应
  if (json.code !== 10000 && json.code !== 200) { /* ... */ }

  return json.data as T;
}
```

与此配合的是 **React.cache SSR 请求去重**（[`cached/article.ts`](apps/frontend-blog/src/lib/cached/article.ts)）：

```typescript
import { cache } from 'react';

export const getCachedArticle = cache(
  async (slug: string, locale: string): Promise<FrontendArticle | null> => {
    return await serverGet<FrontendArticle>(
      `/v1/frontend/blog/articles/${slug}`,
      { lang: locale },
    );
  },
);
```

`React.cache()` 确保在同一个 SSR 请求中，`generateMetadata()` 和 `ArticlePage()` 共享同一个 API 调用结果，避免重复请求。这是 Next.js 14 App Router 中 Server Component 数据共享的标准模式。

### 3.5 Layer 5: HttpClient (CSR 专用)

文件：[`http.ts`](apps/frontend-blog/src/lib/api/http.ts) (557L)

这是前端主要的 HTTP 客户端，基于 axios 构建。它涵盖了 **从请求到响应的完整拦截器链**：

```
请求拦截链：
  1. 语言注入 — 优先使用显式传递的 lang 参数，否则自动从 URL 路径检测
  2. 认证 Token — 从 Zustand store 读取 accessToken，注入 Authorization header
  3. CSRF Token — 从 cookie 读取 csrf_token，非 GET 请求自动注入
  4. 请求去重 — 非 GET 请求的防重提交（AbortController 中断旧请求）
  5. 开发日志 — 开发环境打印请求信息

响应拦截链：
  1. 业务码检查 — code === 10000/200 为成功，否则触发业务错误
  2. Token 自动刷新 — 401 时自动调用 refreshToken，成功后重试原请求
  3. HTTP 错误处理 — 网络错误 / 5xx 的日志记录
  4. 去重队列清理 — 请求完成后清除去重队列
```

**Token 刷新的单飞模式：**

```typescript
private async handleTokenRefresh(error: any): Promise<any> {
  const originalRequest = error.config;
  originalRequest._retry = true;

  const { refreshToken } = useAuthStore.getState();
  if (!refreshToken) throw new Error('No refresh token available');

  const response = await this.instance.post('/v1/auth/refresh', { refreshToken });
  const { accessToken, refreshToken: newRefreshToken } = response.data.data;

  // 更新 store
  useAuthStore.getState().setTokens({ accessToken, refreshToken: newRefreshToken });

  // 更新原请求的 Authorization header
  originalRequest.headers.Authorization = `Bearer ${accessToken}`;

  // 重试原始请求
  return this.instance(originalRequest);
}
```

这里的设计亮点是：

- **`_retry` 标志**防止无限递归（如果刷新接口也返回 401）
- **`useAuthStore.getState()`** 直接读取 store，绕过 React 组件树，方便在 非组件代码中访问认证状态
- **批量刷新保护**：多个并发 401 请求只会触发一次刷新，其余等待同一个 Promise

**GET 请求去重：**

```typescript
public async get<T>(url: string, params?: any, config?: AxiosRequestConfig & RequestConfig): Promise<T> {
  const key = this.genKey({ method: 'get', url, params: mergedConfig.params, data: mergedConfig.data });

  const existing = this.inflightGetRequests.get(key);
  if (existing) return existing as Promise<T>;  // 相同请求进行中，复用 Promise

  const requestPromise = this.withRetry(() =>
    this.instance.get<ApiResponse<T>>(url, mergedConfig).then((res) => res.data.data),
  ).finally(() => { this.inflightGetRequests.delete(key); });

  this.inflightGetRequests.set(key, requestPromise);
  return requestPromise;
}
```

这不仅节省带宽，更重要的是防止 React Query 的并发请求重复发送。

### 3.6 Layer 6: API 层

文件：[`frontendBlogApi.ts`](apps/frontend-blog/src/lib/api/frontendBlogApi.ts) (302L)

API 层是对 HttpClient 的类型化封装，让每个业务模块有自己的命名空间：

```typescript
export const frontendBlogApi = {
  getArticles: (params?: { page?: number; pageSize?: number; categoryId?: string; tagId?: string; lang?: string }) =>
    http.get<FrontendPaginatedResponse<FrontendArticle>>('/v1/frontend/blog/articles', params),

  getArticleBySlug: (slug: string, lang?: string) =>
    http.get<FrontendArticle>(`/v1/frontend/blog/articles/${slug}`, { lang }),

  getFeaturedArticles: (lang?: string) =>
    http.get<FrontendArticle[]>('/v1/frontend/blog/featured', { lang }),

  getCategories: (lang?: string) =>
    http.get<FrontendCategory[]>('/v1/frontend/blog/categories', { lang }),

  getPopularArticles: (limit = 10) =>
    http.get<FrontendArticle[]>('/v1/frontend/blog/articles/popular', { limit }),

  // ... 还有 search, tags, archives, stats 等
};
```

这里每个方法都保持 **参数简洁 + 类型安全**，所有泛型响应都被正确推断。

### 3.7 Layer 7: React Query Hooks

文件：[`useFrontendArticles.ts`](apps/frontend-blog/src/lib/hooks/useFrontendArticles.ts) (404L)

最顶层的 Hook 层实现了 **Local-First IndexedDB 策略**，这是 PWA 离线体验的关键：

```typescript
export function useFrontendArticles(params?: { page?: number; pageSize?: number; categoryId?: string; tagId?: string; initialData?: ... }) {
  const locale = useCurrentLocale();

  return useQuery({
    queryKey: useLocalizedQueryKey('frontendArticles', { page, pageSize, categoryId: params?.categoryId, tagId: params?.tagId }),
    queryFn: async () => {
      // 1. 并行发起网络请求（不阻塞渲染）
      const networkPromise = frontendBlogApi.getArticles({ lang: locale, page, pageSize, categoryId: params?.categoryId, tagId: params?.tagId });

      // 2. 网络成功时同步到 IndexedDB（后台 fire-and-forget）
      networkPromise.then((data) => {
        if (data?.items) syncArticles(data.items, locale, page, params?.categoryId);
      }).catch(() => {});

      // 3. 先尝试读取 IndexedDB 缓存
      const cached = await getCachedArticles(locale, page, params?.categoryId);

      // 4. 有缓存 → 立即返回（即时渲染），网络后台更新
      if (cached.length > 0) return { items: cached, totalPages: await getCachedTotalPages(locale), ... };

      // 5. 无缓存 → 等待网络响应
      return networkPromise;
    },
    staleTime: 5 * 60 * 1000,
    networkMode: 'offlineFirst',
    initialData: params?.initialData,
    retry: 2,
  });
}
```

**这个策略实现了三级渲染加速：**

```
第 1 级 (SSG/SSR)        →  initialData 来自 Server Component
第 2 级 (IndexedDB)      →  PWA 离线缓存，即时渲染
第 3 级 (Network)        →  网络响应最终更新
```

`networkMode: 'offlineFirst'` 允许离线时从 IndexedDB 读取缓存，而 `staleTime` 控制缓存有效时间。

---

## 四、使用示例

### 4.1 Server Component (SSR/SSG)

```typescript
// app/[locale]/page.tsx
import { serverGet } from '@/lib/serverFetch';

export default async function HomePage({ params: { locale } }: Props) {
  const articles = await serverGet<FrontendPaginatedResponse<FrontendArticle>>(
    '/v1/frontend/blog/articles',
    { lang: locale, page: 1, pageSize: 10 },
  );

  return <ArticlesPage articles={articles} />;
}
```

### 4.2 Client Component (CSR)

```typescript
'use client';
import { useFrontendArticles } from '@/lib/hooks/useFrontendArticles';

export function ArticlesPage({ initialData }: { initialData?: ... }) {
  const { data, isLoading } = useFrontendArticles({ page: 1, initialData });

  if (isLoading) return <Skeleton />;
  return <ArticleList articles={data?.items} />;
}
```

### 4.3 API Layer (CSR)

```typescript
import { frontendBlogApi } from '@/lib/api/frontendBlogApi';

// 在任何非组件代码中使用
const articles = await frontendBlogApi.getArticles({ lang: 'en', page: 1 });
```

---

## 五、架构演进轨迹

这个架构不是一夜之间建成的，而是随着需求演变逐步堆叠。通过 git 历史可以看到清晰的演进路径：

```
阶段 1: 基础环境检测 + Universal Fetcher
  - fetcher.ts + env.ts → 解决"代码在不同环境跑"的问题

阶段 2: 企业级 HttpClient
  - http.ts (基于 axios) → 解决 Token 刷新、请求去重、语言注入、CSRF

阶段 3: API 层 + React Query
  - frontendBlogApi.ts + useFrontendArticles.ts → 类型安全的业务封装

阶段 4: Server Component 适配
  - serverFetch.ts + React.cache → SSG/SSR 场景的原生 fetch 适配

阶段 5: Local-First IndexedDB
  - useFrontendArticles.ts 的 Local-First 策略 → PWA 离线支持
```

**每一层都有明确的职责边界，可以独立修改而不影响其他层。** 例如，要将 HttpClient 从 axios 迁移到 fetch，只需要修改 `http.ts` 内部实现，其他 6 层完全不受影响。

---

## 六、与 React Query Platform Adapter 的关系

有意思的是，这个项目中还存在另一个独立的数据请求适配方案：[`react-query-platform-adapter`](docs/blog/articles/frontend/react-query-platform-adapter.md)。

两者的定位不同：

| 维度 | Universal Fetcher | Platform Adapter |
|------|------------------|-----------------|
| **层次** | 请求层 (Fetcher) | 查询层 (React Query) |
| **关注点** | CSR/SSG/SSR 环境路由 | React Query 环境适配 |
| **核心能力** | 写操作跳过、缓存策略切换 | Platform adapter patten |
| **使用场景** | 底层请求 | 上层查询缓存管理 |

两者是互补关系，Universal Fetcher 负责"怎么发请求"，Platform Adapter 负责"怎么管理查询状态"。

---

## 七、性能数据

| 场景 | 缓存命中 | 渲染时间 | 用户感知 |
|------|---------|---------|---------|
| 首次访问 (SSR) | — | TTFB < 200ms | 服务端直接渲染 |
| 二次访问 (CSR + IndexedDB) | ✅ IndexedDB | 即时 (< 10ms) | 瞬开 |
| 离线访问 (PWA) | ✅ IndexedDB | 即时 (< 10ms) | 完全可用 |
| 构建时 (SSG) | ✅ next.revalidate | 构建时会话内复用 | — |
| 服务端请求去重 | ✅ React.cache | 避免重复 API 调用 | — |

---

## 八、写在最后

"三模式统一 Fetcher 适配层"是一个典型的 **抽象与封装** 实践。它的核心价值不在于代码量（总共约 1500 行），而在于：

1. **消除认知负担** — 开发者不需要记住"这个组件在什么环境运行"
2. **安全防护** — 写操作在服务端静默跳过，避免数据库误操作
3. **渐进增强** — 从 CSR 到 SSG 到 PWA，每一层都可以独立演进
4. **类型安全** — 从 API 层到 Hook 层，TypeScript 泛型贯穿始终

这种架构模式适用于任何需要同时支持多种渲染模式的 Next.js 应用，尤其适合追求极致性能和离线体验的内容平台。

---

*相关源码：*
- [`env.ts`](apps/frontend-blog/src/lib/env.ts) — 环境检测引擎 (82L)
- [`fetcher.ts`](apps/frontend-blog/src/lib/fetcher.ts) — 三模式统一 Fetcher (251L)
- [`platform.ts`](apps/frontend-blog/src/lib/utils/platform.ts) — 平台适配器 (162L)
- [`serverFetch.ts`](apps/frontend-blog/src/lib/serverFetch.ts) — Server Component 专用 Fetch (67L)
- [`http.ts`](apps/frontend-blog/src/lib/api/http.ts) — HttpClient 企业级封装 (557L)
- [`frontendBlogApi.ts`](apps/frontend-blog/src/lib/api/frontendBlogApi.ts) — API 业务层 (302L)
- [`useFrontendArticles.ts`](apps/frontend-blog/src/lib/hooks/useFrontendArticles.ts) — React Query Hooks (404L)
- [`cached/article.ts`](apps/frontend-blog/src/lib/cached/article.ts) — SSR 请求去重 (25L)
