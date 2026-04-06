# 博客文章分类下拉筛选修复计划

## 问题描述

在 `/blog/articles` 页面中，分类筛选下拉框显示为空，仅显示“所有分类”占位符，无法根据分类筛选文章。原因在于 `searchSchema` 中的分类选项为静态空数组，未动态加载分类数据。

## 根本原因分析

1. **前端代码 (`ArticlesPageV2`)**：
   - `searchSchema` 中 `category` 字段的 `options` 仅包含一个占位项 `{ label: 'All Categories', value: '' }`，注释说明“动态分类选项将在 requestArticles 中获取”。
   - `requestArticles` 函数从文章列表响应中提取分类数据并返回 `categories`，但 SmartTable 组件未将返回的分类数据传递给搜索表单。
   - SmartTable 的 `SchemaSearchForm` 使用静态 `schema`，不支持运行时更新 `options`。

2. **后端 API**：
   - 分类接口 `GET /v1/admin/blog/categories` 正常工作，返回分类数组（包含 `id`、`name` 等字段）。
   - 文章列表接口 `GET /v1/admin/blog/articles` 返回的文章对象中包含完整的 `category` 对象，可用于提取分类。

3. **现有模式参考**：
   - `BlogArticleModal`、`create/page.tsx`、`edit/page.tsx` 等页面均通过 `blogApi.getCategories()` 独立获取分类列表，并映射为 select 选项。
   - 这表明项目惯例是单独请求分类数据，而非依赖文章列表响应。

## 解决方案

修改 `apps/admin‑next/src/app/(dashboard)/blog/articles/page.tsx`，在组件内独立获取分类列表，并将分类数据动态注入 `searchSchema`。

### 具体修改步骤

1. **引入状态与副作用**：
   - 添加 `categories` 状态：`const [categories, setCategories] = useState<{id: string, name: string}[]>([])`。
   - 使用 `useEffect`（或 `useQuery`）在组件挂载后调用 `blogApi.getCategories()` 获取分类数据，并更新状态。
   - 可选：添加加载状态与错误处理（遵循现有 UI 模式）。

2. **动态生成 searchSchema**：
   - 将 `searchSchema` 从静态数组改为由 `useMemo` 生成的动态数组，依赖 `categories` 状态。
   - 将分类选项映射为 `{ label: category.name, value: category.id }`，并在数组开头保留“所有分类”选项。

3. **移除冗余的分类提取逻辑**：
   - `requestArticles` 中提取分类的代码（`categoryMap` 与 `categories`）可保留（不影响功能），也可移除以简化代码。

4. **确保筛选参数传递正确**：
   - 当前 `requestArticles` 已将 `params.category` 作为 `categoryId` 传递给后端，此部分无需修改。

### 代码修改示例（关键部分）

```tsx
// 1. 添加状态
import { useState, useEffect } from "react";
// ... 在组件函数内部
const [categories, setCategories] = useState<{ id: string; name: string }[]>(
  [],
);

// 2. 获取分类数据
useEffect(() => {
  const fetchCategories = async () => {
    try {
      const res = await blogApi.getCategories();
      setCategories(res.list || []);
    } catch (error) {
      console.error("Failed to fetch categories:", error);
      // 可选：显示 toast 提示
    }
  };
  fetchCategories();
}, []);

// 3. 动态生成 searchSchema
const searchSchema = useMemo<FormSchema[]>(
  () => [
    {
      type: "input",
      key: "search",
      label: "Search",
      placeholder: "Search article titles or content...",
    },
    {
      type: "select",
      key: "status",
      label: "Status",
      placeholder: "All Status",
      options: [
        { label: "All Status", value: "" },
        { label: "Published", value: "PUBLISHED" },
        { label: "Draft", value: "DRAFT" },
        { label: "Archived", value: "ARCHIVED" },
      ],
    },
    {
      type: "select",
      key: "category",
      label: "Category",
      placeholder: "All Categories",
      options: [
        { label: "All Categories", value: "" },
        ...categories.map((cat) => ({ label: cat.name, value: cat.id })),
      ],
    },
  ],
  [categories],
);
```

### 备选方案考虑

- **方案A（采用现有模式）**：如上所述，独立请求分类数据。**推荐**，因为与项目其他部分保持一致，且分类数据变动不频繁，一次获取即可。
- **方案B（利用文章列表返回的分类）**：修改 SmartTable 使其支持将 `request` 返回的额外数据（如 `categories`）传递给搜索表单。此方案改动较大，涉及组件层，不推荐。
- **方案C（混合模式）**：首次加载时独立请求分类，后续可通过文章列表响应增量更新。复杂度较高，收益有限。

## 影响范围

- **正向影响**：分类下拉框正常显示所有分类，用户可依据分类筛选文章。
- **无负面影响**：不影响现有文章列表、分页、状态筛选、搜索等功能。
- **性能影响**：额外发起一次分类请求（数据量小，可接受）。

## 测试验证要点

1. 页面加载后，分类下拉框应显示所有分类选项（包括“所有分类”）。
2. 选择任一分类，点击搜索，文章列表应正确筛选为该分类下的文章。
3. 选择“所有分类”，文章列表应显示全部文章。
4. 与其他筛选条件（状态、关键词）组合使用，功能正常。
5. 无 JavaScript 错误，控制台无异常网络请求。

## 后续优化建议（可选）

1. **分类缓存**：使用 React Query 缓存分类数据，避免重复请求。
2. **搜索表单异步选项**：考虑将 `SchemaSearchForm` 扩展为支持异步加载选项，以便在其他场景复用。
3. **分类空状态处理**：当无分类时显示友好提示。

## 实施责任人

前端开发者（需切换至 Code 模式进行代码修改）。

## 时间估算

- 代码修改：约 30 分钟
- 测试验证：约 20 分钟

---

_计划创建时间：2026‑04‑05_
