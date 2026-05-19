# Step 7：驗證 REST + GraphQL 共存

> 確認 Categories 的 REST 和 GraphQL 兩套接口同時正常工作，不互相影響。

---

## 驗證清單

### 7.1 後端驗證

**1. GraphQL Playground 可用**

啟動 API 服務後，訪問：
```
http://localhost:3000/api/graphql
```

應該看到 GraphQL Playground 界面。執行查詢：

```graphql
# 查詢 1：獲取所有分類
query {
  categories(locale: "zh") {
    id
    name
    slug
    description
    coverImage
    articleCount
  }
}
```

```graphql
# 查詢 2：按 slug 獲取分類詳情
query {
  categoryBySlug(slug: "technology", locale: "en") {
    id
    name
    slug
    articleCount
    articles {
      items {
        id
        title
        slug
      }
      total
    }
  }
}
```

**2. REST 端點仍可訪問**

```bash
curl http://localhost:3000/api/v1/frontend/blog/categories
# 應該返回與 GraphQL 相同的數據
```

**3. REST 和 GraphQL 返回數據一致**

比較兩個接口的返回：

```typescript
// REST:  GET /api/v1/frontend/blog/categories?lang=zh
// → 返回 FrontendCategory[]

// GraphQL:  query { categories(locale: "zh") { id name slug description coverImage articleCount } }
// → 返回 { data: { categories: FrontendCategory[] } }

// 兩個接口調用同樣的 FrontendBlogService.getFrontendCategories()
// 數據應該完全一致
```

---

### 7.2 前端驗證

**4. 前端開發服務器正常啟動**

```bash
yarn workspace @lucky/frontend-blog dev
```

**5. 首頁正常渲染**

- 訪問 `http://localhost:3000/zh/`
- 確認分類選項卡正常顯示
- 確認文章列表正常加載
- 瀏覽器 DevTools → Network → 確認有 GraphQL 請求到 `/api/graphql`

**6. 切換分類正常**

- 點擊不同的分類選項卡
- 確認文章列表根據分類變化
- 確認沒有控制台錯誤

**7. React Query DevTools 檢查**

如果安裝了 `@tanstack/react-query-devtools`，可以檢查：

- QueryKey: `['frontendCategories', 'zh', 'graphql']` 存在
- 數據來源為 `graphql` 而非 `rest`
- staleTime 正常工作

---

### 7.3 回滾方案

如果 GraphQL 出現問題，只需簡單修改即可回退到 REST：

**Client Component**：將 `useGraphql: true` 改回 `false` 或刪除參數
**Server Component**：將 `serverFetchGraphql` 改回 `serverGet`

兩處修改即可完全回退，REST 代碼從未被刪除。

---

### 7.4 共存架構圖

```
                     ┌──────────────────────┐
                     │     HTTP 請求入口      │
                     │  localhost:3000/api   │
                     └──────┬───────────────┘
                            │
              ┌─────────────┴─────────────┐
              │                           │
     ┌────────▼────────┐       ┌─────────▼────────┐
     │  REST 路徑       │       │  GraphQL 路徑     │
     │  /v1/frontend/  │       │  /graphql         │
     └────────┬────────┘       └─────────┬────────┘
              │                           │
     ┌────────▼────────┐       ┌─────────▼────────┐
     │ Controller      │       │ Resolver          │
     │ (不變)          │       │ (新增)            │
     └────────┬────────┘       └─────────┬────────┘
              │                           │
              └──────────┬───────────────┘
                         │
              ┌──────────▼──────────┐
              │  FrontendBlogService │
              │  (不變，共用)        │
              └──────────┬──────────┘
                         │
              ┌──────────▼──────────┐
              │  BlogService        │
              │  (Prisma 查詢)      │
              └─────────────────────┘
```

---

## PoC 完成標準

| 檢查項 | 預期結果 |
|--------|---------|
| GraphQL Playground 可訪問 | ✅ 能執行 `categories` 和 `categoryBySlug` 查詢 |
| REST `/categories` 仍可用 | ✅ 返回與之前完全相同的數據 |
| 首頁 SSR 正常 | ✅ 使用 GraphQL 預取分類數據 |
| 首頁 CSR 正常 | ✅ 客戶端使用 GraphQL 獲取分類 |
| 分類切換正常 | ✅ 文章列表按分類過濾 |
| 無控制台錯誤 | ✅ 無 404、無 GraphQL errors |
| 可一鍵回退 | ✅ 修改 `page.tsx` 和 `page.client.tsx` 兩處即可 |

---

## 下一步（Phase 2）

PoC 驗證通過後 → 擴展到首頁文章列表的 GraphQL 遷移

詳見 [`README.md`](README.md) 中的 **Phase 2：首頁文章 + 精選文章**。
