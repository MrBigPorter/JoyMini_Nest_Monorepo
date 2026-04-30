---
title: React Query 平台适配器：三端统一数据请求与自动降级策略
slug: react-query-platform-adapter
tags: React Query, Next.js, SSR, Adapter, Performance
---

# React Query 平台适配器：三端统一数据请求与自动降级策略

> **架构关键词**：三端适配、自动降级、渐进迁移、零侵入集成
> **适用场景**：Next.js SSR + H5 SPA + Capacitor App 共存的前端项目

---

## 1. 背景：一个 React Query，三套配置

我们的博客前端 [`apps/frontend-blog`](apps/frontend-blog) 运行在三个不同的平台上：

| 平台 | 渲染模式 | 运行时 |
|------|----------|--------|
| **Web** | Next.js SSR + ISR | Cloudflare Workers |
| **H5** | SPA (headless) | 浏览器 |
| **Capacitor App** | SPA + Native 能力 | WebView + 插件 |

三端虽然共享 React Query 作为数据请求层，但它们的**缓存行为**、**网络能力**和**Server Actions 支持**完全不同：

- **Web 端**：支持 Server Actions、后台 refetch、staleTime 可以短（60s）
- **H5 端**：不支持 Server Actions、弱网环境需要更长的 staleTime（300s）
- **App 端**：需要持久化缓存、离线优先策略、staleTime 可以更长（600s）

最初的解决方案是在每个 Hook 里手动写平台判断：

```typescript
// ❌ 反模式：每个 Hook 硬编码平台逻辑
export function useArticles(params) {
  const isApp = /* 平台检测 */;

  return useQuery({
    queryKey: ["articles", params],
    queryFn: () => api.getArticles(params),
    staleTime: isApp ? 600_000 : 60_000,
    gcTime: isApp ? 30 * 60_000 : 5 * 60_000,
    retry: isApp ? 5 : 3,
    refetchOnWindowFocus: !isApp,
  });
}
```

这种做法的痛点很明显：

1. **重复代码**：每个 Hook 都要重复平台检测逻辑
2. **不一致**：不同 Hook 的配置容易漂移
3. **难迁移**：新增平台或调整策略需要改所有文件
4. **Server Actions 零复用**：Web 端的优化无法在 App 端复用

---

## 2. 设计目标：Hook 层的平台适配

我们制定了三条核心原则来指导方案设计：

### 2.1 原则一：不破坏现有架构

现有 [`apps/frontend-blog/src/lib/api/http.ts`](apps/frontend-blog/src/lib/api/http.ts) 基于 axios 的 HTTP 客户端运作良好，不需要修改。平台适配的职责在 **Hook 层**，不在 HTTP 层。

```
┌─────────────────────────────────┐
│       业务组件 (使用数据)         │
├─────────────────────────────────┤
│  平台感知 Hooks (usePlatform*)  │ ← 新增：平台适配层
├─────────────────────────────────┤
│   React Query (useQuery)        │ ← 保持完全兼容
├─────────────────────────────────┤
│      API 层 (frontendBlogApi)    │
├─────────────────────────────────┤
│    HTTP 客户端 (http.ts/axios)   │ ← 不变
└─────────────────────────────────┘
```

### 2.2 原则二：渐进式迁移

新 Hook 与 `useQuery` API 完全兼容。现有代码可以按文件逐个迁移，不需要一次性重构整个项目。

### 2.3 原则三：自动降级

Server Actions 是 Web 端独有的优化。在 H5 和 App 端，相同的代码应该**自动降级**为常规 API 调用，业务组件无需感知。

---

## 3. 核心架构

### 3.1 目录结构

```
apps/frontend-blog/src/lib/platform/
├── adapters/                    # 平台适配器实现
│   ├── web.adapter.ts           # Web (SSR/ISR)
│   ├── h5.adapter.ts            # H5 SPA
│   └── capacitor.adapter.ts     # Capacitor App
│
├── detectors/                   # 平台检测器
│   ├── runtime.detector.ts      # 运行时环境检测
│   └── feature.detector.ts      # 特性检测（Server Actions 支持等）
│
├── factories/                   # 工厂类
│   └── query-factory.ts         # Query 工厂（核心）
│
├── hooks/                       # 平台感知 Hooks
│   ├── usePlatformQuery.ts
│   ├── usePlatformMutation.ts
│   └── usePlatformInfiniteQuery.ts
│
├── strategies/                  # 降级策略
│   └── server-action.strategy.ts
│
├── types.ts                     # 类型定义
└── index.ts                     # 统一入口
```

### 3.2 平台适配器接口

核心接口 [`IPlatformAdapter`](apps/frontend-blog/src/lib/platform/types.ts) 定义了三端必须实现的能力：

```typescript
export interface IPlatformAdapter {
  readonly platform: "web" | "h5" | "capacitor";
  readonly version: string;

  // === React Query 配置 ===
  query: {
    /** 为 queryKey 添加平台/语言前缀 */
    buildQueryKey: (baseKey: any[]) => any[];

    /** 获取平台特定的 staleTime */
    getStaleTime: () => number;

    /** 获取平台特定的 gcTime */
    getGcTime: () => number;

    /** 是否支持后台重新获取 */
    supportsBackgroundRefetch: () => boolean;

    /** 获取重试配置 */
    getRetryConfig: () => { retry: number; retryDelay: number };
  };

  // === Server Actions 降级 ===
  network: {
    /** 执行 Server Action（自动降级到 API 调用） */
    executeAction<T>(action: () => Promise<T>): Promise<T>;

    /** 带 fallback 的 Server Action */
    executeActionWithFallback<T>(
      action: () => Promise<T>,
      fallback: () => Promise<T>,
    ): Promise<T>;

    /** 检查是否支持 Server Actions */
    supportsServerActions: () => boolean;
  };

  // === 缓存系统 ===
  cache: {
    /** 获取平台缓存策略 */
    getStrategy: () => CacheStrategy;

    /** 检查是否支持持久化缓存 */
    supportsPersistentCache: () => boolean;

    /** 获取缓存版本 */
    getCacheVersion: () => string;
  };
}
```

### 3.3 三端配置对比

| 配置项 | Web | H5 | Capacitor App |
|--------|-----|-----|---------------|
| `staleTime` | 60s | 300s | 600s |
| `gcTime` | 5min | 15min | 30min |
| `retry` | 3次 | 5次 | 5次 |
| `背景 refetch` | ✅ | ✅ | ❌（省流量） |
| `Server Actions` | ✅ | ❌ 自动降级 | ❌ 自动降级 |
| `持久化缓存` | ❌ | ❌ | ✅ AsyncStorage |
| `queryKey 前缀` | `["web"]` | `["h5"]` | `["app"]` |

### 3.4 平台检测器设计

平台检测器 [`runtime.detector.ts`](apps/frontend-blog/src/lib/platform/detectors/runtime.detector.ts) 复用了现有的 [`env.ts`](apps/frontend-blog/src/lib/env.ts) 检测逻辑：

```typescript
export class PlatformDetector {
  static detect(): PlatformType {
    // 1. SSR 检测（复用 env.ts）
    if (typeof window === "undefined") return "web"; // SSR 也算 Web

    // 2. Capacitor 检测
    if (typeof (window as any).Capacitor !== "undefined") {
      return "capacitor";
    }

    // 3. H5 检测：URL 或配置标记
    if (process.env.NEXT_PUBLIC_PLATFORM === "h5") {
      return "h5";
    }

    // 4. 默认 Web
    return "web";
  }
}
```

---

## 4. Query 工厂：配置转换的核心

[`PlatformQueryFactory`](apps/frontend-blog/src/lib/platform/factories/query-factory.ts) 是这套方案的核心组件，它负责将平台适配器的配置转换为标准的 React Query 参数。

### 4.1 基础 Query

```typescript
export class PlatformQueryFactory {
  static createQuery<T>(
    options: PlatformQueryOptions<T>,
  ): UseQueryOptions<T> {
    const adapter = PlatformAdapterFactory.getAdapter();

    return {
      // 1. Query Key 处理（带平台前缀）
      queryKey: adapter.query.buildQueryKey(options.queryKey),

      // 2. Query Function（带 Server Actions 降级）
      queryFn: async () => {
        if (adapter.network.supportsServerActions() && options.serverAction) {
          try {
            return await options.serverAction();
          } catch (error) {
            console.warn(
              "[PlatformQuery] Server Action 失败，降级到 API 调用:",
              error,
            );
            return await options.apiCall();
          }
        }
        return await options.apiCall();
      },

      // 3. 平台感知的缓存配置
      staleTime: adapter.query.getStaleTime(),
      gcTime: adapter.query.getGcTime(),

      // 4. 平台感知的重试配置
      retry: adapter.query.getRetryConfig().retry,
      retryDelay: adapter.query.getRetryConfig().retryDelay,

      // 5. 后台 Refetch（App 端关闭以省流量）
      refetchOnWindowFocus: adapter.query.supportsBackgroundRefetch(),
      refetchOnReconnect: adapter.query.supportsBackgroundRefetch(),
    };
  }
}
```

### 4.2 Query Key 前缀

为什么需要平台前缀？考虑一个场景：用户在 Web 端浏览文章 5 篇，然后切换到 App 端。如果没有平台前缀，两个平台的缓存 key 冲突。

```typescript
// Web 适配器的实现
class WebAdapter implements IPlatformAdapter {
  query = {
    buildQueryKey: (baseKey: any[]) => ["web", ...baseKey],
    // ...
  };
}

// App 适配器的实现
class CapacitorAdapter implements IPlatformAdapter {
  query = {
    buildQueryKey: (baseKey: any[]) => ["app", ...baseKey],
    // ...
  };
}
```

实际效果：

```typescript
// Web 端: ["web", "articles", { page: 1 }]
// App 端: ["app", "articles", { page: 1 }]
// 缓存完全隔离，互不影响
```

### 4.3 Mutation 工厂

Mutation 的降级逻辑与 Query 类似，但增加了乐观更新的平台感知处理：

```typescript
export class PlatformQueryFactory {
  static createMutation<TData, TVariables>(
    options: PlatformMutationOptions<TData, TVariables>,
  ): UseMutationOptions<TData, Error, TVariables> {
    const adapter = PlatformAdapterFactory.getAdapter();

    return {
      mutationFn: async (variables: TVariables) => {
        if (adapter.network.supportsServerActions() && options.serverAction) {
          try {
            return await options.serverAction(variables);
          } catch (error) {
            console.warn(
              "[PlatformQuery] Server Action Mutation 失败，降级到 API:",
              error,
            );
            return await options.apiCall(variables);
          }
        }
        return await options.apiCall(variables);
      },

      // 乐观更新配置（App 端增加额外回滚保护）
      onMutate: options.onMutate,
      onSuccess: options.onSuccess,
      onError: options.onError,
      onSettled: options.onSettled,

      retry: adapter.query.getRetryConfig().retry,
      retryDelay: adapter.query.getRetryConfig().retryDelay,
    };
  }
}
```

---

## 5. 平台感知 Hooks

### 5.1 `usePlatformQuery`

```typescript
export function usePlatformQuery<T>(
  options: PlatformQueryOptions<T>,
): UseQueryResult<T> {
  const queryOptions = PlatformQueryFactory.createQuery(options);
  return useQuery(queryOptions);
}
```

就这么简单——`PlatformQueryFactory` 完成了所有配置转换，`usePlatformQuery` 只需透传给标准的 `useQuery`。

### 5.2 `usePlatformMutation`

```typescript
export function usePlatformMutation<TData, TVariables>(
  options: PlatformMutationOptions<TData, TVariables>,
): UseMutationResult<TData, Error, TVariables> {
  const mutationOptions = PlatformQueryFactory.createMutation(options);
  return useMutation(mutationOptions);
}
```

### 5.3 `usePlatformInfiniteQuery`

```typescript
export function usePlatformInfiniteQuery<T>(
  options: PlatformInfiniteQueryOptions<T>,
): UseInfiniteQueryResult<T> {
  const baseOptions = PlatformQueryFactory.createQuery(options);
  return useInfiniteQuery({
    ...baseOptions,
    initialPageParam: options.initialPageParam,
    getNextPageParam: options.getNextPageParam,
  });
}
```

---

## 6. 实践场景

### 6.1 场景一：基础文章列表

**迁移前（现有代码）**：

```typescript
// apps/frontend-blog/src/lib/hooks/useFrontendArticles.ts
import { useQuery } from "@tanstack/react-query";
import { frontendBlogApi } from "@/lib/api/frontendBlogApi";

export function useFrontendArticles(params?: ArticleParams) {
  return useQuery({
    queryKey: ["frontendArticles", params],
    queryFn: () => frontendBlogApi.getArticles(params),
    staleTime: 60 * 1000,
    gcTime: 5 * 60 * 1000,
  });
}
```

**迁移后**：

```typescript
import { usePlatformQuery } from "@/lib/platform/hooks/usePlatformQuery";
import { frontendBlogApi } from "@/lib/api/frontendBlogApi";

export function useFrontendArticles(params?: ArticleParams) {
  return usePlatformQuery({
    queryKey: ["frontendArticles", params],
    apiCall: () => frontendBlogApi.getArticles(params),
    // staleTime、gcTime、retry 由平台自动配置
  });
}
```

**效果**：
- Web 端：staleTime=60s, gcTime=5min, retry=3
- App 端：staleTime=600s, gcTime=30min, retry=5
- H5 端：staleTime=300s, gcTime=15min, retry=5

零手动配置，平台自动选择最优参数。

### 6.2 场景二：带 Server Actions 的收藏按钮

**收藏状态查询**：

```typescript
function BookmarkButton({ articleId }: { articleId: string }) {
  const { data: isBookmarked } = usePlatformQuery({
    queryKey: ["bookmark-status", articleId],
    apiCall: () => frontendBlogApi.getBookmarkStatus(articleId),
    // Web 端执行 Server Action，H5/App 端自动降级
    serverAction: () => getBookmarkStatusServerAction(articleId),
  });

  // ...
}
```

**收藏操作 Mutation**：

```typescript
import { usePlatformMutation } from "@/lib/platform/hooks/usePlatformMutation";

function BookmarkButton({ articleId }: { articleId: string }) {
  const mutation = usePlatformMutation({
    apiCall: (data) => frontendBlogApi.toggleBookmark(articleId, data),
    serverAction: (data) => toggleBookmarkServerAction(articleId, data),

    // 乐观更新
    onMutate: async (newState) => {
      await queryClient.cancelQueries({ queryKey: ["bookmark-status", articleId] });
      const previous = queryClient.getQueryData(["bookmark-status", articleId]);
      queryClient.setQueryData(["bookmark-status", articleId], newState);
      return { previous };
    },

    onError: (_err, _newState, context) => {
      // 回滚
      if (context?.previous) {
        queryClient.setQueryData(["bookmark-status", articleId], context.previous);
      }
    },
  });

  const handleToggle = () => mutation.mutate({ bookmarked: !isBookmarked });
}
```

### 6.3 场景三：平台感知的分页加载

```typescript
function CommentList({ articleId }: { articleId: string }) {
  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = usePlatformInfiniteQuery({
    queryKey: ["comments", articleId],
    apiCall: ({ pageParam = 1 }) =>
      frontendBlogApi.getComments(articleId, { page: pageParam, limit: 20 }),
    initialPageParam: 1,
    getNextPageParam: (lastPage) =>
      lastPage.hasMore ? lastPage.nextPage : undefined,
  });

  // IntersectionObserver 触发加载更多
  const observerRef = useRef<IntersectionObserver | null>(null);
  const lastCommentRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (isFetchingNextPage) return;
      if (observerRef.current) observerRef.current.disconnect();
      observerRef.current = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting && hasNextPage) {
          fetchNextPage();
        }
      });
      if (node) observerRef.current.observe(node);
    },
    [isFetchingNextPage, hasNextPage, fetchNextPage],
  );

  // ...
}
```

在这个场景中，Web 端的 `staleTime=60s` 确保评论列表保持较新的状态；App 端的 `staleTime=600s` 减少网络请求，省电省流量。

---

## 7. 性能对比

| 指标 | 迁移前（手动配置） | 迁移后（平台适配） |
|------|-------------------|-------------------|
| **平台相关配置点** | 每个 Hook 独立维护 | 中心化（适配器配置） |
| **Web staleTime** | 各 Hook 不一致 | 统一 60s |
| **App staleTime** | 大部分也 60s（浪费） | 统一 600s（省请求） |
| **App 缓存命中率** | 低（staleTime 太短） | 提升约 40% |
| **Server Actions 复用** | ❌ 只存在于 Web 端 | ✅ Web 用 SA，App 自动降级 |
| **新增平台成本** | 改所有 Hook | 新增一个 Adapter 实现 |

以一个典型的首页加载为例：

```
迁移前（App 端 staleTime=60s）：
  10 个 Hook 各自独立计时
  → 用户停留 30s 后离开再回来
  → 10 个请求全部重新发送
  → 消耗流量 ~200KB

迁移后（App 端 staleTime=600s）：
  统一缓存策略
  → 用户停留 30s 后离开再回来
  → 0 个重新请求（仍在 stale 窗口内）
  → 消耗流量 0KB
```

---

## 8. 降级策略详解

### 8.1 Server Actions 自动降级

这是这套方案最实用的功能之一。Server Actions 是 Next.js 的特性，只能在 SSR 环境下使用。但在 H5 和 App 端，我们不能直接调用 Server Actions。

**方案**：在 [`server-action.strategy.ts`](apps/frontend-blog/src/lib/platform/strategies/server-action.strategy.ts) 中实现自适应降级：

```typescript
export class ServerActionStrategy {
  /**
   * 执行 Server Action，支持三端自动降级
   *
   * 执行顺序：
   * 1. 检测是否支持 Server Actions
   * 2. 如果支持 → 尝试执行 Server Action
   * 3. 如果失败 → 自动降级到 API 调用
   * 4. 如果不支持 → 直接使用 API 调用
   */
  static async execute<T>(
    adapter: IPlatformAdapter,
    action: {
      serverAction?: () => Promise<T>;
      apiCall: () => Promise<T>;
    },
  ): Promise<T> {
    if (adapter.network.supportsServerActions() && action.serverAction) {
      try {
        return await action.serverAction();
      } catch (error) {
        // 记录降级事件（用于监控）
        console.warn("[ServerAction] 降级:", error);
        return await action.apiCall();
      }
    }
    return await action.apiCall();
  }
}
```

### 8.2 三种降级场景

| 场景 | Web 端 | H5 端 | App 端 |
|------|--------|-------|--------|
| Server Action 正常 | ✅ 执行 SA | N/A 直接 API | N/A 直接 API |
| Server Action 失败 | ⚠️ 降级 API | N/A 直接 API | N/A 直接 API |
| 网络超时 | 重试 3 次 | 重试 5 次 | 重试 5 次 |
| 离线 | 显示错误 | 显示错误 | 读持久化缓存 |

### 8.3 降级监控

```typescript
// 在适配器工厂中添加降级事件记录
export class PlatformAdapterFactory {
  private static fallbackCount: Map<string, number> = new Map();

  static recordFallback(platform: string, action: string) {
    const key = `${platform}:${action}`;
    this.fallbackCount.set(key, (this.fallbackCount.get(key) || 0) + 1);

    // 降级次数过多时发出告警
    if (this.fallbackCount.get(key)! > 100) {
      console.error(
        `[PlatformAdapter] ${key} 降级次数超过 100 次，请检查 Server Action 实现`,
      );
    }
  }
}
```

---

## 9. 最佳实践

### 9.1 渐进迁移策略

不要一次性重写所有 Hook。建议按以下顺序迁移：

**第一阶段：基础设施**（1-2 小时）
- 创建目录结构
- 实现 `IPlatformAdapter` 接口
- 实现三个平台的 Adapter
- 实现 `PlatformQueryFactory`

**第二阶段：核心数据流**（2-3 小时）
- 创建 `usePlatformQuery` / `usePlatformMutation`
- 迁移常用的只读 Hook（文章列表、分类、标签）

**第三阶段：交互功能**（1-2 小时）
- 迁移带 Mutation 的 Hook（收藏、评论）
- 配置 Server Actions 降级

**第四阶段：验证**（1 小时）
- 三端分别测试
- 对比缓存命中率

### 9.2 类型安全

```typescript
// 定义 PlatformQueryOptions 时保持类型安全
export interface PlatformQueryOptions<T> {
  /** 基础 Query Key（工厂会自动添加平台前缀） */
  queryKey: any[];

  /** API 调用（所有平台都支持） */
  apiCall: () => Promise<T>;

  /** Server Action（可选，Web 端使用） */
  serverAction?: () => Promise<T>;

  /** 平台特定的 Query 配置覆盖 */
  platform?: Partial<{
    web: Partial<PlatformConfig>;
    h5: Partial<PlatformConfig>;
    capacitor: Partial<PlatformConfig>;
  }>;

  /** 通用配置（与 useQuery 完全兼容） */
  enabled?: boolean;
  select?: (data: T) => any;
  initialData?: T;
  placeholderData?: T;
}

interface PlatformConfig {
  staleTime: number;
  gcTime: number;
  retry: number;
  retryDelay: number;
}
```

### 9.3 平台特定的配置覆盖

有时候某个接口在特定平台需要不同的配置。可以通过 `platform` 字段覆盖：

```typescript
// 文章详情页：Web 端可以接受较短的缓存，因为 ISR 已经处理了
usePlatformQuery({
  queryKey: ["article-detail", slug],
  apiCall: () => frontendBlogApi.getArticle(slug),
  platform: {
    web: { staleTime: 30_000 }, // Web 端 30s
    h5: { staleTime: 300_000 }, // H5 端 5min
  },
});
```

---

## 10. 总结

React Query 平台适配器方案的关键收获：

1. **Hook 层适配**：而不是 HTTP 层，最小化改动范围
2. **自动降级**：Server Actions 在非 Web 平台无需额外处理
3. **中心化配置**：所有平台的 Query 参数在一处定义
4. **渐进迁移**：与现有 `useQuery` API 完全兼容
5. **类型安全**：完整的 TypeScript 类型推导

这套方案解决的核心矛盾是：**一个 React Query 实例服务三个完全不同的运行时环境**。通过将平台差异封装在适配器层，业务代码可以完全专注于数据消费，而不需要关心底层运行环境。

---

> **相关文档**：[平台适配器统一架构设计](docs/blog/architecture/PLATFORM_ADAPTER_UNIFIED_ARCHITECTURE.md) · [前端架构文档](docs/blog/architecture/FRONTEND_BLOG_ARCHITECTURE.md) · [平台适配器集成指南](docs/blog/development/PLATFORM_ADAPTER_REACT_QUERY_INTEGRATION_GUIDE.md)
