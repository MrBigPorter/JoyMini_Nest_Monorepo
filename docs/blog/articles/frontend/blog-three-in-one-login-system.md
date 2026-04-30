---
title: Next.js 博客三合一登录系统：邮件验证码 + Google OAuth + Facebook OAuth 完整实现
slug: blog-three-in-one-login-system
tags: Next.js, OAuth, Authentication, Zustand, Security
---

# Next.js 博客三合一登录系统：邮件验证码 + Google OAuth + Facebook OAuth 完整实现

## 1. 为什么需要三合一登录？

博客系统需要支持用户登录才能使用书签、评论、点赞等互动功能。但不同用户有不同的登录偏好：

- **邮件验证码登录**：无需注册密码，适合对隐私敏感的用户
- **Google OAuth**：一键登录，适合 Google 用户
- **Facebook OAuth**：社交登录，适合 Facebook 用户

采用"三合一"设计的好处是覆盖绝大多数用户群体，同时保持登录体验的一致性和安全性。

## 2. 系统架构

### 2.1 核心文件结构

```
apps/frontend-blog/src/
├── lib/
│   ├── api/
│   │   ├── authApi.ts          # 认证API接口
│   │   └── http.ts             # HTTP客户端（含Token管理）
│   ├── hooks/
│   │   └── useAuth.ts          # 认证Hook
│   ├── stores/
│   │   └── auth.store.ts       # Zustand状态管理
│   ├── utils/
│   │   └── oauth.ts            # OAuth工具函数
│   └── components/
│       └── GoogleOAuthProvider.tsx  # Google OAuth提供者
├── components/
│   ├── auth/
│   │   └── ProtectedRoute.tsx  # 权限控制组件
│   └── Header.tsx              # 头部组件（显示登录状态）
└── app/[locale]/
    └── login/
        └── page.tsx            # 登录页面
```

### 2.2 技术栈

| 组件 | 选型 | 说明 |
|------|------|------|
| 状态管理 | Zustand + 持久化 | 轻量、类型安全、React 18 兼容 |
| HTTP 客户端 | Axios + 拦截器 | Token 注入、自动刷新、401 处理 |
| Google OAuth | `@react-oauth/google` | 官方 React 库，支持 Google One Tap |
| Facebook OAuth | Facebook JavaScript SDK | 原生 SDK 集成 |
| UI 框架 | Next.js 15 + Tailwind CSS | SSR + App Router |
| 国际化 | next-intl | 多语言登录文案 |

## 3. 邮件验证码登录

### 3.1 实现原理

用户输入邮箱 → 点击"发送验证码" → 后端生成6位数字验证码并发送到邮箱 → 用户输入验证码 → 后端校验 → 登录成功。

```typescript
// 发送验证码
sendEmailCode: (data: { email: string }) => {
  return http.post('/v1/auth/send-email-code', data);
},

// 验证码登录
loginWithEmailCode: (email: string, code: string) => {
  return http.post<LoginResponse>('/v1/auth/login/email-code', { email, code });
},
```

### 3.2 前端交互

```typescript
const handleSubmit = async (e: React.FormEvent) => {
  e.preventDefault();
  setError(null);

  if (!email || !code) {
    setError(t("auth.fillAllFields"));
    return;
  }

  try {
    await loginWithEmail(email, code);
    // 登录成功后重定向到原始访问页面
    setTimeout(() => {
      const redirectPath = sessionStorage.getItem("redirectAfterLogin");
      if (redirectPath) {
        sessionStorage.removeItem("redirectAfterLogin");
        router.push(redirectPath);
      } else {
        router.push("/");
      }
    }, 100);
  } catch (err: any) {
    setError(err.message || t("auth.loginFailed"));
  }
};
```

设计亮点：

- **`redirectAfterLogin`**：用户在访问受保护页面时被重定向到登录页，登录成功后自动跳回原来的页面，体验无缝
- **60 秒倒计时**：防止用户频繁发送验证码
- **数字自动格式化**：验证码输入框只允许数字，自动格式化

## 4. Google OAuth 登录

### 4.1 提供者组件

```typescript
'use client';
import { GoogleOAuthProvider as GoogleProvider } from '@react-oauth/google';

export function GoogleOAuthProvider({ children }: GoogleOAuthProviderProps) {
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;

  if (!clientId) {
    console.warn('Google OAuth Client ID is not configured.');
    return <>{children}</>;
  }

  return <GoogleProvider clientId={clientId}>{children}</GoogleProvider>;
}
```

这个组件的特点是：

- **优雅降级**：如果环境变量未配置，直接渲染子组件，不阻断整个应用
- **环境变量驱动**：开发环境和生产环境使用不同的 Client ID
- **客户端组件**：使用 `'use client'` 指令，因为 OAuth 流程必须在浏览器中运行

### 4.2 布局集成

```typescript
<NextIntlClientProvider>
  <ThemeProvider>
    <QueryProvider>
      <I18nProvider>
        <GoogleOAuthProvider>  {/* 包裹整个应用 */}
          <Header />
          <Sidebar />
          <main>{children}</main>
          <BottomNavigation />
        </GoogleOAuthProvider>
      </I18nProvider>
    </QueryProvider>
  </ThemeProvider>
</NextIntlClientProvider>
```

`GoogleOAuthProvider` 包裹在布局的最内层，确保所有路由组件都能使用 Google 登录。

### 4.3 登录处理

```typescript
const handleGoogleLoginSuccess = async (credentialResponse: any) => {
  if (!credentialResponse.credential) {
    setError(t("auth.oauth.googleFailed"));
    return;
  }

  try {
    setIsOAuthLoading(true);
    setError(null);

    const result = await handleGoogleLogin(credentialResponse.credential);

    if (result.success && result.data) {
      await loginWithOAuth("google", credentialResponse.credential);
      // 重定向逻辑
    }
  } catch (err: any) {
    setError(err.message || t("auth.oauth.googleFailed"));
  } finally {
    setIsOAuthLoading(false);
  }
};
```

## 5. Facebook OAuth 登录

### 5.1 SDK 初始化

Facebook SDK 需要延迟初始化，避免影响页面首次加载性能：

```typescript
export function initFacebookSDK(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined") {
      resolve();
      return;
    }
    // 异步加载 Facebook SDK
    window.fbAsyncInit = function() {
      FB.init({
        appId: process.env.NEXT_PUBLIC_FACEBOOK_APP_ID,
        cookie: true,
        xfbml: true,
        version: 'v18.0'
      });
      resolve();
    };
    // 加载 SDK 脚本
    // ...
  });
}
```

### 5.2 登录处理

```typescript
const handleFacebookLoginClick = async () => {
  if (!isFacebookSDKLoaded) {
    setError(t("auth.oauth.facebookNotReady"));
    return;
  }

  try {
    setIsOAuthLoading(true);
    setError(null);

    const accessToken = await triggerFacebookLogin();
    const result = await handleFacebookLogin(accessToken);

    if (result.success && result.data) {
      await loginWithOAuth("facebook", accessToken);
      // 重定向逻辑
    }
  } catch (err: any) {
    setError(err.message || t("auth.oauth.facebookFailed"));
  } finally {
    setIsOAuthLoading(false);
  }
};
```

## 6. 安全设计

### 6.1 Token 管理

- **自动刷新**：Access Token 过期时，Axios 拦截器自动使用 Refresh Token 刷新
- **401 统一处理**：收到 401 响应时，清除 Token 并重定向到登录页
- **多标签同步**：使用 `storage` 事件监听 Token 变化，多个标签页保持同步
- **安全存储**：Access Token 存储在内存中，Refresh Token 存储在 HttpOnly Cookie 中

### 6.2 OAuth 安全

- **后端验证**：所有 OAuth Token 都在后端完成验证，前端只传递凭证，不处理敏感逻辑
- **官方 SDK**：Google 使用官方 `@react-oauth/google` 库，Facebook 使用官方 JS SDK
- **HTTPS 强制**：所有 OAuth 回调必须在 HTTPS 环境下进行

### 6.3 输入验证

- 邮箱格式前端实时校验
- 验证码长度和格式限制
- 登录按钮防重复提交（loading 状态禁用）
- 错误消息完整国际化

## 7. 用户体验

### 7.1 三种登录流程对比

| 登录方式 | 步骤数 | 耗时 | 用户偏好 |
|----------|--------|------|----------|
| 邮件验证码 | 3 步（输入邮箱→收验证码→输入登录） | 30-60 秒 | 隐私优先 |
| Google OAuth | 1 步（点击→授权弹窗→自动登录） | 2-5 秒 | 便捷优先 |
| Facebook OAuth | 1 步（点击→授权弹窗→自动登录） | 2-5 秒 | 社交偏好 |

### 7.2 登录页面 UI

```
┌─────────────────────────────────┐
│          📝 登录                 │
│                                 │
│  ┌─────────────────────────┐    │
│  │ 📧 邮箱地址              │    │
│  └─────────────────────────┘    │
│  ┌──────────┐ ┌────────────┐   │
│  │ 验证码    │ │ 📨 发送    │   │
│  └──────────┘ └────────────┘   │
│  ┌─────────────────────────┐    │
│  │      🔑 登录             │    │
│  └─────────────────────────┘    │
│                                 │
│  ──── 或使用以下方式登录 ────  │
│                                 │
│  ┌─ [G] 使用 Google 登录 ───┐  │
│  └──────────────────────────┘  │
│  ┌─ [f] 使用 Facebook 登录 ─┐  │
│  └──────────────────────────┘  │
└─────────────────────────────────┘
```

### 7.3 错误处理

- 清晰的多语言错误提示
- 网络错误自动重试
- OAuth 失败友好提示（如 "Google 登录暂时不可用"）
- 加载状态使用骨架屏

## 8. 部署配置

### 8.1 环境变量

```env
# 开发环境
NEXT_PUBLIC_API_URL=http://localhost:3001
NEXT_PUBLIC_GOOGLE_CLIENT_ID=dev-client-id.apps.googleusercontent.com
NEXT_PUBLIC_FACEBOOK_APP_ID=dev-app-id

# 生产环境
NEXT_PUBLIC_API_URL=https://api.joyminis.com
NEXT_PUBLIC_GOOGLE_CLIENT_ID=prod-client-id.apps.googleusercontent.com
NEXT_PUBLIC_FACEBOOK_APP_ID=prod-app-id
```

### 8.2 OAuth 应用配置

在生产环境上线前，需要在 Google Cloud Console 和 Facebook Developers 中配置：

- **Google**：配置授权 JavaScript 来源和重定向 URI
- **Facebook**：配置 OAuth 重定向 URI 和域名白名单

## 9. 性能优化

1. **代码分割**：OAuth SDK 按需加载，不影响首屏性能
2. **Facebook SDK 延迟初始化**：页面加载完成后再初始化，避免阻塞
3. **Zustand 选择器**：精细控制组件重渲染，避免不必要的更新
4. **请求去重**：短时间内重复的登录请求会被合并

## 10. 调试技巧

在浏览器控制台可以直接调试认证状态：

```typescript
window.authDebug = {
  getState: () => useAuthStore.getState(),
  clearTokens: () => useAuthStore.getState().logout(),
  checkAuth: () => useAuthStore.getState().checkAuth(),
};
```

## 11. 总结

三合一登录系统的设计核心是**覆盖度 × 安全性 × 用户体验**：

- 邮件验证码覆盖了不需要社交账号的用户
- Google OAuth 和 Facebook OAuth 覆盖了主流社交登录场景
- Token 自动刷新和 401 拦截保证了会话的连续性
- Zustand 持久化让登录状态在页面刷新后依然保持

这个系统的实现遵循了一个原则：**后端负责安全，前端负责体验**。所有敏感验证都在后端完成，前端专注于提供流畅的交互。

---

**相关资源**：
- [后端 OAuth API 文档](../api/AUTHENTICATION_INTEGRATION_GUIDE.md)
- [Zustand 状态管理实现](../architecture/HOOKS_ARCHITECTURE.md)
