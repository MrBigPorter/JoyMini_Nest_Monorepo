# Bookmarks 与认证系统集成方案

## 🎯 项目目标

为前端博客系统实现完整的用户认证和文章收藏功能，解决以下问题：

1. **用户认证**：对接现有后端认证系统，实现登录/注册功能
2. **收藏功能**：实现文章收藏/取消收藏功能
3. **收藏管理**：提供用户收藏文章列表页面
4. **权限控制**：保护用户专属功能（如收藏页面）

## 📋 当前状态分析

### 后端系统（已存在）

- ✅ JWT Token 认证系统（accessToken + refreshToken）
- ✅ 支持手机号验证码登录
- ✅ 支持邮箱验证码登录
- ✅ 支持 OAuth（Google、Facebook、Apple）
- ✅ 用户管理、登录日志
- ❌ 缺少博客收藏功能 API

### 前端系统（部分实现）

- ✅ 有登录/注册页面 UI（mock 逻辑）
- ✅ 有 Header 登录按钮
- ❌ 没有全局认证状态管理
- ❌ 登录页面没有对接真实 API
- ❌ bookmarks 页面使用 mock 数据，没有空状态处理

## 🏗️ 技术架构设计

### 1. 数据库设计

```prisma
// 在现有 Prisma schema 中添加
model UserBookmark {
  id        String   @id @default(uuid())
  userId    String   // 关联用户
  articleId String   // 关联文章
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  // 唯一约束：一个用户只能收藏同一篇文章一次
  @@unique([userId, articleId])

  // 关联关系
  user   User   @relation(fields: [userId], references: [id], onDelete: Cascade)
  article Article @relation(fields: [articleId], references: [id], onDelete: Cascade)
}
```

### 2. API 接口设计

#### 认证相关接口（已存在，需要前端对接）

```
POST   /v1/client/auth/login-with-email-code    # 邮箱验证码登录
POST   /v1/client/auth/login-with-otp          # 手机验证码登录
POST   /v1/client/auth/login-with-oauth        # OAuth 登录
POST   /v1/client/auth/refresh-token           # 刷新 Token
GET    /v1/client/auth/profile                 # 获取用户信息
```

#### 收藏功能接口（需要新增）

```
GET    /v1/frontend/blog/bookmarks             # 获取用户收藏列表（分页）
POST   /v1/frontend/blog/articles/:id/bookmark # 收藏文章
DELETE /v1/frontend/blog/articles/:id/bookmark # 取消收藏
GET    /v1/frontend/blog/articles/:id/bookmark-status  # 检查收藏状态
```

### 3. 前端架构设计

#### 状态管理方案

使用 **Zustand** 作为全局状态管理，原因：

- 比 React Context 更轻量、简单
- 支持 TypeScript 类型安全
- 不需要 Provider 包装
- 支持中间件（如持久化存储）

#### 数据获取方案

使用 **SWR** 作为数据获取库，原因：

- 自动缓存、重试、错误处理
- 支持乐观更新
- 轻量级，API 简单
- 与 Next.js 集成良好

#### 组件结构

```
src/
├── lib/
│   ├── api/
│   │   ├── authApi.ts          # 认证相关 API
│   │   ├── blogApi.ts          # 博客相关 API（扩展收藏功能）
│   │   └── http.ts             # HTTP 客户端（添加拦截器）
│   ├── store/
│   │   └── auth.store.ts       # 认证状态管理
│   └── hooks/
│       ├── useAuth.ts          # 认证相关 hooks
│       └── useBookmarks.ts     # 收藏相关 hooks
├── components/
│   ├── auth/
│   │   ├── ProtectedRoute.tsx  # 受保护路由组件
│   │   └── LoginGuard.tsx      # 登录守卫组件
│   └── blog/
│       └── BookmarkButton.tsx  # 收藏按钮组件
└── app/[locale]/
    ├── bookmarks/
    │   └── page.tsx            # 收藏列表页面（重构）
    ├── login/
    │   └── page.tsx            # 登录页面（对接真实 API）
    └── register/
        └── page.tsx            # 注册页面（对接真实 API）
```

## 🔧 详细实现步骤

### 第一阶段：前端认证系统重构

#### 1.1 创建认证状态管理

```typescript
// src/lib/store/auth.store.ts
import { create } from "zustand";
import { persist } from "zustand/middleware";

interface AuthState {
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;

  // Actions
  login: (
    tokens: { accessToken: string; refreshToken: string },
    user: User,
  ) => void;
  logout: () => void;
  setTokens: (tokens: { accessToken: string; refreshToken: string }) => void;
  setUser: (user: User) => void;
  setLoading: (loading: boolean) => void;
}

const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      isAuthenticated: false,
      isLoading: false,

      login: (tokens, user) =>
        set({
          ...tokens,
          user,
          isAuthenticated: true,
        }),

      logout: () =>
        set({
          user: null,
          accessToken: null,
          refreshToken: null,
          isAuthenticated: false,
        }),

      setTokens: (tokens) => set({ ...tokens }),

      setUser: (user) => set({ user }),

      setLoading: (loading) => set({ isLoading: loading }),
    }),
    {
      name: "auth-storage",
      partialize: (state) => ({
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
        user: state.user,
      }),
    },
  ),
);
```

#### 1.2 创建认证相关 hooks

```typescript
// src/lib/hooks/useAuth.ts
import useAuthStore from "@/lib/store/auth.store";
import { authApi } from "@/lib/api/authApi";

export function useAuth() {
  const store = useAuthStore();

  const loginWithEmail = async (email: string, code: string) => {
    try {
      store.setLoading(true);
      const result = await authApi.loginWithEmailCode(email, code);
      store.login(result.tokens, result.user);
      return result;
    } finally {
      store.setLoading(false);
    }
  };

  const logout = () => {
    store.logout();
    // 可选：调用后端登出接口
  };

  const refreshToken = async () => {
    if (!store.refreshToken) return null;

    try {
      const result = await authApi.refreshToken(store.refreshToken);
      store.setTokens(result.tokens);
      return result;
    } catch (error) {
      store.logout();
      throw error;
    }
  };

  return {
    ...store,
    loginWithEmail,
    logout,
    refreshToken,
  };
}
```

#### 1.3 扩展 HTTP 客户端添加拦截器

```typescript
// src/lib/api/http.ts
import axios from "axios";
import useAuthStore from "@/lib/store/auth.store";

const http = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL,
  timeout: 10000,
});

// 请求拦截器：自动添加 token
http.interceptors.request.use(
  (config) => {
    const { accessToken } = useAuthStore.getState();

    if (accessToken) {
      config.headers.Authorization = `Bearer ${accessToken}`;
    }

    return config;
  },
  (error) => Promise.reject(error),
);

// 响应拦截器：处理 token 过期
http.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    // 如果是 401 错误且不是刷新 token 的请求
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;

      try {
        const { refreshToken } = useAuthStore.getState();
        if (!refreshToken) throw new Error("No refresh token");

        const result = await authApi.refreshToken(refreshToken);
        useAuthStore.getState().setTokens(result.tokens);

        // 重试原始请求
        originalRequest.headers.Authorization = `Bearer ${result.tokens.accessToken}`;
        return http(originalRequest);
      } catch (refreshError) {
        useAuthStore.getState().logout();
        window.location.href = "/login";
        return Promise.reject(refreshError);
      }
    }

    return Promise.reject(error);
  },
);

export default http;
```

#### 1.4 创建受保护路由组件

```typescript
// src/components/auth/ProtectedRoute.tsx
'use client';

import { useAuth } from '@/lib/hooks/useAuth';
import { useRouter } from '@/navigation';
import { useEffect } from 'react';

interface ProtectedRouteProps {
  children: React.ReactNode;
  redirectTo?: string;
}

export function ProtectedRoute({
  children,
  redirectTo = '/login'
}: ProtectedRouteProps) {
  const { isAuthenticated, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push(redirectTo);
    }
  }, [isAuthenticated, isLoading, router, redirectTo]);

  if (isLoading) {
    return <div>Loading...</div>;
  }

  if (!isAuthenticated) {
    return null;
  }

  return <>{children}</>;
}
```

### 第二阶段：后端收藏功能开发

#### 2.1 数据库迁移

```bash
# 生成迁移文件
npx prisma migrate dev --name add-user-bookmarks

# 应用迁移
npx prisma migrate deploy
```

#### 2.2 创建收藏服务

```typescript
// apps/api/src/blog/frontend/bookmark.service.ts
import { Injectable } from "@nestjs/common";
import { PrismaService } from "@api/common/prisma/prisma.service";

@Injectable()
export class BookmarkService {
  constructor(private readonly prisma: PrismaService) {}

  async getUserBookmarks(
    userId: string,
    params: { page?: number; pageSize?: number; locale?: string },
  ) {
    const { page = 1, pageSize = 10, locale = "zh" } = params;
    const skip = (page - 1) * pageSize;

    const [items, total] = await Promise.all([
      this.prisma.userBookmark.findMany({
        where: { userId },
        include: {
          article: {
            include: {
              category: true,
              tags: true,
              author: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: pageSize,
      }),
      this.prisma.userBookmark.count({ where: { userId } }),
    ]);

    // 转换文章数据为前端格式
    const formattedItems = items.map((bookmark) => ({
      ...this.mapArticleForFrontend(bookmark.article, locale),
      bookmarkedAt: bookmark.createdAt,
    }));

    return {
      items: formattedItems,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  async addBookmark(userId: string, articleId: string) {
    return this.prisma.userBookmark.upsert({
      where: {
        userId_articleId: {
          userId,
          articleId,
        },
      },
      create: {
        userId,
        articleId,
      },
      update: {}, // 如果已存在，不做任何更新
    });
  }

  async removeBookmark(userId: string, articleId: string) {
    return this.prisma.userBookmark.delete({
      where: {
        userId_articleId: {
          userId,
          articleId,
        },
      },
    });
  }

  async checkBookmarkStatus(userId: string, articleId: string) {
    const bookmark = await this.prisma.userBookmark.findUnique({
      where: {
        userId_articleId: {
          userId,
          articleId,
        },
      },
    });

    return {
      isBookmarked: !!bookmark,
      bookmarkedAt: bookmark?.createdAt,
    };
  }

  private mapArticleForFrontend(article: any, locale: string) {
    // 复用 FrontendBlogService 中的映射逻辑
    // ...
  }
}
```

#### 2.3 创建收藏控制器

```typescript
// apps/api/src/blog/frontend/bookmark.controller.ts
import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Query,
  Req,
} from "@nestjs/common";
import { BookmarkService } from "./bookmark.service";
import { AuthGuard } from "@nestjs/passport";

@Controller("v1/frontend/blog")
@UseGuards(AuthGuard("jwt"))
export class BookmarkController {
  constructor(private readonly bookmarkService: BookmarkService) {}

  @Get("bookmarks")
  async getBookmarks(
    @Req() req,
    @Query("page") page?: number,
    @Query("pageSize") pageSize?: number,
    @Query("locale") locale?: string,
  ) {
    return this.bookmarkService.getUserBookmarks(req.user.id, {
      page,
      pageSize,
      locale,
    });
  }

  @Post("articles/:id/bookmark")
  async addBookmark(@Req() req, @Param("id") articleId: string) {
    return this.bookmarkService.addBookmark(req.user.id, articleId);
  }

  @Delete("articles/:id/bookmark")
  async removeBookmark(@Req() req, @Param("id") articleId: string) {
    return this.bookmarkService.removeBookmark(req.user.id, articleId);
  }

  @Get("articles/:id/bookmark-status")
  async checkBookmarkStatus(@Req() req, @Param("id") articleId: string) {
    return this.bookmarkService.checkBookmarkStatus(req.user.id, articleId);
  }
}
```

### 第三阶段：前端收藏功能集成

#### 3.1 扩展博客 API 客户端

```typescript
// src/lib/api/blogApi.ts
export const blogApi = {
  // ... 现有接口

  // 收藏相关接口
  getBookmarks: (params?: { page?: number; pageSize?: number }) =>
    http.get<PaginatedResponse<Article>>("/v1/frontend/blog/bookmarks", params),

  addBookmark: (articleId: string) =>
    http.post(`/v1/frontend/blog/articles/${articleId}/bookmark`),

  removeBookmark: (articleId: string) =>
    http.delete(`/v1/frontend/blog/articles/${articleId}/bookmark`),

  checkBookmarkStatus: (articleId: string) =>
    http.get<{ isBookmarked: boolean; bookmarkedAt?: string }>(
      `/v1/frontend/blog/articles/${articleId}/bookmark-status`,
    ),
};
```

#### 3.2 创建收藏按钮组件

```typescript
// src/components/blog/BookmarkButton.tsx
'use client';

import { Bookmark } from 'lucide-react';
import { Button } from '@repo/ui';
import { useAuth } from '@/lib/hooks/useAuth';
import { blogApi } from '@/lib/api/blogApi';
import useSWR from 'swr';
import { useRouter } from '@/navigation';

interface BookmarkButtonProps {
  articleId: string;
  size?: 'sm' | 'md' | 'lg';
  variant?: 'ghost' | 'outline' | 'default';
}

export function BookmarkButton({
  articleId,
  size = 'sm',
  variant = 'ghost',
}: BookmarkButtonProps) {
  const { isAuthenticated } = useAuth();
  const router = useRouter();

  const { data, mutate, isLoading } = useSWR(
    isAuthenticated ? `/bookmark-status/${articleId}` : null,
    () => blogApi.checkBookmarkStatus(articleId)
  );

  const isBookmarked = data?.isBookmarked || false;

  const handleToggle = async () => {
    if (!isAuthenticated) {
      router.push('/login');
      return;
    }

    try {
      if (isBookmarked) {
        await blogApi.removeBookmark(articleId);
      } else {
        await blogApi.addBookmark(articleId);
      }

      // 乐观更新
      mutate({ isBookmarked: !isBookmarked }, false);
    } catch (error) {
      console.error('Failed to toggle bookmark:', error);
    }
  };

  return (
    <Button
      variant={variant}
      size={size}
      onClick={handleToggle}
      disabled={isLoading}
      className="gap-1"
    >
      <Bookmark
        className={`w-4 h-4 ${isBookmarked ? 'fill-current text-primary' : ''}`}
      />
      <span className="sr-only">
        {isBookmarked ? '取消收藏' : '收藏'}
      </span>
    </Button>
  );
}
```

#### 3.3 扩展 EmptyState 组件

```typescript
// src/components/ui/EmptyState.tsx
// 在现有组件中添加 'bookmarks' 类型支持
const getIcon = () => {
  switch (type) {
    case 'bookmarks':
      return <Bookmark className="w-16 h-16 text-slate-300 dark:text-slate-600" />;
    // ... 其他类型
  }
};

const getDefaultTitle = () => {
  switch (type) {
    case 'bookmarks':
      return '暂无收藏';
    // ... 其他类型
  }
};

const getDefaultDescription = () => {
  switch (type) {
    case 'bookmarks':
      return '您收藏的文章将会显示在这里。';
    // ... 其他类型
  }
};

const getDefaultActionText = () => {
  switch (type) {
    case 'bookmarks':
      return '浏览文章';
    // ... 其他类型
  }
};
```

#### 3.4 重构收藏列表页面

```typescript
// src/app/[locale]/bookmarks/page.tsx
'use client';

import { useTranslations } from 'next-intl';
import { Bookmark } from 'lucide-react';
import { ArticleCard } from '@/components/blog/ArticleCard';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageSkeleton } from '@/components/ui/PageSkeleton';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { blogApi } from '@/lib/api/blogApi';
import useSWR from 'swr';

export default function BookmarksPage() {
  const t = useTranslations();

  const { data, isLoading, error } = useSWR(
    '/bookmarks',
    () => blogApi.getBookmarks({ page: 1, pageSize: 12 })
  );

  if (isLoading) {
    return <PageSkeleton />;
  }

  if (error) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-8 md:py-12">
        <div className="text-center py-16">
          <h2 className="text-xl font-semibold text-red-600 mb-2">
            加载失败
          </h2>
          <p className="text-muted-foreground">
            无法加载收藏列表，请稍后重试。
          </p>
        </div>
      </div>
    );
  }

  const bookmarks = data?.items || [];

  return (
    <ProtectedRoute>
      <div className="max-w-5xl mx-auto px-4 py-8 md:py-12">
        {/* 页面标题 */}
        <header className="mb-10">
          <div className="flex items-center gap-3 mb-4">
            <Bookmark className="w-8 h-8 text-primary" />
            <h1 className="text-3xl md:text-4xl font-bold">
              {t('bookmarks.title')}
            </h1>
          </div>
          <p className="text-lg text-muted-foreground">
            {t('bookmarks.subtitle')}
          </p>
        </header>

        {/* 收藏文章列表 */}
        {bookmarks.length === 0 ? (
          <EmptyState
            type="bookmarks"
            title={t('bookmarks.emptyTitle')}
            description={t('bookmarks.emptyDescription')}
            actionText={t('bookmarks.browseArticles')}
            onAction={() => router.push('/articles')}
          />
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-16">
              {bookmarks.map((article) => (
                <ArticleCard key={article.id} article={article} />
              ))}
            </div>

            {/* 统计信息 */}
            <div className="p-6 rounded-xl border border-border bg-muted/30">
              <div className="flex items-center gap-3">
                <Bookmark className="w-5 h-5 text-muted-foreground" />
                <span className="text-muted-foreground">
                  {t('bookmarks.totalCount', {
                    count: bookmarks.length,
                  })}
                </span>
              </div>
            </div>
          </>
        )}
      </div>
    </ProtectedRoute>
  );
}
```

### 第四阶段：测试与优化

#### 4.1 功能测试清单

- [ ] 用户登录/登出功能
- [ ] 文章收藏/取消收藏功能
- [ ] 收藏列表页面加载
- [ ] 未登录用户访问收藏页面重定向
- [ ] Token 过期自动刷新
- [ ] 空状态显示
- [ ] 错误处理

#### 4.2 性能优化

1. **缓存策略**：
   - 使用 SWR 的缓存机制
   - 设置合理的 stale-while-revalidate 时间
   - 实现乐观更新

2. **代码分割**：
   - 懒加载收藏相关组件
   - 按需加载认证模块

3. **错误边界**：
   - 添加全局错误边界组件
   - 实现优雅降级

#### 4.3 国际化支持

```json
// messages/en.json
{
  "bookmarks": {
    "title": "My Bookmarks",
    "subtitle": "Articles you've saved for later",
    "emptyTitle": "No bookmarks yet",
    "emptyDescription": "Articles you bookmark will appear here.",
    "browseArticles": "Browse articles",
    "totalCount": "{count} bookmarked articles"
  }
}

// messages/zh.json
{
  "bookmarks": {
    "title": "我的收藏",
    "subtitle": "您保存的文章",
    "emptyTitle": "暂无收藏",
    "emptyDescription": "您收藏的文章将会显示在这里。",
    "browseArticles": "浏览文章",
    "totalCount": "共 {count} 篇收藏文章"
  }
}
```

## 📊 预估工作量

### 第一阶段：前端认证系统重构 (2-3 天)

- [ ] 创建认证状态管理 (Zustand store)
- [ ] 对接登录/注册 API
- [ ] 添加 HTTP 拦截器
- [ ] 创建受保护路由组件

### 第二阶段：后端收藏功能开发 (1-2 天)

- [ ] 数据库迁移 (UserBookmark 表)
- [ ] 创建收藏服务
- [ ] 实现收藏相关 API 接口
- [ ] 集成到现有博客模块

### 第三阶段：前端收藏功能集成 (2 天)

- [ ] 扩展博客 API 客户端
- [ ] 创建收藏按钮组件
- [ ] 扩展 EmptyState 组件
- [ ] 重构收藏列表页面

### 第四阶段：测试与优化 (1 天)

- [ ] 功能测试
- [ ] 性能优化
- [ ] 国际化支持
- [ ] 错误处理完善

**总计**: 约 6-8 人天

## 🚀 部署计划

### 开发环境

1. 先实现前端认证系统
2. 使用 mock 数据测试 UI 流程
3. 逐步对接后端 API

### 测试环境

1. 完整功能测试
2. 性能测试
3. 安全测试（认证、权限）

### 生产环境

1. 分阶段部署
2. 监控和日志
3. 回滚计划

## 🔍 风险评估与缓解

### 风险 1：认证系统兼容性问题

- **风险**：现有后端认证系统与前端不兼容
- **缓解**：先进行 API 接口测试，确保返回格式正确

### 风险 2：性能问题

- **风险**：收藏列表查询性能差
- **缓解**：添加数据库索引，实现分页查询

### 风险 3：用户体验问题

- **风险**：登录流程复杂，用户流失
- **缓解**：简化登录流程，提供多种登录方式

### 风险 4：安全漏洞

- **风险**：Token 泄露或权限绕过
- **缓解**：严格验证用户权限，使用 HTTPS，定期安全审计

## 🐛 问题修复记录

### 问题：登录重定向出现404错误

**发现时间**：2026-04-15  
**问题描述**：当用户点击进入bookmark页面时，如果没有登录，系统会自动跳转到登录页面，但会出现404错误。

**根本原因**：

1. 项目配置了 `localePrefix: 'always'`，要求所有路由都有语言前缀
2. 多个地方的重定向路径没有包含语言前缀：
   - BookmarkButton组件中的登录重定向
   - ProtectedRoute组件中的登录重定向
   - HTTP拦截器中的401错误重定向

**解决方案**：

1. **创建统一的语言工具函数** (`apps/frontend-blog/src/lib/utils/locale.ts`)：

   ```typescript
   export function getCurrentLocale(): string {
     // 从URL路径提取语言代码
     if (typeof window !== "undefined") {
       const pathname = window.location.pathname;
       const match = pathname.match(/^\/([a-z]{2})(?:\/|$)/);
       return match ? match[1] : "zh";
     }
     return "zh";
   }

   export function withLocale(path: string): string {
     const locale = getCurrentLocale();
     return `/${locale}${path}`;
   }
   ```

2. **修复BookmarkButton组件**：

   ```typescript
   const handleToggle = async () => {
     if (!isAuthenticated) {
       router.push(withLocale("/login"));
       return;
     }
   };
   ```

3. **修复ProtectedRoute组件**：

   ```typescript
   useEffect(() => {
     if (!isLoading && !isAuthenticated) {
       router.push(withLocale("/login"));
     }
   }, [isAuthenticated, isLoading, router]);
   ```

4. **修复HTTP拦截器中的401处理**：
   ```typescript
   // 刷新失败，清除认证状态
   useAuthStore.getState().logout();
   // 如果是客户端环境，重定向到登录页（带语言前缀）
   if (typeof window !== "undefined") {
     window.location.href = withLocale("/login");
   }
   ```

**修复效果**：

- ✅ 从 `/zh/articles/slug` 点击BookmarkButton → 重定向到 `/zh/login`
- ✅ 从 `/en/articles/slug` 点击BookmarkButton → 重定向到 `/en/login`
- ✅ 从 `/zh/bookmarks` 访问 → ProtectedRoute重定向到 `/zh/login`
- ✅ 从 `/en/bookmarks` 访问 → ProtectedRoute重定向到 `/en/login`
- ✅ API返回401时 → HTTP拦截器重定向到带语言前缀的登录页面

## 📈 成功指标

1. **功能完成度**：所有计划功能实现
2. **性能指标**：页面加载时间 < 2s，API 响应时间 < 500ms
3. **用户体验**：用户满意度调查 > 90%
4. **错误率**：生产环境错误率 < 0.1%
5. **使用率**：收藏功能使用率 > 30%

## 🎯 下一步行动

1. **立即开始**：创建前端认证状态管理
2. **并行开发**：后端收藏功能开发
3. **集成测试**：前后端对接测试
4. **用户测试**：邀请用户进行 Beta 测试
5. **正式发布**：生产环境部署

---

_文档版本：1.1_
_最后更新：2026-04-15_
_负责人：前端开发团队_
