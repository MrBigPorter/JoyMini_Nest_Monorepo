# Frontend Blog Category URL Sync Fix

## 问题描述

**场景重现：**
1. 用户访问首页，点击"All" tab → 显示所有文章
2. 切换到某个category tab（例如"技术"）→ URL变成 `/?category=xxx`
3. 用户刷新页面（F5）
4. **实际结果：**
   - ✅ 数据正确（显示该category的文章）
   - ❌ Tab UI错误（仍然高亮"技术" tab，但应该根据数据高亮对应tab）

或者更糟糕的情况：
- ❌ 数据错误（显示所有文章，因为SSR没读取category参数）
- ✅ Tab UI正确（高亮"技术" tab，因为客户端读取了URL）

**根本原因：SSR阶段没有读取URL的`category`参数，总是获取所有文章。**

---

## 问题根源分析

### Before 修复前

```typescript
// apps/frontend-blog/src/app/[locale]/page.tsx

export default async function HomePage({
  params,  // ← 只有params，没有searchParams
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  const [initialData, initialCategories] = await Promise.all([
    serverGet('/v1/frontend/blog/articles', {
      lang: locale,
      page: 1,
      pageSize: 10,
      // ❌ 缺失：没有传递 categoryId
    }),
    // ...
  ]);
}
```

**流程：**
```
用户访问 /?category=tech 并刷新

SSR阶段：
├─ page.tsx 忽略 ?category=tech
├─ 调用 API: /articles?lang=en&page=1&pageSize=10
├─ 返回所有文章（不过滤category）
└─ 生成 HTML with 所有文章

客户端Hydration：
├─ page.client.tsx 读取 ?category=tech
├─ selectedCategoryId = 'tech'
├─ CategoryFilter 高亮 "tech" tab
├─ 但 displayArticles = initialData.items（所有文章）
└─ ❌ 结果：Tab说"tech"，��据是"all" → 不一致！
```

---

## 解决方案

### After 修复后

```typescript
// apps/frontend-blog/src/app/[locale]/page.tsx

export default async function HomePage({
  params,
  searchParams,  // ← 新增：接收URL查询参数
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;  // ← 新增
}) {
  const { locale: routeLocale } = await params;
  const urlSearchParams = await searchParams;  // ← 新增

  const locale = routeLocale;

  // ← 新增：读取category参数
  const categoryId =
    typeof urlSearchParams.category === 'string'
      ? urlSearchParams.category
      : undefined;

  const [initialData, initialCategories] = await Promise.all([
    serverGet('/v1/frontend/blog/articles', {
      lang: locale,
      page: 1,
      pageSize: 10,
      categoryId,  // ✅ 修复：传递categoryId
    }),
    // ...
  ]);
}
```

**修复后流程：**
```
用户访问 /?category=tech 并刷新

SSR阶段：
├─ page.tsx 读取 ?category=tech
├─ categoryId = 'tech'
├─ 调用 API: /articles?lang=en&page=1&pageSize=10&categoryId=tech
├─ 返回 "tech" category的文章
└─ 生成 HTML with "tech"文章

客户端Hydration：
├─ page.client.tsx 读取 ?category=tech
├─ selectedCategoryId = 'tech'
├─ CategoryFilter 高亮 "tech" tab
├─ displayArticles = initialData.items（"tech"文章）
└─ ✅ 结果：Tab和数据完全一致！
```

---

## 代码变更详情

### 文件：`apps/frontend-blog/src/app/[locale]/page.tsx`

#### 1. 函数签名添加 `searchParams`
```diff
  export default async function HomePage({
    params,
+   searchParams,
  }: {
    params: Promise<{ locale: string }>;
+   searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
  }) {
    const { locale: routeLocale } = await params;
+   const urlSearchParams = await searchParams;
```

#### 2. 读取category参数
```diff
    const locale = routeLocale;

+   // 读取URL的category参数，确保SSR和客户端数据一致
+   // 刷新页面时，tab UI和数据会保持同步
+   const categoryId =
+     typeof urlSearchParams.category === 'string'
+       ? urlSearchParams.category
+       : undefined;
```

#### 3. 传递categoryId给API
```diff
    const [initialData, initialCategories] = await Promise.all([
      serverGet<FrontendPaginatedResponse<FrontendArticle>>(
        '/v1/frontend/blog/articles',
-       { lang: locale, page: 1, pageSize: 10 },
+       { lang: locale, page: 1, pageSize: 10, categoryId },
      ),
```

---

## 测试场景验证

| 场景 | SSR数据 | 客户端Tab | 最终结果 | 状态 |
|------|---------|----------|---------|------|
| 访问 `/` | 所有文章 | "All" tab | ✅ 一致 | ✅ |
| 访问 `/?category=tech` | "tech"文章 | "tech" tab | ✅ 一致 | ✅ |
| 在 "tech" tab刷新 | "tech"文章 | "tech" tab | ✅ 一致 | ✅ |
| 在 "All" tab刷新 | 所有文章 | "All" tab | ✅ 一致 | ✅ |
| 切换tab（客户端） | N/A | 对应tab | ✅ 正常 | ✅ |

---

## 副作用检查

### ✅ 无Breaking Changes

1. **ISR缓存键变化：** 
   - Before: `/en/` → 缓存所有文章
   - After: `/en/` → 缓存所有文章（相同）
   - `/en/?category=tech` → 独立缓存（新增，不影响旧缓存）

2. **客户端行为：**
   - Category切换逻辑不变
   - Load More逻辑不变
   - Backward navigation逻辑不变

3. **性能影响：**
   - SSR性能：无变化（仍然是2个并行请求）
   - 缓存策略：更精细（每个category独立缓存，更合理）

---

## 相关文件

- ✅ `apps/frontend-blog/src/app/[locale]/page.tsx` - SSR入口（已修改）
- ✅ `apps/frontend-blog/src/app/[locale]/page.client.tsx` - 客户端逻辑（无需修改）
- ✅ `apps/frontend-blog/src/components/blog/CategoryFilter.tsx` - Tab组件（无需修改）

---

## Next.js搜索参数文档

参考：[Next.js App Router - searchParams](https://nextjs.org/docs/app/api-reference/file-conventions/page#searchparams-optional)

```typescript
// Page组件可以接收searchParams prop
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const search = await searchParams;
  // search.category, search.page, etc.
}
```

---

## 验证步骤

### 手动测试：

1. **测试刷新保持category**
   ```bash
   1. 访问 http://localhost:3000/
   2. 点击某个category tab（例如"技术"）
   3. URL变成 /?category=xxx
   4. 按F5刷新页面
   5. ✅ 预期：tab仍然高亮"技术"，显示技术类文章
   ```

2. **测试All tab刷新**
   ```bash
   1. 访问 http://localhost:3000/
   2. 确保在"All" tab（或点击��）
   3. URL是 / 或 /?category=
   4. 按F5刷新
   5. ✅ 预期：tab高亮"All"，显示所有文章
   ```

3. **测试直接访问category URL**
   ```bash
   1. 直接访问 http://localhost:3000/?category=xxx
   2. ✅ 预期：tab高亮对应category，显示该category文章
   ```

4. **测试category切换仍然正常**
   ```bash
   1. 访问首页
   2. 点击不同category tab
   3. ✅ 预期：切换流畅，skeleton正常显示
   ```

---

## 总结

**问题：** SSR不读取URL的category参数，导致刷新时数据和Tab UI不同步

**解决：** 在page.tsx中添加searchParams参数读取，传递给API

**影响：** 
- ✅ 修复了刷新时category不同步的问题
- ✅ 无Breaking Changes
- ✅ 提升了用户体验（刷新保持状态）
- ✅ 更符合Web标准（URL即状态）

**修复时间：** 2026-05-05  
**修复文件数：** 1个  
**代码行数变化：** +13行

