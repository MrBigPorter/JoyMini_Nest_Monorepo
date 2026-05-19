# Step 3：前端安裝 Apollo Client 依賴

> 在 `apps/frontend-blog` 中安裝 GraphQL 客戶端依賴。

---

## 安裝命令

```bash
yarn workspace @lucky/frontend-blog add @apollo/client graphql
```

這會安裝：

| 套件 | 用途 |
|------|------|
| `@apollo/client` | Apollo Client v3 — GraphQL 客戶端，包含 **InMemoryCache**、**HttpLink**、**ApolloProvider** |
| `graphql` | GraphQL 解析器 — `gql` 模板字面量、類型系統 |

---

## 為什麼選 Apollo Client？

| 功能 | Apollo Client | 其他選項 |
|------|--------------|---------|
| React Hook | `useQuery`, `useMutation` | 需要手動封裝 |
| 緩存 | InMemoryCache（支持 normalize） | 需要自己實現 |
| SSR | `getDataFromTree` 或 `nextjs 專用` | 需要手動處理 |
| 文件/社區 | 最成熟、文檔最全 | 較少 |

**但在本專案中，Apollo Client 只作為 React Query 的 `queryFn`，不用 Apollo 的 `useQuery` Hook。**

---

## 驗證安裝

安裝完成後檢查 `apps/frontend-blog/package.json`：

```json
{
  "dependencies": {
    "@apollo/client": "^3.12.0",
    "graphql": "^16.0.0",
    // ... 其他現有依賴
  }
}
```

---

## 不受影響的內容

| 文件 | 狀態 |
|------|------|
| `package.json` 其他依賴 | 不變 |
| `node_modules` 其他內容 | 不變 |
| `yarn.lock` | 自動更新 |
| 現有 REST 代碼 | 不變 |

---

## 下一步

安裝完成後 → [Step 4：創建 Apollo Client 配置](08-frontend-apollo-client-config.md)
