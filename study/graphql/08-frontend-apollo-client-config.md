# Step 4：前端創建 Apollo Client 配置

> 新增 `apps/frontend-blog/src/lib/api/apollo-client.ts`，提供 Client Component 和 Server Component 兩種模式。

---

## 核心設計

```
┌─────────────────────────────────────────────────────────┐
│                   Apollo Client 配置                      │
│                                                         │
│  createApolloClient()  ← 客戶端用（new HttpLink + Cache） │
│  createSsrApolloClient() ← 服務端用（原生 fetch）         │
│  gql  ← 直接從 @apollo/client 導出                         │
└─────────────────────────────────────────────────────────┘
```

**重要：Apollo Client 只作為數據獲取工具（`queryFn`），不提供 `ApolloProvider`，也不使用 Apollo 的 `useQuery` Hook。**

React Query 仍然是唯一的狀態管理層。

---

## 新增文件

```typescript
// apps/frontend-blog/src/lib/api/apollo-client.ts
import { ApolloClient, InMemoryCache, HttpLink, gql } from '@apollo/client';
import type { NormalizedCacheObject } from '@apollo/client';

// ─── 客戶端 Apollo Client ─────────────────────────────
// 用於 Client Component 的 React Query queryFn
let clientSingleton: ApolloClient<NormalizedCacheObject> | null = null;

export function createApolloClient(): ApolloClient<NormalizedCacheObject> {
  if (clientSingleton) return clientSingleton;

  const client = new ApolloClient({
    link: new HttpLink({
      uri: process.env.NEXT_PUBLIC_GRAPHQL_URL || '/api/graphql',
      credentials: 'include',
    }),
    cache: new InMemoryCache(),
    defaultOptions: {
      query: {
        fetchPolicy: 'no-cache', // 緩存由 React Query 控制
      },
    },
  });

  clientSingleton = client;
  return client;
}

// ─── 服務端 Apollo Client ─────────────────────────────
// 用於 Server Component 的 SSR 數據預取
// 使用原生 fetch（兼容 Cloudflare Workers）
export async function serverFetchGraphql<T>(
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const base =
    process.env.INTERNAL_API_URL ||
    process.env.NEXT_PUBLIC_API_BASE_URL ||
    'http://localhost:3000/api';
  const url = `${base}/graphql`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    throw new Error(
      `[serverFetchGraphql] HTTP ${res.status}: ${await res.text().catch(() => '')}`,
    );
  }

  const json = await res.json();

  if (json.errors) {
    throw new Error(
      `[serverFetchGraphql] errors: ${JSON.stringify(json.errors)}`,
    );
  }

  return json.data as T;
}

// ─── 重新導出 gql ────────────────────────────────────
// 方便其他文件直接 import { gql } from '@/lib/api/apollo-client'
export { gql };
```

---

## 環境變數配置

在 `apps/frontend-blog/.env.development` 中添加：

```env
NEXT_PUBLIC_GRAPHQL_URL=http://localhost:3000/api/graphql
```

對應後端 GraphQL 路徑為 `/graphql`，但通過 NestJS 全局前綴 `/api`，所以完整路徑為 `/api/graphql`。

---

## 關鍵設計決策

| 決策 | 原因 |
|------|------|
| **不用 ApolloProvider** | React Query 管理緩存和狀態，Apollo 只做查詢工具 |
| **`fetchPolicy: 'no-cache'`** | 避免 Apollo 和 React Query 的緩存衝突 |
| **單例模式** | 客戶端只需要一個 ApolloClient 實例 |
| **`serverFetchGraphql` 用原生 fetch** | 兼容 Cloudflare Workers（無 Node.js API） |
| **使用 `credentials: 'include'`** | 支持 Cookie 認證（與現有 REST 一致） |

---

## 文件結構變化

```
apps/frontend-blog/src/lib/api/
├── http.ts                    # 現有 axios 實例（不變）
├── frontendBlogApi.ts         # 現有 REST API（不變）
├── types.ts                   # 現有類型（不變）
├── queryKeys.ts               # 現有 QueryKey（不變）
├── apollo-client.ts           # 新增：Apollo Client 配置
└── graphql/                   # 新增目錄
    └── queries.ts             # 下一步：GraphQL 查詢定義
```

---

## 下一步

配置完成後 → [Step 5：前端修改 Categories hook 使用 GraphQL](09-frontend-modify-categories-hook.md)
