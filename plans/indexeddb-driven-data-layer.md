# IndexedDB 数据驱动页面架构 — 全局分析

## 一、当前架构的问题（回顾）

1. `allArticles` + accumulation effect + `prevPageRef` — 手动状态管理，易出错
2. `initialData` + `isInitialCategory` — SSR 数据污染查询键
3. 组件重挂载时 3 个初始化不一致导致 page-reset bug
4. React Query 缓存和 IndexedDB 两套系统并行，数据流不清晰

---

## 二、目标架构（方案 A：Dexie liveQuery 驱动）

```
┌──────────────────────────────────────────────────────────────────────┐
│                         page.client.tsx                               │
│                                                                       │
│  allArticles = useAccumulatedArticles(locale, page, categoryId)      │
│       │                                                               │
│       │  liveQuery ──► Dexie Observable                               │
│       │       │                                                       │
│       │       └── IndexedDB.articles 表                                │
│       │               ▲                                               │
│       │               └── syncArticles() ──── bulkPut + 保洁          │
│       │                       ▲                                       │
│       │                       │                                       │
│  useFrontendArticles ──── API 响应（只用于触发同步 + loading/error）  │
│                                                                       │
│  ❌ 删除：allArticles useState                                        │
│  ❌ 删除：accumulation effect + prevPageRef                           │
│  ❌ 删除：initialData + isInitialCategory                             │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 三、CRUD 完整数据流

### CREATE — 新文章发布

```
1. 管理员发布新文章
2. 用户触发 refetch（staleTime 过期或手动刷新）
3. API 返回 page=1，包含新文章（新 id）
4. syncArticles() 执行：
   a. bulkPut → upsert 新文章
   b. 保洁：该 [locale+page] 中已不存在的文章 → bulkDelete
5. liveQuery 检测 articles 表变化
6. 组件重渲染，新文章出现

✅ 正确性：新文章有唯一 id，upsert 不会覆盖旧数据
✅ 保洁：如果 page 1 满 10 篇，被挤出的文章从 page 1 删除
⚠️ 被挤出的文章在用户加载 page 2 时重新出现
```

### READ — 读取文章

```
【场景 A：首次加载，IndexedDB 为空】
1. useAccumulatedArticles 返回 []
2. useFrontendArticles 触发 API 请求
3. 显示 loading skeleton
4. API 返回 → syncArticles → liveQuery → 显示数据

⚠️ 问题：首次加载有短暂空白期
✅ 缓解：SSR 阶段仍然可以渲染初始数据，或显示 skeleton

【场景 B：返回 page=3（核心修复场景）】
1. URL page=3，组件挂载
2. useAccumulatedArticles(en, 3, catId) 订阅 IndexedDB
3. IndexedDB 有 pages 1-3 的数据 → 立即返回 30 篇
4. React Query 同步触发 API → 后台更新 IndexedDB
5. 如有变化 → liveQuery → 自动重渲染
6. Scroll 恢复（已有修复）

✅ IndexedDB 有数据时无空白期
✅ 数据更新自动响应

【场景 C：切换分类】
1. setSelectedCategoryId('newCat')
2. setPage(1)
3. useAccumulatedArticles 重新订阅（新 categoryId）
4. 新分类可能无数据 → 返回 []
5. React Query 请求 → 写入 IndexedDB → liveQuery → 渲染

⚠️ 问题：切换分类时有数据间隙（空 → 等待 API）
✅ 缓解：保留旧 UI 直到新数据到达，或 prefetch
```

### UPDATE — 文章编辑

```
1. 管理员修改文章标题/封面
2. staleTime 过期后，用户访问该 page
3. API 返回更新后的数据（同 id）
4. syncArticles()：
   a. bulkPut → upsert，覆盖旧记录（同 id）
   b. 保洁：同 page 的 ID 集合没变，不删除
5. liveQuery → 自动重渲染

✅ 当前 accumulation effect 被 prevRef guard 阻挡不会更新
✅ liveQuery 方案下 background refetch 后自动更新 UI
```

### DELETE — 文章删除

```
【粒度 1：文章级 — syncArticles 内保洁】

API 返回 page=2 少了 1 篇 →
syncArticles()：
  a. bulkPut(9 records)
  b. 查询 [locale+page]=[en,2] → 10 条（含已删除的）
  c. 对比 ID → 找出已删除的 id
  d. bulkDelete([deletedId])
liveQuery → 重渲染 → 显示 9 篇 ✅

⚠️ 注意：保洁必须按 categoryId 过滤！
   如果同一 [locale+page] 下有两个分类的数据，
   不清洗 categoryId 会误删另一个分类的文章。


【粒度 2：分页级 — totalPages 减少】

totalPages 从 5→2 →
API 返回 page=1, totalPages=2 →
调用 pruneStaleArticles(en, [1,2]) →
删除 page=3,4,5 的所有记录 ✅
```

---

## 四、全局分析：发现的新问题

### 问题 1：🔥 syncArticles 保洁会误删跨分类文章

**严重级别：高（Bug）**

**场景**：同一 `[locale+page]` 下存在多个分类的数据。

```
IndexedDB 状态：
  [en, 1] → 文章 a1(id=1, catA), a2(id=2, catA), b1(id=10, catB)

用户访问分类 A page=1：
  API 返回 [a1, a2]
  syncArticles() 执行保洁：
    查询 [locale+page]=[en,1] → [a1, a2, b1]
    incomingIds = {1, 2}
    toDelete = [10]  ← ❌ 删除了分类 B 的文章！
```

**修复**：保洁时必须按 `categoryId` 过滤。

```typescript
// 修正后的 syncArticles 保洁
const existingForPage = categoryId
  ? await db.articles
      .where(['locale+page'])
      .equals([locale, page])
      .filter((a) => a.categoryId === categoryId)  // ← 只过滤当前分类
      .toArray()
  : await db.articles
      .where(['locale+page'])
      .equals([locale, page])
      .toArray();
```

---

### 问题 2：totalPages / hasMore 的来源

**严重级别：高**

当前 `hasMore = page < totalPages`，`totalPages` 来自 React Query 的 `data?.totalPages`。

在新架构中，`allArticles` 来自 `useAccumulatedArticles`，不再依赖 React Query 的 `data`。但 `totalPages` 仍然需要。

**方案**：
1. 从 React Query 的 `data?.totalPages` 获取（React Query 仍然运行）
2. 或者存储到 IndexedDB metadata 表中

**推荐**：方案 1。React Query 仍然用于触发网络请求，从它的响应中取 `totalPages`。

```typescript
const { data, isLoading, error } = useFrontendArticles({ ... });
const totalPages = data?.totalPages || 0;
const hasMore = page < totalPages;
```

---

### 问题 3：SSR 水合不一致

**严重级别：中**

`useSyncExternalStore` 需要 `getServerSnapshot` 返回服务端快照。IndexedDB 只在浏览器存在。

```typescript
function useAccumulatedArticles(locale, maxPage, categoryId) {
  return useSyncExternalStore(
    subscribe,
    getSnapshot,
    () => []  // getServerSnapshot: SSR 时返回空数组
  );
}
```

**影响**：
- HTML 初始渲染可能显示空列表
- Hydrate 后，如果 IndexedDB 有数据，liveQuery 立即更新
- 如果更新发生在 hydrate 之前，Next.js 可能警告水合不一致

**缓解**：
- 使用 `useIsClient` 或 hydration guard
- 首次 SSR 渲染 skeleton，client 激活后从 IndexedDB 读取

---

### 问题 4：View Transitions API 与 liveQuery 的异步冲突

**严重级别：中**

当前代码：

```typescript
const transition = document.startViewTransition(() => {
  setSelectedCategoryId(categoryId);
  setPage(1);
  setAllArticles([]);  // ← 同步清空
});
```

在新架构中，没有 `setAllArticles([])`。分类切换只是更新 React 状态：
```typescript
const transition = document.startViewTransition(() => {
  setSelectedCategoryId(categoryId);
  setPage(1);
  // allArticles 由 liveQuery 异步更新
});
```

View Transition 捕获的是**同步** DOM 变化。liveQuery 的更新是**异步**的，可能在 transition 完成后才发生。

**影响**：分类切换的过渡动画可能不包含新数据。

**缓解**：不使用 View Transitions 包裹 liveQuery 的数据变化。只包裹 UI 控制元素的变化（分类标签高亮等）。

---

### 问题 5：离线首次加载

**严重级别：中**

首次打开博客且处于离线状态：
- IndexedDB 为空
- `useAccumulatedArticles` 返回 `[]`
- React Query 的 `networkMode: 'offlineFirst'` 不会发起网络请求
- 页面显示空列表

**与当前行为的对比**：
- 当前：同样的问题（SSR initialData 可能提供 page 1 数据，但 page>1 不行）
- 新架构：问题相同，没有恶化

**缓解**：SSR 仍然可以提供 page 1 的初始内容。

---

### 问题 6：多个 IndexedDB 写入源的数据竞争

**严重级别：中**

`syncArticles` 被 `useFrontendArticles` 调用。但 `syncArticleContent` 写入 `articleContents` 表，不冲突。
`syncCategories` 写入 `categories` 表，不冲突。

但 `useFrontendArticleBySlug` 的 `getCachedArticleContent` 同时读取 `articles` 和 `articleContents` 表。如果在读取过程中 `syncArticles` 正在更新 `articles` 表，可能读到不一致的数据。

**缓解**：Dexie 的读操作自带快照隔离（IndexedDB 的事务特性），读操作不会看到部分写入的数据。

---

### 问题 7：liveQuery 的内存泄漏风险

**严重级别：低**

`liveQuery` 创建 Observable，如果不正确 unsubscribe，会持续监听 IndexedDB 变化，即使组件已卸载。

```typescript
useEffect(() => {
  const observable = liveQuery(() => query());
  const subscription = observable.subscribe({...});
  return () => subscription.unsubscribe();  // ← 必须
}, [deps]);
```

**缓解**：正确实现 cleanup 函数。

---

### 问题 8：IndexedDB 版本升级

**严重级别：低**

当前 Dexie 版本 2。如果需要添加新索引（如 `[locale+page+categoryId]` 复合索引），需要版本 3。

```typescript
this.version(3).stores({
  articles: 'id, slug, locale, categoryId, [locale+page], [locale+page+categoryId]',
  // ...
});
```

Dexie 的版本升级会自动迁移数据，不影响现有数据。

---

### 问题 9：Bundle 体积影响

**严重级别：低**

当前已使用 Dexie，不需要额外安装。如果使用 `dexie-react-hooks` 包，增加约 2KB gzipped。

或者自己用 `useSyncExternalStore` 封装（React 18 内置），零额外依赖。

---

## 五、与其他 Hook 的交互分析

| Hook | 写入 IndexedDB | 读取 IndexedDB | 与方案 A 的冲突 |
|------|---------------|---------------|----------------|
| `useFrontendArticles` | `syncArticles` → articles 表 | `getCachedArticles` | **核心 Hook**，正常使用 |
| `useFrontendArticleBySlug` | `syncArticleContent` → articleContents 表 | `getCachedArticleContent` | 无冲突（不同表） |
| `useFrontendFeaturedArticles` | ❌ 不写入 | ❌ 不读取 | 无影响 |
| `useFrontendPopularArticles` | ❌ 不写入 | ❌ 不读取 | 无影响 |
| `useFrontendRelatedArticles` | ❌ 不写入 | ❌ 不读取 | 无影响 |
| `useFrontendSearchArticles` | ❌ 不写入 | ❌ 不读取 | 无影响 |
| `useFrontendCategories` | `syncCategories` → categories 表 | `getCachedCategories` | 无冲突（不同表） |
| `useFrontendTags` | `syncTags` → tags 表 | `getCachedTags` | 无冲突（不同表） |

**结论**：方案 A 只影响 `useFrontendArticles` 的渲染数据流，不影响其他 Hook。

---

## 六、实施步骤（修正版）

### Step 1：改造 `syncArticles`

- 添加文章级保洁（**必须按 categoryId 过滤**）
- 使用 Dexie 事务保证原子性
- 当 `categoryId` 为 undefined 时不过滤（兼容无分类查询）

### Step 2：新建 `useAccumulatedArticles` Hook

- 使用 `liveQuery` + `useSyncExternalStore`
- 查询 `[locale+page] between [locale,1] and [locale,maxPage]`
- 可选 categoryId 过滤
- `getServerSnapshot` 返回 `[]`
- 正确处理 Observable 的 subscribe/unsubscribe

### Step 3：修改 `page.client.tsx`

- 删除 `allArticles` useState
- 删除 accumulation effect
- 删除 `prevPageRef`
- 删除 `isInitialCategory`
- 删除 `initialData` 的使用
- 添加 `const allArticles = useAccumulatedArticles(...)`
- 保留 `useFrontendArticles` 只用于 `isLoading`、`error`、`totalPages`
- View Transition 不依赖 allArticles 清空
- Scroll restore effect 的依赖改为 `allArticles`

### Step 4：修改 `page.tsx`（Server Component）

- 删除 `initialData` 的获取和传递
- 保留 `initialCategories` 的获取

### Step 5：添加 totalPages 保洁

- 在 `useFrontendArticles.ts` 的 `networkPromise.then` 中
- 懒判断 totalPages 是否变化
- 只在变化时调用 `pruneStaleArticles`

---

## 七、风险矩阵（更新版）

| # | 风险 | 概率 | 影响 | 缓解 |
|---|------|------|------|------|
| 1 | syncArticles 保洁误删跨分类文章 | 高 | 高（数据丢失） | 保洁按 categoryId 过滤 |
| 2 | 首次加载 IndexedDB 空 → 空白期 | 一定 | 中 | SSR 初始渲染 / skeleton |
| 3 | SSR 水合不一致 | 中 | 中 | getServerSnapshot 返回 [] + hydration guard |
| 4 | View Transitions 与 liveQuery 异步冲突 | 一定 | 低 | 分类切换时不依赖 allArticles 过渡 |
| 5 | 离线首次加载无数据 | 低 | 中 | SSR 提供初始内容 |
| 6 | liveQuery subscription 泄漏 | 低 | 低 | 正确实现 useEffect cleanup |
| 7 | 同一文章 page 字段被覆盖 | 低 | 低 | 相同 id 的 upsert 是预期的行为 |
| 8 | IndexedDB 配额超限 | 极低 | 中 | 保洁避免无限增长 |
| 9 | React Query + liveQuery 双重渲染 | 一定 | 低 | 不将 React Query data 用于渲染 |
| 10 | Dexie 版本升级失败 | 极低 | 高 | 测试覆盖版本迁移路径 |

---

## 八、决策建议

```
              ┌─────────────────────────────┐
              │  先做 3 行修复（方案 C）       │
              │  快速修复 page-reset bug      │
              └──────────┬──────────────────┘
                         │
                         ▼
              ┌─────────────────────────────┐
              │  评估是否需要 liveQuery      │
              │  - 数据自动更新是否必要？     │
              │  - 旧文章清理是否必要？       │
              │  - 愿意承担中等风险？         │
              └──────────┬──────────────────┘
                        / \
                       /   \
                      /     \
                     /       \
                    ▼         ▼
        ┌──────────────┐   ┌──────────────────┐
        │ 方案 A       │   │ 保持方案 C       │
        │ liveQuery    │   │ 3行修复足够      │
        │ 完整架构重构  │   │ 维持现有架构      │
        └──────────────┘   └──────────────────┘
```

3 行修复和方案 A 的改动不冲突。可以先做方案 C 快速止血，后续再评估是否需要演进到方案 A。
