# Frontend-Blog 分层架构规范

> ✅ 清晰的分层边界，严格的依赖规则，模块化架构
> ✅ 拒绝面条代码，拒绝耦合，拒绝后期无法维护
> ✅ 任何开发人员看到目录结构就知道代码应该写在哪里

---

## 🎯 核心架构原则

### 🚫 绝对禁止的依赖关系

```
❌ 页面组件直接调用 axios
❌ 组件里面直接写业务逻辑
❌ 业务逻辑里面直接操作DOM
❌ 任何跨层的直接调用
```

### ✅ 单向依赖规则

```
┌─────────────────────────┐
│        页面层           │  只能往下依赖，不能反向依赖
└───────────┬─────────────┘
            ▼
┌─────────────────────────┐
│      业务组件层         │
└───────────┬─────────────┘
            ▼
┌─────────────────────────┐
│      状态管理层         │
└───────────┬─────────────┘
            ▼
┌─────────────────────────┐
│       API 服务层        │
└───────────┬─────────────┘
            ▼
┌─────────────────────────┐
│     基础工具层          │
└─────────────────────────┘
```

✅ **上层可以依赖下层，下层绝对不能依赖上层**
✅ **同层之间不允许互相依赖**
✅ **每一层只知道它直接下层的存在**

---

## 📂 完整目录结构与职责划分

```
apps/frontend-blog/src/
├── app/                     # ✅ 页面层 - Next.js App Router
│   ├── layout.tsx           # 根布局
│   ├── page.tsx             # 首页
│   ├── articles/
│   ├── categories/
│   ├── tags/
│   └── search/
│
├── components/              # ✅ 组件层
│   ├── core/               # 🔹 原子基础组件 (无业务逻辑)
│   │   ├── Button.tsx
│   │   ├── Card.tsx
│   │   ├── Avatar.tsx
│   │   ├── Skeleton.tsx
│   │   └── InfiniteScroll.tsx
│   │
│   ├── blog/               # 🔹 业务组件 (纯展示，无状态)
│   │   ├── ArticleCard.tsx
│   │   ├── ArticleList.tsx
│   │   ├── ArticleDetail.tsx
│   │   ├── ArticleRenderer.tsx
│   │   ├── CategorySidebar.tsx
│   │   ├── TagCloud.tsx
│   │   ├── CommentItem.tsx
│   │   └── CommentSection.tsx
│   │
│   ├── layout/             # 🔹 布局组件
│   │   ├── Header.tsx
│   │   ├── Footer.tsx
│   │   ├── Sidebar.tsx
│   │   └── MobileNavBar.tsx
│   │
│   └── features/           # 🔹 功能组件 (有状态，有业务逻辑)
│       ├── CommentForm.tsx
│       ├── LikeButton.tsx
│       ├── ShareButton.tsx
│       ├── SearchBox.tsx
│       └── ThemeToggle.tsx
│
├── lib/                     # ✅ 核心逻辑层
│   ├── api/                 # 🔹 API 服务层
│   │   ├── http.ts          # 统一HTTP客户端
│   │   ├── articles.ts      # 文章接口
│   │   ├── categories.ts    # 分类接口
│   │   ├── tags.ts          # 标签接口
│   │   ├── comments.ts      # 评论接口
│   │   └── types.ts         # API类型定义
│   │
│   ├── hooks/               # 🔹 自定义 Hooks
│   │   ├── useArticles.ts
│   │   ├── useCategories.ts
│   │   ├── useComments.ts
│   │   ├── usePlatform.ts
│   │   ├── useTheme.ts
│   │   └── useOffline.ts
│   │
│   ├── store/               # 🔹 状态管理层
│   │   ├── useArticleStore.ts
│   │   ├── useUIStore.ts
│   │   ├── usePreferenceStore.ts
│   │   └── useOfflineStore.ts
│   │
│   ├── utils/               # 🔹 工具函数层 (纯函数，无副作用)
│   │   ├── dateFormat.ts
│   │   ├── htmlSanitizer.ts
│   │   ├── slugify.ts
│   │   ├── seo.ts
│   │   └── share.ts
│   │
│   ├── platform/            # 🔹 平台适配层
│   │   ├── native.ts
│   │   ├── web.ts
│   │   └── index.ts
│   │
│   └── types/               # 🔹 全局类型定义
│       ├── article.ts
│       ├── category.ts
│       ├── tag.ts
│       ├── comment.ts
│       └── platform.ts
│
├── styles/                  # ✅ 样式层
│   ├── globals.css
│   ├── prose.css
│   └── theme.css
│
└── constants/               # ✅ 常量配置
    ├── routes.ts
    ├── api.ts
    └── app.config.ts
```

---

## 🎯 各层严格边界规范

### 1. 页面层 (`app/`)

✅ **可以做的事：**

- 定义路由
- 组合组件
- 服务端数据获取
- 页面级布局

❌ **绝对不能做的事：**

- ❌ 写业务逻辑
- ❌ 直接调用API
- ❌ 写复杂的JSX
- ❌ 维护本地状态

✅ 页面示例：

```tsx
// app/articles/[slug]/page.tsx
import { fetchArticle } from "@/lib/api/articles";
import ArticleDetail from "@/components/blog/ArticleDetail";
import CommentSection from "@/components/features/CommentSection";

export default async function ArticlePage({ params }) {
  const article = await fetchArticle(params.slug);

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <ArticleDetail article={article} />
      <CommentSection articleId={article.id} />
    </div>
  );
}
```

---

### 2. 组件层 (`components/`)

✅ **可以做的事：**

- 接收props渲染UI
- 维护自己内部的UI状态
- 抛出事件回调

❌ **绝对不能做的事：**

- ❌ 直接调用API
- ❌ 导入全局Store
- ❌ 有业务逻辑
- ❌ 知道路由的存在

✅ 组件示例：

```tsx
// components/blog/ArticleCard.tsx
export default function ArticleCard({ article, onClick }) {
  return (
    <Card onClick={() => onClick(article.slug)}>
      <h3>{article.title}</h3>
      <p>{article.summary}</p>
      <div className="meta">
        <span>{formatDate(article.publishedAt)}</span>
        <span>{article.viewCount} 阅读</span>
      </div>
    </Card>
  );
}
```

---

### 3. Hooks 层 (`lib/hooks/`)

✅ **可以做的事：**

- 组装业务逻辑
- 连接Store和API
- 管理业务状态
- 提供给组件使用

❌ **绝对不能做的事：**

- ❌ 渲染UI
- ❌ 直接操作DOM
- ❌ 知道组件的存在

✅ Hook 示例：

```tsx
// lib/hooks/useArticles.ts
import { useQuery } from "@tanstack/react-query";
import { blogApi } from "@/lib/api/articles";

export function useArticles(params) {
  return useQuery({
    queryKey: ["articles", params],
    queryFn: () => blogApi.getArticles(params),
  });
}
```

---

### 4. API 层 (`lib/api/`)

✅ **可以做的事：**

- 定义接口调用
- 请求参数转换
- 响应数据转换
- 统一错误处理

❌ **绝对不能做的事：**

- ❌ 知道组件的存在
- ❌ 知道状态管理的存在
- ❌ 有任何业务逻辑

✅ API 示例：

```typescript
// lib/api/articles.ts
import http from "./http";

export const blogApi = {
  getArticles: (params) => http.get("/v1/public/blog/articles", params),

  getArticleBySlug: (slug) => http.get(`/v1/public/blog/articles/${slug}`),
};
```

---

### 5. 工具函数层 (`lib/utils/`)

✅ **可以做的事：**

- 纯函数，输入输出确定
- 没有副作用
- 不依赖任何其他层
- 可以在任何地方调用

❌ **绝对不能做的事：**

- ❌ 有副作用
- ❌ 依赖任何其他层
- ❌ 有状态

✅ 工具函数示例：

```typescript
// lib/utils/dateFormat.ts
export function formatDate(timestamp) {
  return new Date(timestamp).toLocaleDateString("zh-CN");
}
```

---

## 🚫 铁律，违反直接打回

1. **目录结构铁律**
   - 任何代码必须放在正确的目录下
   - 不允许在根目录乱加文件
   - 不允许创建不在此文档中的目录

2. **依赖方向铁律**
   - 上层可以import下层，下层绝对不能import上层
   - 组件不能import页面
   - API不能import组件
   - Utils不能import任何其他东西

3. **职责单一铁律**
   - 一个文件只做一件事
   - 一个函数只做一件事
   - 一个组件只做一件事

4. **复制粘贴铁律**
   - 相同的逻辑出现第二次，必须提取到Utils
   - 相同的UI出现第二次，必须提取到组件

---

## ✅ 代码审查检查清单

任何PR提交前必须检查：

- [ ] 代码放在了正确的目录下
- [ ] 没有违反依赖方向
- [ ] 组件没有直接调用API
- [ ] 没有业务逻辑写在页面里
- [ ] 工具函数是纯函数
- [ ] 没有复制粘贴的代码

---

## 🎯 架构优势

1. **可维护性**：任何开发人员6个月后回来还能看懂
2. **可测试性**：每一层都可以单独单元测试
3. **可替换性**：可以换掉整个UI层而不影响业务逻辑
4. **可扩展性**：加新功能不需要改老代码
5. **可复用性**：所有的业务逻辑可以在任何地方复用

这个架构看起来很繁琐，但是当项目代码量达到1万行的时候，你会感谢今天的严格。
