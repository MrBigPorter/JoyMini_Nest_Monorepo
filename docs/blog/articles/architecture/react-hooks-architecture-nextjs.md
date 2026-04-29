---
tags:
  - React
  - Hooks
  - Architecture
  - Next.js
  - TypeScript
  - SSR
---

# Next.js Blog Hooks 架构设计：让业务代码永远不知道运行在什么环境

## 1. 背景：现代 Next.js 应用的痛点

### 1.1 多模式适配难题

本项目基于 Next.js 15 App Router，需要同时支持 **SSR / SSG / CSR** 三种渲染模式，并且所有页面需要兼容静态导出。这带来了一个典型问题：

```
❌ 传统方案的痛点：

1. 环境判断泛滥：typeof window !== 'undefined' 散布在业务代码中
2. 重复逻辑：每个页面都在处理 loading / error / empty 状态
3. 耦合严重：组件直接依赖 fetch，无法单元测试
4. 缓存混乱：每个开发者自己实现缓存策略，没有统一标准
5. 状态不一致：相同数据在不同页面各自请求
6. 无错误降级：API 失败时页面直接崩溃
```

### 1.2 设计目标

```
🎯 核心原则：
  - 业务代码永远不需要知道运行在什么环境
  - 同一个 Hook 在 SSR / SSG / CSR 下自动选择最优实现
  - 零心智负担，开发只需要关心业务逻辑
  - 所有边界情况在 Hook 层统一处理
```

---

## 2. 整体架构

### 2.1 分层设计

```
┌─────────────────────────────────────────┐
│           业务组件 / 页面               │
│         (只关心渲染，不关心数据来源)      │
└─────────────────┬───────────────────────┘
                  │
┌─────────────────▼───────────────────────┐
│        业务 Hook 层                      │
│   useArticles / useCategories / ...     │
│   useComments / useTags                 │
│   (封装具体业务逻辑，组合基础 Hook)       │
└─────────────────┬───────────────────────┘
                  │
┌─────────────────▼───────────────────────┐
│        基础 Hook 层                      │
│   useEnvironment / useToast / useConfirm │
│   (提供通用能力，与业务无关)              │
└─────────────────┬───────────────────────┘
                  │
┌─────────────────▼───────────────────────┐
│            Fetcher 层                    │
│   (环境适配：SSR直出 / SSG缓存 / CSR请求) │
└─────────────────┬───────────────────────┘
                  │
┌─────────────────▼───────────────────────┐
│           数据源                         │
│   真实 API / Mock 数据                   │
└─────────────────────────────────────────┘
```

### 2.2 分层职责

| 层级 | 职责 |
|------|------|
| 业务 Hook | 封装具体业务逻辑，组合基础 Hook |
| 基础 Hook | 提供通用能力，与业务无关 |
| Fetcher 层 | 环境适配，请求统一处理 |
| 数据源 | 真实接口 / Mock 数据 |

---

## 3. 基础 Hook 层

### 3.1 useEnvironment — 环境感知

最底层的基础 Hook，自动检测当前运行环境：

```typescript
const { env, isServer, isClient, isSSG, isSSR } = useEnvironment();
```

**能力**：
- 自动检测运行环境：`ssr` | `ssg` | `csr`
- 提供统一的环境判断方法
- 消除业务代码中的 `typeof window` 判断
- 支持静态导出模式检测

**解决的问题**：
- 消除代码中分散的环境判断逻辑
- 统一处理 hydration 不匹配问题
- 为其他 Hook 提供环境感知能力

### 3.2 useToast — 统一消息提示

```typescript
const { toast, success, error, warning, info } = useToast();
```

**设计原则**：
- 所有 API 错误统一通过 Toast 提示
- 业务代码不需要处理消息显示逻辑
- 支持服务端静默，不会在 SSR 时报错

### 3.3 useConfirm — Promise 风格确认对话框

```typescript
const { confirm, ConfirmDialog } = useConfirm();

// ❌ 传统方式：50 行代码管理弹窗状态
const [showDeleteDialog, setShowDeleteDialog] = useState(false);
// ... 各种事件处理

// ✅ Promise 风格：1 行 await 调用
const result = await confirm({
  title: "确认删除?",
  message: "此操作不可恢复",
  confirmText: "删除",
  variant: "destructive",
});
```

**革命性改进**：把原来需要 50 行代码的弹窗逻辑，简化成 1 行 `await` 调用。

---

## 4. 业务 Hook 层

### 4.1 useArticles — 文章列表

```typescript
const { articles, isLoading, error, pagination, refresh, loadMore } =
  useArticles({ page: 1, size: 10, category: "tech" });
```

**内置能力**：

| 能力 | 实现方式 |
|------|----------|
| 自动分页 | 内置 page/size 参数管理 |
| 无限滚动 | `loadMore` 自动追加数据 |
| 本地缓存 | 5 分钟 TTL，避免重复请求 |
| 加载状态 | `isLoading` 自动管理 |
| 错误重试 | 自动重试 3 次，指数退避 |
| 空状态处理 | `isEmpty` 布尔值 |

### 4.2 useCategories — 分类管理

```typescript
const { categories, getCategoryBySlug, isLoading } = useCategories();
```

**内置能力**：
- **全局单例缓存**：整个应用只请求一次分类数据
- 自动刷新策略（30 分钟 TTL）
- Slug 快速查找（`getCategoryBySlug()` 方法）
- 文章计数统计

### 4.3 useComments — 评论系统

```typescript
const { comments, addComment, replyComment, likeComment } =
  useComments(articleSlug);
```

**内置能力**：
- **乐观更新**：提交后立即更新 UI，后台异步确认
- 权限检查：自动判断当前用户是否有权限操作
- 嵌套回复结构：支持多级回复
- 实时更新：新评论自动推送到页面

### 4.4 useTags — 标签管理

```typescript
const { tags, popularTags, getTagBySlug } = useTags();
```

---

## 5. 设计亮点

### 5.1 环境自适应

所有 Hook 自动感知当前运行环境：

| 模式 | 行为 |
|------|------|
| **SSR** | 服务端直接返回数据，不触发客户端请求 |
| **SSG** | 构建时预加载数据，客户端使用缓存 |
| **CSR** | 正常发起 API 请求，带本地缓存 |

业务代码完全不需要做任何修改。

### 5.2 统一边界处理

每个 Hook 都标准返回一致的接口：

```typescript
{
  data: T | null,       // 数据（可能是 null）
  isLoading: boolean,   // 正在加载
  error: Error | null,  // 错误信息
  isEmpty: boolean,     // 数据为空
  refresh: () => Promise<void>  // 手动刷新
}
```

所有页面可以使用统一的模式处理各种状态：

```tsx
function ArticleList() {
  const { articles, isLoading, error, isEmpty } = useArticles();

  if (isLoading) return <Skeleton />;        // 骨架屏
  if (error) return <ErrorState />;           // 错误状态
  if (isEmpty) return <EmptyState />;         // 空状态

  return articles.map(article => (           // 正常渲染
    <ArticleCard key={article.id} article={article} />
  ));
}
```

### 5.3 全局缓存策略

| 数据类型 | 缓存策略 | 说明 |
|----------|----------|------|
| 分类/标签 | 永久缓存 | 仅手动刷新 |
| 文章列表 | 5 分钟 | 平衡实时性和性能 |
| 评论数据 | 30 秒 | 需要相对实时 |
| 用户相关 | 不缓存 | 保证数据准确性 |

所有策略在 Hook 层配置，业务代码透明。

### 5.4 错误降级链

```
请求失败 → 自动重试 (3次) → 显示缓存数据 → 显示 ErrorState
```

如果请求失败，系统先尝试 3 次自动重试（指数退避），如果仍然失败但有缓存数据则显示缓存，最后才显示错误页面。

---

## 6. 最佳实践

### ✅ 应该做的

1. **所有数据获取必须通过 Hook**，禁止直接 `fetch`
2. **页面组件只负责渲染**，所有逻辑放在 Hook 中
3. **遵循标准返回格式**，保持组件一致性
4. **新的业务逻辑优先封装成 Hook**

### ❌ 禁止做的

1. ❌ 不要在组件中写 `useEffect` 请求数据
2. ❌ 不要在业务代码中判断环境
3. ❌ 不要每个页面自己处理错误提示
4. ❌ 不要重复实现相同的逻辑

---

## 7. 演进路线

### 当前状态：v1.0 已完成

- [x] 所有基础 Hook 实现
- [x] 业务 Hook 框架完成
- [x] Mock 数据集成
- [x] 类型安全

### 下阶段：v1.5

- [ ] 集成 TanStack Query 作为缓存底层
- [ ] 实现乐观更新
- [ ] 离线支持
- [ ] 性能监控

### 未来：v2.0

- [ ] WebSocket 实时更新
- [ ] 服务端增量静态再生成
- [ ] 预加载策略
- [ ] AI 智能预取

---

## 8. 总结

这套 Hook 架构是整个前端系统的核心骨架。它解决了现代 Next.js 应用中最头疼的多模式适配问题，让业务开发者可以专注于功能实现。

> 好的架构不是让开发者觉得强大，而是让开发者觉得简单。

**关键成果**：
- 消除了所有分散的 `typeof window` 判断
- 统一的 loading / error / empty 处理模式
- 全局缓存策略，避免重复请求
- 环境自适应，SSR/SSG/CSR 自动切换

---

*相关文档：*
- [三端统一平台适配器架构](./nextjs-platform-adapter-pattern.md)
- [Blog Hook 示例使用指南](../../development/HOOKS_USAGE_GUIDE.md)
- [API 集成规范](../../api/API_INTEGRATION_PLAN.md)
