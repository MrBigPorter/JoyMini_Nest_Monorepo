# 🎯 Blog Hooks 架构设计文档

## 📋 目录

1. [背景与痛点](#背景与痛点)
2. [设计目标](#设计目标)
3. [整体架构](#整体架构)
4. [Hook 详细说明](#hook-详细说明)
5. [最佳实践](#最佳实践)
6. [演进路线](#演进路线)

---

## 🎯 背景与痛点

### ✅ 项目背景

本项目是基于 Next.js 15 App Router 的博客前台应用，需要同时支持 **SSR / SSG / CSR** 三种渲染模式，并且所有页面需要完美兼容静态导出 `next export`。

### ❌ 传统方案的痛点

1. **环境判断泛滥**: 业务代码中到处都是 `typeof window !== 'undefined'`
2. **重复逻辑**: 每个页面都在处理 loading / error / empty 状态
3. **耦合严重**: 组件直接依赖 fetch / axios，无法单元测试
4. **缓存混乱**: 每个开发者自己实现缓存策略，没有统一标准
5. **状态不一致**: 相同数据在不同页面各自请求，出现数据不一致问题
6. **无错误降级**: API 失败时页面直接崩溃，没有优雅降级

---

## 🚀 设计目标

### ✅ 核心原则

```
✅ 业务代码永远不需要知道运行在什么环境
✅ 同一个Hook在 SSR / SSG / CSR 下自动选择最优实现
✅ 零心智负担，开发只需要关心业务逻辑
✅ 所有边界情况在Hook层统一处理
```

### 🎯 具体目标

1. 统一封装所有数据获取逻辑
2. 自动适配不同渲染环境
3. 内置标准的加载/错误/空状态处理
4. 全局统一缓存策略
5. 类型安全，完整 TypeScript 支持
6. 可测试，可Mock，可替换实现

---

## 🏗️ 整体架构

```
┌─────────────────────────────────────────┐
│           业务组件 / 页面               │
└─────────────────┬───────────────────────┘
                  │
┌─────────────────▼───────────────────────┐
│   useArticles / useCategories / ...     │  <- 业务Hook层
│   useComments / useTags                 │
└─────────────────┬───────────────────────┘
                  │
┌─────────────────▼───────────────────────┐
│  useEnvironment / useToast / useConfirm │  <- 基础Hook层
└─────────────────┬───────────────────────┘
                  │
┌─────────────────▼───────────────────────┐
│              Fetcher 层                 │  <- 多模式适配层
└─────────────────┬───────────────────────┘
                  │
┌─────────────────▼───────────────────────┐
│              真实 API / Mock            │
└─────────────────────────────────────────┘
```

### 📊 分层职责

| 层级      | 职责                           |
| --------- | ------------------------------ |
| 业务Hook  | 封装具体业务逻辑，组合基础Hook |
| 基础Hook  | 提供通用能力，与业务无关       |
| Fetcher层 | 环境适配，请求统一处理         |
| 数据源    | 真实接口 / Mock 数据           |

---

## 📦 Hook 详细说明

### 🔧 基础Hook层

#### 1. `useEnvironment`

```typescript
const { env, isServer, isClient, isSSG, isSSR } = useEnvironment();
```

✅ **能力**:

- 自动检测当前运行环境: `ssr` | `ssg` | `csr`
- 提供统一的环境判断方法
- 避免业务代码中出现 `typeof window` 判断
- 支持静态导出模式检测

✅ **解决的问题**:

- 消除代码中分散的环境判断逻辑
- 统一处理 hydration 不匹配问题
- 为其他Hook提供环境感知能力

---

#### 2. `useToast`

```typescript
const { toast, success, error, warning, info } = useToast();
```

✅ **能力**:

- 全局统一的消息提示系统
- 支持多种消息类型
- 自动消失动画
- 堆叠管理，避免消息重叠

✅ **设计原则**:

- 所有API错误统一通过Toast提示
- 业务代码不需要处理消息显示逻辑
- 支持服务端静默，不会在SSR时报错

---

#### 3. `useConfirm`

```typescript
const { confirm, ConfirmDialog } = useConfirm();

// 调用方式
const result = await confirm({
  title: "确认删除?",
  message: "此操作不可恢复",
  confirmText: "删除",
  variant: "destructive",
});
```

✅ **能力**:

- Promise 风格的确认对话框
- 不需要在每个组件中维护弹窗状态
- 统一的UI风格和交互
- 支持多种确认类型

✅ **革命性改进**:
把原来需要50行代码的弹窗逻辑，简化成1行 await 调用

---

### 📚 业务Hook层

#### 4. `useArticles`

```typescript
const { articles, isLoading, error, pagination, refresh, loadMore } =
  useArticles({ page: 1, size: 10, category: "tech" });
```

✅ **内置能力**:

- ✅ 自动分页处理
- ✅ 无限滚动加载
- ✅ 本地缓存策略
- ✅ 加载状态管理
- ✅ 错误自动重试
- ✅ 空状态处理

#### 5. `useCategories`

```typescript
const { categories, getCategoryBySlug, isLoading } = useCategories();
```

✅ **内置能力**:

- ✅ 全局单例缓存，整个应用只请求一次
- ✅ 自动刷新策略
- ✅ Slug 快速查找
- ✅ 文章计数统计

#### 6. `useComments`

```typescript
const { comments, addComment, replyComment, likeComment } =
  useComments(articleSlug);
```

✅ **内置能力**:

- ✅ 乐观更新
- ✅ 权限检查
- ✅ 嵌套回复结构
- ✅ 实时更新

#### 7. `useTags`

```typescript
const { tags, popularTags, getTagBySlug } = useTags();
```

---

## ✨ 设计亮点

### 1. **环境自适应**

所有Hook自动感知当前运行环境:

- **SSR 模式**: 直接返回数据，不触发客户端请求
- **SSG 模式**: 构建时预加载，客户端使用缓存
- **CSR 模式**: 正常发起API请求，带缓存

✅ 业务代码完全不需要做任何修改

### 2. **统一边界处理**

每个Hook都标准返回:

```typescript
{
  data: T | null,
  isLoading: boolean,
  error: Error | null,
  isEmpty: boolean,
  refresh: () => Promise<void>
}
```

✅ 所有页面可以使用统一的模式处理状态:

```tsx
if (isLoading) return <Skeleton />;
if (error) return <ErrorState />;
if (isEmpty) return <EmptyState />;

// 正常渲染数据
```

### 3. **全局缓存策略**

- 分类/标签数据: 永久缓存，仅手动刷新
- 文章列表: 缓存5分钟
- 评论数据: 缓存30秒
- 用户相关数据: 不缓存

✅ 所有策略在Hook层配置，业务代码透明

---

## 📝 最佳实践

### ✅ 应该做的

1. 所有数据获取必须通过Hook，禁止直接fetch
2. 页面组件只负责渲染，所有逻辑放在Hook中
3. 遵循标准返回格式，保持组件一致性
4. 新的业务逻辑优先封装成Hook

### ❌ 禁止做的

1. ❌ 不要在组件中写 `useEffect` 请求数据
2. ❌ 不要在业务代码中判断环境
3. ❌ 不要每个页面自己处理错误提示
4. ❌ 不要重复实现相同的逻辑

---

## 🚧 演进路线

### 🔄 当前状态: v1.0 已完成

- ✅ 所有基础Hook实现
- ✅ 业务Hook框架完成
- ✅ Mock数据集成
- ✅ 类型安全

### 📅 下阶段: v1.5

- [ ] 集成 TanStack Query 作为缓存底层
- [ ] 实现乐观更新
- [ ] 离线支持
- [ ] 性能监控

### 🚀 未来: v2.0

- [ ] WebSocket 实时更新
- [ ] 服务端增量静态再生成
- [ ] 预加载策略
- [ ] AI 智能预取

---

## ✅ 总结

这个Hook架构是整个前端系统的核心骨架，它解决了现代Next.js应用中最头疼的多模式适配问题，让业务开发者可以专注于功能实现，而不需要关心底层渲染环境的差异。

> 好的架构不是让开发者觉得强大，而是让开发者觉得简单。
