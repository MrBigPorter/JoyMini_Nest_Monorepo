# 平台适配器与React Query集成指南

> 🎯 **目标**: 将平台适配器架构集成到现有的React Query生态中
> 📅 **创建日期**: 2026-04-18
> 👨‍💻 **作者**: AI协作系统
> 📋 **状态**: ✅ 架构设计中

---

## 🔍 核心发现

### 项目现状分析

**实际技术栈**：

- ✅ **React Query (TanStack Query)**: 所有数据获取都通过 `useQuery`/`useMutation`
- ✅ **HTTP客户端**: `http.ts`（基于axios）作为底层HTTP实现
- ✅ **API层**: `frontendBlogApi.ts` 封装具体接口
- ✅ **Hooks层**: `useFrontendArticles.ts` 等封装React Query逻辑

**未使用组件**：

- ❌ **`fetcher.ts`**: 多模式适配器设计，但未被使用
- ❌ **直接fetch调用**: 项目中没有直接使用fetch

### 架构演进路径

```
1. 早期设计: fetcher.ts（多模式适配器） ← 未实施
2. 实际实施: http.ts（axios封装） + React Query
3. 当前状态: 完整的React Query生态，fetcher.ts被废弃
```

---

## 🎯 设计目标

### 核心原则

1. **不破坏现有架构**: 保持React Query + axios的技术栈
2. **平台适配在Hook层**: 而不是HTTP层
3. **渐进式迁移**: 可以逐步将现有Hook迁移到平台感知版本
4. **保持兼容**: 新Hook应该与现有useQuery API兼容

### 架构对比

**现有架构**：

```
┌─────────────────────────────────┐
│       业务组件 (使用数据)         │
├─────────────────────────────────┤
│   React Query Hooks (useQuery)  │
├─────────────────────────────────┤
│      API层 (frontendBlogApi)     │
├─────────────────────────────────┤
│    HTTP客户端 (http.ts/axios)    │
└─────────────────────────────────┘
```

**新架构（平台适配器集成）**：

```
┌─────────────────────────────────┐
│       业务组件 (使用数据)         │
├─────────────────────────────────┤
│  平台感知Hooks (usePlatformQuery)│ ← 新增：平台适配层
├─────────────────────────────────┤
│   React Query Hooks (useQuery)  │ ← 保持兼容
├─────────────────────────────────┤
│      API层 (frontendBlogApi)     │
├─────────────────────────────────┤
│    HTTP客户端 (http.ts/axios)    │
└─────────────────────────────────┘
```

---

## 🏗️ 架构设计

### 目录结构

```
apps/frontend-blog/src/lib/platform/
├── adapters/                    # 🔹 平台适配器实现
│   ├── web.adapter.ts           # Web平台适配器
│   ├── h5.adapter.ts            # H5平台适配器
│   └── capacitor.adapter.ts     # App平台适配器
│
├── detectors/                   # 🔹 平台检测器
│   ├── runtime.detector.ts      # 运行时检测
│   └── feature.detector.ts      # 特性检测
│
├── factories/                   # 🔹 工厂类
│   ├── adapter-factory.ts       # 适配器工厂
│   └── query-factory.ts         # Query工厂（核心）
│
├── hooks/                       # 🔹 平台感知Hooks（新增）
│   ├── usePlatformQuery.ts      # 平台感知useQuery
│   ├── usePlatformMutation.ts   # 平台感知useMutation
│   └── usePlatformInfiniteQuery.ts # 平台感知useInfiniteQuery
│
├── strategies/                  # 🔹 降级策略
│   ├── query.strategy.ts        # Query降级策略
│   ├── cache.strategy.ts        # 缓存降级策略
│   └── server-action.strategy.ts # Server Actions降级策略
│
├── types.ts                     # 🔹 类型定义
└── index.ts                     # 🔹 统一入口
```

### 核心接口设计

#### 1. 平台适配器接口 (`types.ts`)

```typescript
/**
 * 平台适配器统一接口
 * 专为React Query优化设计
 */
export interface IPlatformAdapter {
  // === 平台基本信息 ===
  readonly platform: "web" | "h5" | "capacitor";
  readonly version: string;

  // === Query配置 === (React Query集成核心)
  query: {
    /** 为queryKey添加平台/语言前缀 */
    buildQueryKey: (baseKey: any[]) => any[];

    /** 获取平台特定的staleTime */
    getStaleTime: () => number;

    /** 获取平台特定的gcTime */
    getGcTime: () => number;

    /** 是否支持后台重获取 */
    supportsBackgroundRefetch: () => boolean;

    /** 获取重试配置 */
    getRetryConfig: () => RetryConfig;
  };

  // === 网络系统 === (Server Actions降级)
  network: {
    /** 执行Server Action（自动降级到API调用） */
    executeAction<T>(action: () => Promise<T>): Promise<T>;

    /** 带fallback的Server Action */
    executeActionWithFallback<T>(
      action: () => Promise<T>,
      fallback: () => Promise<T>,
    ): Promise<T>;

    /** 检查是否支持Server Actions */
    supportsServerActions: () => boolean;
  };

  // === 缓存系统 ===
  cache: {
    /** 获取平台缓存策略 */
    getStrategy: () => CacheStrategy;

    /** 检查是否支持持久化缓存 */
    supportsPersistentCache: () => boolean;

    /** 获取缓存版本（用于缓存失效） */
    getCacheVersion: () => string;
  };

  // === 设备功能 ===
  device: {
    /** 获取设备信息 */
    getInfo: () => DeviceInfo;

    /** 检查网络状态 */
    getNetworkStatus: () => NetworkStatus;

    /** 检查是否支持推送通知 */
    supportsPush: () => boolean;
  };
}
```

#### 2. Query工厂 (`factories/query-factory.ts`)

```typescript
/**
 * 平台感知的Query工厂
 * 将平台适配器配置转换为React Query配置
 */
export class PlatformQueryFactory {
  /** 创建平台感知的Query配置 */
  static createQuery<T>(options: PlatformQueryOptions<T>): QueryOptions<T> {
    const adapter = PlatformAdapterFactory.getAdapter();

    return {
      // 1. Query Key处理
      queryKey: adapter.query.buildQueryKey(options.queryKey),

      // 2. Query Function处理（Server Actions降级）
      queryFn: async () => {
        // 支持Server Actions的平台
        if (adapter.network.supportsServerActions() && options.serverAction) {
          try {
            return await options.serverAction();
          } catch (error) {
            console.warn("Server Action失败，降级到API调用:", error);
            return await options.apiCall();
          }
        }

        // 不支持Server Actions的平台
        return await options.apiCall();
      },

      // 3. 缓存配置（平台感知）
      staleTime: adapter.query.getStaleTime(),
      gcTime: adapter.query.getGcTime(),

      // 4. 重试配置（平台感知）
      retry: adapter.query.getRetryConfig().retry,
      retryDelay: adapter.query.getRetryConfig().retryDelay,

      // 5. 其他配置透传
      enabled: options.enabled,
      refetchOnWindowFocus: adapter.query.supportsBackgroundRefetch(),
      refetchOnReconnect: adapter.query.supportsBackgroundRefetch(),

      // 6. 平台特定的初始数据
      initialData: options.initialData,

      // 7. 选择器（可选）
      select: options.select,
    };
  }

  /** 创建平台感知的Mutation配置 */
  static createMutation<TData, TVariables>(
    options: PlatformMutationOptions<TData, TVariables>,
  ): MutationOptions<TData, Error, TVariables> {
    const adapter = PlatformAdapterFactory.getAdapter();

    return {
      // Mutation Function处理（Server Actions降级）
      mutationFn: async (variables: TVariables) => {
        if (adapter.network.supportsServerActions() && options.serverAction) {
          try {
            return await options.serverAction(variables);
          } catch (error) {
            console.warn("Server Action失败，降级到API调用:", error);
            return await options.apiCall(variables);
          }
        }

        return await options.apiCall(variables);
      },

      // 乐观更新配置
      onMutate: options.onMutate,
      onSuccess: options.onSuccess,
      onError: options.onError,
      onSettled: options.onSettled,

      // 重试配置
      retry: adapter.query.getRetryConfig().retry,
      retryDelay: adapter.query.getRetryConfig().retryDelay,
    };
  }
}
```

#### 3. 平台感知Hooks (`hooks/usePlatformQuery.ts`)

```typescript
/**
 * 平台感知的useQuery Hook
 * 完全兼容React Query的useQuery API
 */
import {
  useQuery,
  UseQueryOptions,
  UseQueryResult,
} from "@tanstack/react-query";
import { PlatformQueryFactory } from "../factories/query-factory";
import type { PlatformQueryOptions } from "../types";

export function usePlatformQuery<T>(
  options: PlatformQueryOptions<T>,
): UseQueryResult<T> {
  // 将平台配置转换为React Query配置
  const queryOptions = PlatformQueryFactory.createQuery(options);

  // 使用标准的React Query
  return useQuery(queryOptions);
}

/**
 * 平台感知的useMutation Hook
 */
import {
  useMutation,
  UseMutationOptions,
  UseMutationResult,
} from "@tanstack/react-query";
import { PlatformQueryFactory } from "../factories/query-factory";
import type { PlatformMutationOptions } from "../types";

export function usePlatformMutation<TData, TVariables, TContext = unknown>(
  options: PlatformMutationOptions<TData, TVariables, TContext>,
): UseMutationResult<TData, Error, TVariables, TContext> {
  const mutationOptions = PlatformQueryFactory.createMutation(options);
  return useMutation(mutationOptions);
}
```

---

## 🚀 实施步骤

### 阶段一：基础架构搭建（1-2小时）

#### 1.1 创建平台适配器核心

```bash
# 已创建目录结构
mkdir -p apps/frontend-blog/src/lib/platform/{adapters,detectors,factories,hooks,strategies}
```

#### 1.2 实现类型定义 (`types.ts`)

```typescript
// 定义核心接口和类型
export interface IPlatformAdapter { ... }
export interface PlatformQueryOptions<T> { ... }
export interface PlatformMutationOptions<TData, TVariables> { ... }
```

#### 1.3 实现平台检测器 (`detectors/`)

```typescript
// 基于现有的env.ts，扩展平台检测
export class PlatformDetector {
  static detect(): PlatformType {
    // 1. 检测CSR/SSR/SSG（复用env.ts）
    // 2. 检测Web/H5/App（新增）
    // 3. 检测设备特性
  }
}
```

### 阶段二：React Query集成（2-3小时）

#### 2.1 实现Query工厂 (`factories/query-factory.ts`)

```typescript
// 核心：将平台配置转换为React Query配置
export class PlatformQueryFactory {
  static createQuery<T>(options: PlatformQueryOptions<T>): QueryOptions<T> {
    // 平台感知的Query配置转换
  }
}
```

#### 2.2 创建平台感知Hooks (`hooks/`)

```typescript
// usePlatformQuery.ts - 完全兼容useQuery
export function usePlatformQuery<T>(options: PlatformQueryOptions<T>) {
  const queryOptions = PlatformQueryFactory.createQuery(options);
  return useQuery(queryOptions);
}
```

#### 2.3 实现平台适配器 (`adapters/`)

```typescript
// web.adapter.ts - Web平台实现
export class WebAdapter implements IPlatformAdapter {
  query = {
    buildQueryKey: (baseKey) => ["web", ...baseKey],
    getStaleTime: () => 60 * 1000, // 1分钟
    getGcTime: () => 5 * 60 * 1000, // 5分钟
    supportsBackgroundRefetch: () => true,
    getRetryConfig: () => ({ retry: 3, retryDelay: 1000 }),
  };

  network = {
    executeAction: async <T>(action: () => Promise<T>) => {
      // Web端直接执行Server Action
      return await action();
    },
    supportsServerActions: () => true,
  };
}
```

### 阶段三：迁移示例（1-2小时）

#### 3.1 创建迁移示例文件

```typescript
// examples/migration-example.ts
// 展示如何从现有Hook迁移到平台感知Hook
```

#### 3.2 更新现有Hook（可选）

```typescript
// 示例：更新useFrontendArticles.ts
import { usePlatformQuery } from "@/lib/platform/hooks/usePlatformQuery";

export function useFrontendArticles(params?: ArticleParams) {
  return usePlatformQuery({
    queryKey: ["frontendArticles", params],
    apiCall: () => frontendBlogApi.getArticles(params),
    // 可选：未来可以添加Server Action
    // serverAction: () => getArticlesServerAction(params),
  });
}
```

### 阶段四：测试验证（1小时）

#### 4.1 创建测试文件

```typescript
// __tests__/platform-query.test.ts
// 测试平台感知Query在不同环境下的行为
```

#### 4.2 验证兼容性

```bash
# 运行现有测试
yarn test

# 类型检查
yarn tsc --noEmit
```

---

## 📊 迁移前后对比

### 现有代码示例

```typescript
// 现有：直接使用useQuery
import { useQuery } from "@tanstack/react-query";
import { frontendBlogApi } from "@/lib/api/frontendBlogApi";

export function useFrontendArticles(params?: ArticleParams) {
  return useQuery({
    queryKey: ["frontendArticles", params],
    queryFn: () => frontendBlogApi.getArticles(params),
    staleTime: 60 * 1000, // 硬编码
    gcTime: 5 * 60 * 1000, // 硬编码
  });
}
```

### 新代码示例

```typescript
// 新：使用usePlatformQuery
import { usePlatformQuery } from "@/lib/platform/hooks/usePlatformQuery";
import { frontendBlogApi } from "@/lib/api/frontendBlogApi";

export function useFrontendArticles(params?: ArticleParams) {
  return usePlatformQuery({
    queryKey: ["frontendArticles", params],
    apiCall: () => frontendBlogApi.getArticles(params),
    // 平台自动处理：staleTime、gcTime、重试、缓存等
  });
}
```

### 优势对比

| 特性               | 现有架构      | 新架构（平台适配）     |
| ------------------ | ------------- | ---------------------- |
| **平台感知**       | ❌ 硬编码配置 | ✅ 自动适配Web/H5/App  |
| **Server Actions** | ❌ 不支持     | ✅ 自动降级（Web→App） |
| **缓存策略**       | ❌ 固定配置   | ✅ 平台优化配置        |
| **Query Key**      | ❌ 简单数组   | ✅ 包含平台/语言信息   |
| **错误处理**       | ❌ 基础重试   | ✅ 平台特定重试策略    |
| **迁移成本**       | ✅ 无         | 🔄 渐进式迁移          |

---

## 🔧 使用示例

### 1. 基础查询

```typescript
import { usePlatformQuery } from "@/lib/platform/hooks/usePlatformQuery";

function ArticleList() {
  const { data, isLoading } = usePlatformQuery({
    queryKey: ["articles", { page: 1 }],
    apiCall: () => frontendBlogApi.getArticles({ page: 1 }),
  });

  // 使用方式与useQuery完全相同
}
```

### 2. 带Server Actions的查询

```typescript
function BookmarkButton({ articleId }: { articleId: string }) {
  const { data: isBookmarked } = usePlatformQuery({
    queryKey: ["bookmark-status", articleId],
    apiCall: () => frontendBlogApi.getBookmarkStatus(articleId),
    // 可选：Server Action实现（Web端使用）
    serverAction: () => getBookmarkStatusServerAction(articleId),
  });

  // App端自动降级为API调用
}
```

### 3. 平台感知的Mutation

```typescript
import { usePlatformMutation } from "@/lib/platform/hooks/usePlatformMutation";

function CommentForm({ articleId }: { articleId: string }) {
  const mutation = usePlatformMutation({
    apiCall: (data) => frontendBlogApi.postComment(articleId, data),
    // 可选：Server Action实现
    serverAction: (data) => postCommentServerAction(articleId, data),

    // 乐观更新
    onMutate: async (newComment) => {
      // 乐观更新逻辑
    },
  });

  const handleSubmit = (data) => {
    mutation.mutate(data);
  };
}
```

### 4. 平台特定的配置

```typescript
function OfflineAwareComponent() {
  const adapter = usePlatformAdapter();

  const { data } = usePlatformQuery({
    queryKey: ['offline-data'],
    apiCall: fetchData,
    // 根据平台调整配置
    enabled: adapter.device.getNetworkStatus() === 'online',
    staleTime: adapter.cache.supportsPersistentCache() ? 3600000 : 60000
```
